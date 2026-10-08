// SiteRuntime — one fully isolated SafeForge instance per site (digital twin):
// simulators, vision hub, risk engine, knowledge graph, permits, alerts, emergency response,
// and the site-scoped REST API + WebSocket state. Runtimes start lazily and stop when idle.
const express = require('express');

const config = require('../config');
const incidents = require('../data/incidents.json');
const regulations = require('../data/regulations.json');
const scadaBaselines = require('../data/scada-baselines.json');
const { PermitStore } = require('../data/permitStore');

const SensorSimulator = require('../simulation/SensorSimulator');
const { WorkerSimulator, WORKERS } = require('../simulation/WorkerSimulator');
const ScadaSimulator = require('../simulation/ScadaSimulator');

const { KnowledgeGraph } = require('../services/KnowledgeGraph');
const { AlertManager } = require('../services/AlertManager');
const { VisionHub } = require('../services/VisionHub');
const { forecastAll } = require('../services/forecast');
const notifier = require('../services/notifier');

const CompoundRiskOrchestrator = require('../agents/CompoundRiskOrchestrator');
const EmergencyOrchestrator = require('../agents/EmergencyOrchestrator');
const PermitAgent = require('../agents/PermitAgent');
const ComplianceAgent = require('../agents/ComplianceAgent');

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class SiteRuntime {
  /**
   * @param site   site document ({ id, name, layout, contacts, ... })
   * @param io     Socket.io server (events are emitted to the site's room only)
   * @param shared { rag, limiters }
   */
  constructor(site, io, shared) {
    this.site = site;
    this.room = `site:${site.id}`;
    this.io = io;
    this.shared = shared;
    this.startedAt = Date.now();
    this.lastActive = Date.now();
    this.running = false;
    const emitter = { emit: (event, data) => io?.to(this.room).emit(event, data) };
    this.emitter = emitter;
    const layout = site.layout;
    this.layout = layout;

    this.kg = new KnowledgeGraph(layout);
    this.permits = new PermitStore(layout);
    this.sensorSim = new SensorSimulator(layout);
    this.workerSim = new WorkerSimulator(layout);
    this.scadaSim = new ScadaSimulator(null);
    this.compliance = new ComplianceAgent();
    this.permitAgent = new PermitAgent({ kg: this.kg, layout, permits: this.permits });
    this.riskEngine = new CompoundRiskOrchestrator({ layout, kg: this.kg, permits: this.permits });

    // Site contacts (if configured) take precedence over the default shift roster for routing
    const contacts = (site.contacts || []).filter(c => c.name && c.role).map(c => ({ ...c, id: c.email || c.name }));
    this.alerts = new AlertManager({ io: emitter, layout, roster: [...contacts, ...WORKERS], getPermits: (f) => this.permits.getPermits(f) });
    this.vision = new VisionHub({
      io: emitter, layout, alerts: this.alerts, config,
      getActivePermitsByZone: () => this.permits.getActivePermitsByZone(),
      regulationsFor: (text, k) => shared.rag.regulationsFor(text, k),
    });
    this.emergency = new EmergencyOrchestrator({
      io: emitter, layout,
      getPermits: (f) => this.permits.getPermits(f),
      suspendPermit: (id) => { this.permits.updatePermitStatus(id, 'SUSPENDED'); this.broadcastPermits(); },
      getVision: () => this.vision.liveByZone(),
      getAlerts: () => this.alerts.list({ limit: 20 }),
      raiseAlert: (e) => this.alerts.raise(e),
    });

    this.shiftInfo = {
      current: 'A', supervisor: contacts.find(c => c.role === 'Shift Supervisor')?.name || 'Deepika Patel',
      startTime: new Date(Date.now() - 3 * 3600000).toISOString(),
      workersOnSite: WORKERS.length, nextChange: new Date(Date.now() + 5 * 3600000).toISOString(),
    };
    this.state = { sensors: this.sensorSim.getAllReadings(), scada: this.scadaSim.getState(), forecasts: [], risk: this.riskEngine.getLast(), scenario: 'NORMAL', homography: {} };
    this.compoundKeys = new Set();
    this.timers = [];

    this.sensorSim.on('readings', (readings) => {
      this.state.sensors = readings;
      emitter.emit('sensors:update', readings);
      this.sensorAlerts(readings);
      this.recomputeRisk();
    });
    this.workerSim.on('locations', (w) => emitter.emit('workers:update', w));
    this.scadaSim.on('scada:update', (s) => { this.state.scada = s; emitter.emit('scada:update', s); });

    this.vision.onFire((d) => {
      if (!config.vision.autoEmergencyOnFire) return;
      if (this.emergency.getState().active) this.emergency.extend([d.zone], `Fire detected on CCTV ${d.camera_id}`, `FIRE:${d.zone}`);
      else if (this.emergency.shouldAutoTrigger(`FIRE:${d.zone}`)) {
        this.emergency.trigger('LEVEL_2', `Fire detected on CCTV ${d.camera_id} in ${d.zone_name}`, [d.zone], this.state.sensors, { auto: true, key: `FIRE:${d.zone}` });
      }
    });
  }

  touch() { this.lastActive = Date.now(); }

  start() {
    if (this.running) return this;
    this.running = true;
    this.sensorSim.start(config.simulation.sensorMs);
    this.workerSim.start(config.simulation.workerMs);
    this.scadaSim.start(config.simulation.scadaMs);
    this.timers.push(setInterval(() => this.vision.sweep(), 5000));
    this.recomputeRisk();
    console.log(`[Sites] runtime started: ${this.site.id}`);
    return this;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.sensorSim.stop(); this.workerSim.stop(); this.scadaSim.stop();
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.emergency.reset();
    console.log(`[Sites] runtime stopped: ${this.site.id}`);
  }

  connectedClients() { return this.io?.sockets.adapter.rooms.get(this.room)?.size || 0; }

  broadcastPermits() { this.emitter.emit('permits:updated', this.permits.getPermits()); }

  recomputeRisk() {
    const { state } = this;
    state.forecasts = forecastAll(state.sensors);
    const em = this.emergency.getState();
    const risk = this.riskEngine.analyze({
      sensors: state.sensors,
      permitsByZone: this.permits.getActivePermitsByZone(),
      vision: this.vision.liveByZone(),
      workers: this.workerSim.getAllWorkers(),
      shift: this.shiftInfo,
      forecasts: state.forecasts,
      emergencyZones: em.active ? em.affectedZones : [],
    });
    state.risk = risk;
    this.emitter.emit('risk:update', risk);

    const keys = new Set();
    for (const a of risk.alerts) {
      const key = `COMPOUND:${a.id}`;
      keys.add(key);
      this.alerts.raise({
        key, type: 'COMPOUND_RISK', severity: a.severity, title: a.name, message: a.details,
        zone: a.affectedZones[0], source: `risk:${a.ruleId}`,
        details: { ruleId: a.ruleId, zones: a.affectedZones, chains: a.chains, sensors: a.sensors, permits: a.permits, aiRecommendation: a.aiRecommendation },
        regulations: [a.regulation], recommendedActions: a.recommendedActions,
      });
    }
    this.compoundKeys.forEach(k => { if (!keys.has(k)) this.alerts.clear(k); });
    this.compoundKeys = keys;

    const critical = risk.alerts.find(a => a.severity === 'CRITICAL' && a.affectedZones.some(z => (risk.zoneScores[z]?.score || 0) >= 80));
    if (critical) {
      if (this.emergency.getState().active) this.emergency.extend(critical.affectedZones, critical.name, critical.id);
      else if (this.emergency.shouldAutoTrigger(critical.id)) {
        this.emergency.trigger('LEVEL_2', `${critical.name}: ${critical.details}`, critical.affectedZones, state.sensors, { auto: true, key: critical.id });
      }
    }
    return risk;
  }

  sensorAlerts(readings) {
    for (const s of readings) {
      const key = `SENSOR:${s.id}`;
      if (s.status === 'NORMAL') { this.alerts.clear(key); continue; }
      this.alerts.raise({
        key, type: 'SENSOR', severity: s.status === 'CRITICAL' ? 'HIGH' : 'MEDIUM', zone: s.zone, source: 'iot',
        title: `${s.type} ${s.status.toLowerCase()} — ${s.id}`,
        message: `${s.type} at ${s.id} reads ${s.value} ${s.unit} (warning ${s.warningThreshold}, critical ${s.criticalThreshold}).`,
        details: { sensorId: s.id, value: s.value, unit: s.unit },
        regulations: s.type === 'O2' ? ['Factories Act 1948, Section 36'] : ['OISD-STD-105'],
      });
    }
  }

  setScenario(scenario) {
    this.sensorSim.setScenario(scenario);
    this.scadaSim.setScenario(scenario);
    this.state.scenario = scenario;
    this.emitter.emit('scenario:changed', { scenario });
  }

  /** Initial state for a newly connected dashboard. */
  sendInitial(socket) {
    const s = this.state;
    socket.emit('site:info', this.publicSite());
    socket.emit('sensors:initial', s.sensors);
    socket.emit('workers:initial', this.workerSim.getAllWorkers());
    socket.emit('permits:initial', this.permits.getPermits());
    socket.emit('shift:info', this.shiftInfo);
    socket.emit('emergency:state', this.emergency.getState());
    socket.emit('scada:initial', s.scada);
    socket.emit('risk:update', s.risk);
    socket.emit('cv:initial', this.vision.liveByZone());
    socket.emit('alerts:initial', this.alerts.list({ limit: 60 }));
    socket.emit('alerts:stats', this.alerts.stats());
    socket.emit('scenario:changed', { scenario: s.scenario });
  }

  publicSite() {
    const { ingestKey, ...rest } = this.site;
    return rest;
  }

  status() {
    return { id: this.site.id, running: this.running, startedAt: new Date(this.startedAt).toISOString(), lastActive: new Date(this.lastActive).toISOString(), clients: this.connectedClients(), alerts: this.alerts.stats().open };
  }

  /** Site-scoped REST API (mounted at /api/sites/:siteId). */
  router() {
    const api = express.Router();
    const { ingestLimiter, writeLimiter, llmLimiter } = this.shared.limiters;
    const { state, permits, vision, alerts, emergency, kg } = this;
    const self = this;

    api.get('/plant-layout', (req, res) => res.json(this.layout));
    api.get('/spatial/zones', (req, res) => res.json({ zones: this.layout.zones, plant: this.layout.plant, cameras: this.layout.cameras, bounds: { width: 1180, height: 640 }, adjacency: Object.fromEntries(Object.entries(kg.adjacency).map(([k, v]) => [k, [...v]])) }));
    api.post('/spatial/calibrate', writeLimiter, (req, res) => {
      const { camera_id, matrix, src_points, dst_points } = req.body || {};
      if (!camera_id || !Array.isArray(matrix) || matrix.length !== 3) return res.status(400).json({ error: 'camera_id and 3×3 matrix required' });
      state.homography[camera_id] = { matrix, src_points, dst_points, updated_at: new Date().toISOString() };
      self.emitter.emit('spatial:calibration_updated', { camera_id });
      res.json({ status: 'ok', camera_id });
    });
    api.get('/spatial/homography', (req, res) => res.json(state.homography));

    api.get('/sensors', (req, res) => res.json(state.sensors));
    api.get('/forecasts', (req, res) => res.json(state.forecasts));
    api.get('/scada/state', (req, res) => res.json(state.scada));
    api.get('/scada/equipment', (req, res) => res.json({ equipment: state.scada.equipment, timestamp: state.scada.timestamp, baselines: scadaBaselines.scada_equipment }));
    api.get('/scada/registers', (req, res) => {
      let regs = state.scada.registers || [];
      if (req.query.zone) regs = regs.filter(r => r.zone === req.query.zone);
      res.json({ count: regs.length, registers: regs, timestamp: state.scada.timestamp });
    });
    api.get('/workers', (req, res) => res.json(this.workerSim.getAllWorkers()));
    api.get('/shift', (req, res) => res.json(this.shiftInfo));

    api.post('/vision/detections', ingestLimiter, (req, res) => {
      const result = vision.ingest(req.body, 'http');
      if (!result.ok) return res.status(400).json({ error: result.error });
      const d = result.detection;
      res.json({ status: 'ok', zone: d.zone, required_ppe: d.required_ppe, ppe_violations: d.ppe_violations, events: d.events.map(e => e.type) });
    });
    api.get('/vision/state', (req, res) => res.json(vision.summary()));
    api.get('/vision/requirements', (req, res) => res.json(vision.requirementsTable()));
    api.get('/vision/zones/:zone', (req, res) => {
      const d = vision.byZone[req.params.zone];
      res.json(d ? { ...d, stale: Date.now() - d.receivedAt > config.vision.staleMs } : { zone: req.params.zone, worker_count: 0, message: 'No CV data for this zone' });
    });

    api.get('/alerts', (req, res) => res.json(alerts.list({ status: req.query.status, type: req.query.type, zone: req.query.zone, limit: Math.min(300, Number(req.query.limit) || 100) })));
    api.get('/alerts/stats', (req, res) => res.json(alerts.stats()));
    api.get('/alerts/:id', (req, res) => {
      const a = alerts.get(req.params.id);
      return a ? res.json(alerts.public(a, true)) : res.status(404).json({ error: 'Alert not found' });
    });
    api.post('/alerts/:id/ack', writeLimiter, (req, res) => {
      const a = alerts.acknowledge(req.params.id, String(req.body?.by || req.user?.name || 'Control Room').slice(0, 60));
      return a ? res.json(alerts.public(a, false)) : res.status(404).json({ error: 'Alert not found' });
    });
    api.post('/alerts/:id/resolve', writeLimiter, (req, res) => {
      const a = alerts.resolve(req.params.id, String(req.body?.by || req.user?.name || 'Control Room').slice(0, 60), String(req.body?.note || '').slice(0, 300));
      return a ? res.json(alerts.public(a, false)) : res.status(404).json({ error: 'Alert not found' });
    });
    api.post('/alerts/ack-critical', writeLimiter, (req, res) => {
      const by = String(req.user?.name || 'Control Room').slice(0, 60);
      const open = alerts.list({ status: 'OPEN', limit: 300 }).filter(a => a.severity === 'CRITICAL');
      open.forEach(a => alerts.acknowledge(a.id, by));
      res.json({ acknowledged: open.length });
    });
    api.post('/notifications/test', writeLimiter, asyncRoute(async (req, res) => {
      const log = await notifier.dispatch({ id: 'TEST', type: 'TEST', severity: 'LOW', title: 'SafeForge test notification', message: `Alert delivery test for ${this.site.name}.`, recipients: [] });
      res.json({ channels: notifier.channels(), log });
    }));

    const ctx = (zone) => ({ vision: vision.liveByZone(), requiredPPE: vision.requiredPPE(zone).items });
    api.get('/permits', (req, res) => res.json(permits.getPermits({ status: req.query.status, zone: req.query.zone })));
    api.post('/permits/validate', llmLimiter, asyncRoute(async (req, res) => res.json(await this.permitAgent.validatePermit(req.body || {}, state.sensors, ctx(req.body?.zone)))));
    api.post('/permits/:type/validate', llmLimiter, asyncRoute(async (req, res) => res.json(await this.permitAgent.validatePermit({ type: req.params.type, ...(req.body || {}) }, state.sensors, ctx(req.body?.zone)))));
    api.post('/permits', writeLimiter, asyncRoute(async (req, res) => {
      const body = req.body || {};
      const validation = await this.permitAgent.validatePermit(body, state.sensors, ctx(body.zone));
      let permit;
      try {
        permit = permits.createPermit({ ...body, requestedBy: body.requestedBy || req.user?.name, aiValidated: true, aiWarnings: [...validation.violations, ...validation.warnings].map(v => v.message), riskScore: validation.riskScore });
      } catch (err) { return res.status(400).json({ error: err.message }); }
      self.broadcastPermits();
      res.json({ permit, validation });
    }));
    api.patch('/permits/:id/status', writeLimiter, asyncRoute(async (req, res) => {
      const { status, by, force } = req.body || {};
      const current = permits.getPermitById(req.params.id);
      if (!current) return res.status(404).json({ error: 'Permit not found' });
      if (status === 'ACTIVE' && !force) {
        const validation = await this.permitAgent.validatePermit(current, state.sensors, ctx(current.zone));
        if (!validation.canApprove) return res.status(409).json({ error: 'Blocked by permit intelligence', validation });
      }
      const permit = permits.updatePermitStatus(req.params.id, status, by || req.user?.name);
      if (!permit) return res.status(400).json({ error: `Invalid status ${status}` });
      self.broadcastPermits();
      self.recomputeRisk();
      res.json(permit);
    }));

    api.get('/risk', (req, res) => res.json(state.risk));
    api.get('/risk/graph', (req, res) => res.json(kg.snapshot({
      sensors: state.sensors, permits: permits.getPermits(), workers: this.workerSim.getAllWorkers(),
      vision: vision.liveByZone(), alerts: state.risk.alerts, forecasts: state.forecasts,
    })));
    api.get('/risk/paths', (req, res) => res.json(kg.compoundPaths({ sensors: state.sensors, permits: permits.getPermits(), vision: vision.liveByZone(), forecasts: state.forecasts })));

    api.post('/rag/query', llmLimiter, asyncRoute(async (req, res) => {
      const query = String(req.body?.query || '').trim().slice(0, 500);
      if (!query) return res.status(400).json({ error: 'Query required' });
      res.json(await this.shared.rag.query(query, this.layout.plant));
    }));
    api.get('/incidents', (req, res) => res.json(incidents));
    api.get('/regulations', (req, res) => res.json(regulations));
    api.get('/compliance', (req, res) => res.json(this.compliance.audit({
      risk: state.risk, vision: vision.summary(), sensors: state.sensors, permits: permits.getPermits(),
      alertStats: alerts.stats(), alerts: alerts.list({ limit: 300 }), emergency: emergency.getState(),
    })));

    api.post('/emergency/trigger', writeLimiter, asyncRoute(async (req, res) => {
      const { level, cause, affectedZones } = req.body || {};
      res.json(await emergency.trigger(level || 'LEVEL_2', String(cause || `Manual trigger by ${req.user?.name || 'operator'}`).slice(0, 300), Array.isArray(affectedZones) ? affectedZones : [], state.sensors));
    }));
    api.post('/emergency/reset', writeLimiter, (req, res) => {
      const s = emergency.reset();
      const a = alerts.list({ type: 'EMERGENCY' }).find(x => x.status !== 'RESOLVED');
      if (a) alerts.resolve(a.id, req.user?.name || 'Control Room', 'Emergency stood down');
      self.recomputeRisk();
      res.json(s);
    });
    api.get('/emergency/state', (req, res) => res.json(emergency.getState()));

    api.post('/scenario', writeLimiter, (req, res) => {
      try { self.setScenario(req.body?.scenario || 'NORMAL'); } catch (err) { return res.status(400).json({ error: err.message }); }
      res.json({ success: true, scenario: state.scenario });
    });
    api.get('/scenario', (req, res) => res.json({ scenario: state.scenario }));
    api.post('/demo/kill-chain', writeLimiter, (req, res) => {
      const step = req.body?.step;
      const hotWork = permits.getPermits().find(p => p.type === 'HOT_WORK' && p.zone === 'Z-01');
      const z1 = this.layout.zones[0].name;
      if (step === 'drift') {
        self.setScenario('KILL_CHAIN');
        return res.json({ step, message: `Flammable gas in ${z1} (Z-01) is drifting upward but stays below its 10 % LEL alarm.` });
      }
      if (step === 'permit') {
        if (hotWork && hotWork.status !== 'ACTIVE') permits.updatePermitStatus(hotWork.id, 'ACTIVE', 'Deepika Patel (paper permit)');
        self.broadcastPermits();
        const risk = self.recomputeRisk();
        return res.json({ step, message: `Hot-work permit ${hotWork?.id} activated in ${z1} without live gas validation.`, riskScore: risk.riskScore, status: risk.status });
      }
      if (step === 'reset') {
        self.setScenario('NORMAL');
        permits.reset();
        emergency.reset();
        emergency.lastAutoKey = null;
        vision.reset();
        alerts.alerts.filter(a => a.status !== 'RESOLVED').forEach(a => alerts.resolve(a.id, 'Demo reset'));
        self.broadcastPermits();
        self.recomputeRisk();
        return res.json({ step, message: 'Demo reset to baseline.' });
      }
      res.status(400).json({ error: 'step must be drift | permit | reset' });
    });
    api.get('/runtime', (req, res) => res.json(this.status()));
    return api;
  }
}

module.exports = { SiteRuntime };
