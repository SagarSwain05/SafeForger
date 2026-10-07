// SafeForge Nexus — platform assembly.
// Wires simulators, the vision hub, agents, alerting and the HTTP/WebSocket API together.
// createPlatform() returns an un-started instance so tests can run isolated copies.
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config');
const plantLayout = require('./data/plant-layout.json');
const incidents = require('./data/incidents.json');
const regulations = require('./data/regulations.json');
const scadaBaselines = require('./data/scada-baselines.json');
const permitStore = require('./data/permitStore');

const SensorSimulator = require('./simulation/SensorSimulator');
const { WorkerSimulator, WORKERS } = require('./simulation/WorkerSimulator');
const ScadaSimulator = require('./simulation/ScadaSimulator');

const { KnowledgeGraph } = require('./services/KnowledgeGraph');
const { AlertManager } = require('./services/AlertManager');
const { VisionHub } = require('./services/VisionHub');
const { forecastAll } = require('./services/forecast');
const llm = require('./services/llm');
const notifier = require('./services/notifier');

const CompoundRiskOrchestrator = require('./agents/CompoundRiskOrchestrator');
const RAGAgent = require('./agents/RAGAgent');
const EmergencyOrchestrator = require('./agents/EmergencyOrchestrator');
const PermitAgent = require('./agents/PermitAgent');
const ComplianceAgent = require('./agents/ComplianceAgent');

const VERSION = require('../package.json').version;

/** Tiny fixed-window rate limiter (per IP + bucket) — enough to protect a public demo. */
function rateLimit(bucket, max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Too many requests — slow down' });
    next();
  };
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createPlatform() {
  const app = express();
  const server = http.createServer(app);
  // Configured dashboard origins, plus any localhost port for local development
  const corsOrigin = config.corsOrigins.length
    ? (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin.replace(/\/$/, '')) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    : '*';
  const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST', 'PATCH'] }, maxHttpBufferSize: 4e6 });
  app.set('trust proxy', 1);
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '3mb' }));

  const startedAt = Date.now();
  const kg = new KnowledgeGraph(plantLayout);
  const sensorSim = new SensorSimulator();
  const workerSim = new WorkerSimulator();
  const scadaSim = new ScadaSimulator(null);
  const rag = new RAGAgent();
  const compliance = new ComplianceAgent();
  const permitAgent = new PermitAgent({ kg, layout: plantLayout });
  const riskEngine = new CompoundRiskOrchestrator({ layout: plantLayout, kg });

  const alerts = new AlertManager({ io, layout: plantLayout, roster: WORKERS, getPermits: permitStore.getPermits });
  const vision = new VisionHub({
    io, layout: plantLayout, alerts, config,
    getActivePermitsByZone: permitStore.getActivePermitsByZone,
    regulationsFor: (text, k) => rag.regulationsFor(text, k),
  });

  const emergency = new EmergencyOrchestrator({
    io, layout: plantLayout,
    getPermits: permitStore.getPermits,
    suspendPermit: (id) => { permitStore.updatePermitStatus(id, 'SUSPENDED'); broadcastPermits(); },
    getVision: () => vision.liveByZone(),
    getAlerts: () => alerts.list({ limit: 20 }),
    raiseAlert: (e) => alerts.raise(e),
  });

  const shiftInfo = {
    current: 'A', supervisor: 'Deepika Patel',
    startTime: new Date(Date.now() - 3 * 3600000).toISOString(),
    workersOnSite: WORKERS.length, nextChange: new Date(Date.now() + 5 * 3600000).toISOString(),
  };

  const state = {
    sensors: sensorSim.getAllReadings(),
    scada: scadaSim.getState(),
    forecasts: [],
    risk: riskEngine.getLast(),
    scenario: 'NORMAL',
    mqttBroker: null,
    mqttIngestion: null,
    homography: {},
  };

  // ── Core loop pieces ──────────────────────────────────────────────────────
  const broadcastPermits = () => io.emit('permits:updated', permitStore.getPermits());

  let compoundKeys = new Set();
  function recomputeRisk() {
    state.forecasts = forecastAll(state.sensors);
    const risk = riskEngine.analyze({
      sensors: state.sensors,
      permitsByZone: permitStore.getActivePermitsByZone(),
      vision: vision.liveByZone(),
      workers: workerSim.getAllWorkers(),
      shift: shiftInfo,
      forecasts: state.forecasts,
      emergencyZones: emergency.getState().active ? emergency.getState().affectedZones : [],
    });
    state.risk = risk;
    io.emit('risk:update', risk);

    // Compound risks → routed alerts (keyed so repeats refresh instead of duplicating)
    const keys = new Set();
    for (const a of risk.alerts) {
      const key = `COMPOUND:${a.id}`;
      keys.add(key);
      alerts.raise({
        key, type: 'COMPOUND_RISK', severity: a.severity, title: a.name, message: a.details,
        zone: a.affectedZones[0], source: `risk:${a.ruleId}`,
        details: { ruleId: a.ruleId, zones: a.affectedZones, chains: a.chains, sensors: a.sensors, permits: a.permits, aiRecommendation: a.aiRecommendation },
        regulations: [a.regulation], recommendedActions: a.recommendedActions,
      });
    }
    compoundKeys.forEach(k => { if (!keys.has(k)) alerts.clear(k); });
    compoundKeys = keys;

    // Autonomous reflex: critical compound risk in a red zone → emergency response
    const critical = risk.alerts.find(a => a.severity === 'CRITICAL' && a.affectedZones.some(z => (risk.zoneScores[z]?.score || 0) >= 80));
    if (critical) {
      if (emergency.getState().active) emergency.extend(critical.affectedZones, critical.name, critical.id);
      else if (emergency.shouldAutoTrigger(critical.id)) {
        emergency.trigger('LEVEL_2', `${critical.name}: ${critical.details}`, critical.affectedZones, state.sensors, { auto: true, key: critical.id });
      }
    }
    return risk;
  }

  function sensorAlerts(readings) {
    for (const s of readings) {
      const key = `SENSOR:${s.id}`;
      if (s.status === 'NORMAL') { alerts.clear(key); continue; }
      alerts.raise({
        key, type: 'SENSOR', severity: s.status === 'CRITICAL' ? 'HIGH' : 'MEDIUM', zone: s.zone, source: 'iot',
        title: `${s.type} ${s.status.toLowerCase()} — ${s.id}`,
        message: `${s.type} at ${s.id} reads ${s.value} ${s.unit} (warning ${s.warningThreshold}, critical ${s.criticalThreshold}).`,
        details: { sensorId: s.id, value: s.value, unit: s.unit },
        regulations: s.type === 'O2' ? ['Factories Act 1948, Section 36'] : ['OISD-STD-105'],
      });
    }
  }

  vision.onFire((d) => {
    if (!config.vision.autoEmergencyOnFire) return;
    if (emergency.getState().active) emergency.extend([d.zone], `Fire detected on CCTV ${d.camera_id}`, `FIRE:${d.zone}`);
    else if (emergency.shouldAutoTrigger(`FIRE:${d.zone}`)) {
      emergency.trigger('LEVEL_2', `Fire detected on CCTV ${d.camera_id} in ${d.zone_name}`, [d.zone], state.sensors, { auto: true, key: `FIRE:${d.zone}` });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // REST API
  // ════════════════════════════════════════════════════════════════════════
  const api = express.Router();
  const ingestLimiter = rateLimit('ingest', 120, 10000);
  const writeLimiter = rateLimit('write', 60, 60000);
  const llmLimiter = rateLimit('llm', 20, 60000);

  api.get('/health', (req, res) => res.json({
    status: 'ok', version: VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000), timestamp: new Date().toISOString(),
    services: {
      sensors: state.sensors.length, scada: true, mqtt: !!state.mqttBroker,
      llm: { configured: llm.isConfigured(), lastModel: llm.stats.lastModel, failures: llm.stats.failures },
      vision: { camerasOnline: Object.keys(vision.liveByZone()).length, received: vision.stats.received },
      notifications: notifier.channels(),
    },
  }));

  // Layout / spatial
  api.get('/plant-layout', (req, res) => res.json(plantLayout));
  api.get('/spatial/zones', (req, res) => res.json({ zones: plantLayout.zones, plant: plantLayout.plant, cameras: plantLayout.cameras, bounds: { width: 1180, height: 640 }, adjacency: Object.fromEntries(Object.entries(kg.adjacency).map(([k, v]) => [k, [...v]])) }));
  api.post('/spatial/calibrate', writeLimiter, (req, res) => {
    const { camera_id, matrix, src_points, dst_points } = req.body || {};
    if (!camera_id || !Array.isArray(matrix) || matrix.length !== 3) return res.status(400).json({ error: 'camera_id and 3×3 matrix required' });
    state.homography[camera_id] = { matrix, src_points, dst_points, updated_at: new Date().toISOString() };
    io.emit('spatial:calibration_updated', { camera_id });
    res.json({ status: 'ok', camera_id });
  });
  api.get('/spatial/homography', (req, res) => res.json(state.homography));

  // Telemetry
  api.get('/sensors', (req, res) => res.json(state.sensors));
  api.get('/forecasts', (req, res) => res.json(state.forecasts));
  api.get('/scada/state', (req, res) => res.json(state.scada));
  api.get('/scada/registers', (req, res) => {
    let regs = state.scada.registers || [];
    if (req.query.zone) regs = regs.filter(r => r.zone === req.query.zone);
    if (req.query.type) regs = regs.filter(r => r.type === req.query.type);
    res.json({ count: regs.length, registers: regs, timestamp: state.scada.timestamp });
  });
  api.get('/scada/equipment', (req, res) => res.json({ equipment: state.scada.equipment, timestamp: state.scada.timestamp, baselines: scadaBaselines.scada_equipment }));
  api.get('/scada/register/:address', (req, res) => {
    const address = parseInt(req.params.address, 10);
    const reg = (state.scada.registers || []).find(r => r.address === address);
    if (!reg) return res.status(404).json({ error: `Register ${address} not found` });
    res.json({ ...reg, source: 'modbus_tcp (simulated)', protocol: address < 40000 ? 'input_register' : 'holding_register' });
  });
  api.get('/scada/baselines', (req, res) => res.json(scadaBaselines));
  api.get('/workers', (req, res) => res.json(workerSim.getAllWorkers()));
  api.get('/shift', (req, res) => res.json(shiftInfo));

  // Vision
  const ingest = (req, res) => {
    const result = vision.ingest(req.body, 'http');
    if (!result.ok) return res.status(400).json({ error: result.error });
    const d = result.detection;
    res.json({ status: 'ok', zone: d.zone, required_ppe: d.required_ppe, ppe_violations: d.ppe_violations, events: d.events.map(e => e.type) });
  };
  api.post('/vision/detections', ingestLimiter, ingest);
  api.post('/cctv/detection', ingestLimiter, ingest);  // legacy path
  api.get('/vision/state', (req, res) => res.json(vision.summary()));
  api.get('/vision/requirements', (req, res) => res.json(vision.requirementsTable()));
  api.get('/vision/zones/:zone', (req, res) => {
    const d = vision.byZone[req.params.zone];
    res.json(d ? { ...d, stale: Date.now() - d.receivedAt > config.vision.staleMs } : { zone: req.params.zone, worker_count: 0, message: 'No CV data for this zone' });
  });
  api.get('/cctv/zones', (req, res) => res.json(vision.summary()));

  // Alerts
  api.get('/alerts', (req, res) => res.json(alerts.list({ status: req.query.status, type: req.query.type, zone: req.query.zone, limit: Math.min(300, Number(req.query.limit) || 100) })));
  api.get('/alerts/stats', (req, res) => res.json(alerts.stats()));
  api.get('/alerts/:id', (req, res) => {
    const a = alerts.get(req.params.id);
    return a ? res.json(alerts.public(a, true)) : res.status(404).json({ error: 'Alert not found' });
  });
  api.post('/alerts/:id/ack', writeLimiter, (req, res) => {
    const a = alerts.acknowledge(req.params.id, String(req.body?.by || 'Control Room').slice(0, 60));
    return a ? res.json(alerts.public(a, false)) : res.status(404).json({ error: 'Alert not found' });
  });
  api.post('/alerts/:id/resolve', writeLimiter, (req, res) => {
    const a = alerts.resolve(req.params.id, String(req.body?.by || 'Control Room').slice(0, 60), String(req.body?.note || '').slice(0, 300));
    return a ? res.json(alerts.public(a, false)) : res.status(404).json({ error: 'Alert not found' });
  });
  api.post('/notifications/test', writeLimiter, asyncRoute(async (req, res) => {
    const log = await notifier.dispatch({ id: 'TEST', type: 'TEST', severity: 'LOW', title: 'SafeForge test notification', message: 'If you can read this, alert delivery is configured correctly.', recipients: [] });
    res.json({ channels: notifier.channels(), log });
  }));

  // Permits
  const validationCtx = (zone) => ({ vision: vision.liveByZone(), requiredPPE: vision.requiredPPE(zone).items });
  api.get('/permits', (req, res) => res.json(permitStore.getPermits({ status: req.query.status, zone: req.query.zone })));
  api.post('/permits/validate', llmLimiter, asyncRoute(async (req, res) => res.json(await permitAgent.validatePermit(req.body || {}, state.sensors, validationCtx(req.body?.zone)))));
  api.post('/permits/:type/validate', llmLimiter, asyncRoute(async (req, res) => res.json(await permitAgent.validatePermit({ type: req.params.type, ...(req.body || {}) }, state.sensors, validationCtx(req.body?.zone)))));
  api.post('/permits', writeLimiter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const validation = await permitAgent.validatePermit(body, state.sensors, validationCtx(body.zone));
    let permit;
    try {
      permit = permitStore.createPermit({ ...body, aiValidated: true, aiWarnings: [...validation.violations, ...validation.warnings].map(v => v.message), riskScore: validation.riskScore });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    broadcastPermits();
    res.json({ permit, validation });
  }));
  api.patch('/permits/:id/status', writeLimiter, asyncRoute(async (req, res) => {
    const { status, by, force } = req.body || {};
    const current = permitStore.getPermitById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Permit not found' });
    if (status === 'ACTIVE' && !force) {
      const validation = await permitAgent.validatePermit(current, state.sensors, validationCtx(current.zone));
      if (!validation.canApprove) return res.status(409).json({ error: 'Blocked by permit intelligence', validation });
    }
    const permit = permitStore.updatePermitStatus(req.params.id, status, by);
    if (!permit) return res.status(400).json({ error: `Invalid status ${status}` });
    broadcastPermits();
    recomputeRisk();
    res.json(permit);
  }));

  // Risk & knowledge graph
  api.get('/risk', (req, res) => res.json(state.risk));
  api.get('/risk/graph', (req, res) => res.json(kg.snapshot({
    sensors: state.sensors, permits: permitStore.getPermits(), workers: workerSim.getAllWorkers(),
    vision: vision.liveByZone(), alerts: state.risk.alerts, forecasts: state.forecasts,
  })));
  api.get('/risk/paths', (req, res) => res.json(kg.compoundPaths({ sensors: state.sensors, permits: permitStore.getPermits(), vision: vision.liveByZone(), forecasts: state.forecasts })));

  // Knowledge base
  api.post('/rag/query', llmLimiter, asyncRoute(async (req, res) => {
    const query = String(req.body?.query || '').trim().slice(0, 500);
    if (!query) return res.status(400).json({ error: 'Query required' });
    res.json(await rag.query(query));
  }));
  api.get('/incidents', (req, res) => res.json(incidents));
  api.get('/regulations', (req, res) => res.json(regulations));
  api.get('/compliance', (req, res) => res.json(compliance.audit({
    risk: state.risk, vision: vision.summary(), sensors: state.sensors, permits: permitStore.getPermits(),
    alertStats: alerts.stats(), alerts: alerts.list({ limit: 300 }), emergency: emergency.getState(),
  })));

  // Emergency
  api.post('/emergency/trigger', writeLimiter, asyncRoute(async (req, res) => {
    const { level, cause, affectedZones } = req.body || {};
    res.json(await emergency.trigger(level || 'LEVEL_2', String(cause || 'Manual trigger').slice(0, 300), Array.isArray(affectedZones) ? affectedZones : [], state.sensors));
  }));
  api.post('/emergency/reset', writeLimiter, (req, res) => {
    const s = emergency.reset();
    const a = alerts.list({ type: 'EMERGENCY' }).find(x => x.status !== 'RESOLVED');
    if (a) alerts.resolve(a.id, 'Control Room', 'Emergency stood down');
    res.json(s);
  });
  api.get('/emergency/state', (req, res) => res.json(emergency.getState()));

  // Demo control
  const setScenario = (scenario) => {
    sensorSim.setScenario(scenario);
    scadaSim.setScenario(scenario);
    state.scenario = scenario;
    io.emit('scenario:changed', { scenario });
  };
  api.post('/scenario', writeLimiter, (req, res) => {
    try { setScenario(req.body?.scenario || 'NORMAL'); } catch (err) { return res.status(400).json({ error: err.message }); }
    res.json({ success: true, scenario: state.scenario });
  });
  api.get('/scenario', (req, res) => res.json({ scenario: state.scenario }));
  // Guided kill-chain: 1) silent gas drift  2) hot-work permit issued on paper (bypasses validation)  3) reset
  api.post('/demo/kill-chain', writeLimiter, (req, res) => {
    const step = req.body?.step;
    const hotWork = permitStore.getPermits().find(p => p.type === 'HOT_WORK' && p.zone === 'Z-01');
    if (step === 'drift') {
      setScenario('KILL_CHAIN');
      return res.json({ step, message: 'CH4 in the Crude Distillation Unit (Z-01) is drifting upward but stays below its 10 % LEL alarm.' });
    }
    if (step === 'permit') {
      if (hotWork && hotWork.status !== 'ACTIVE') permitStore.updatePermitStatus(hotWork.id, 'ACTIVE', 'Deepika Patel (paper permit)');
      broadcastPermits();
      const risk = recomputeRisk();
      return res.json({ step, message: `Hot-work permit ${hotWork?.id} activated in Z-01 without live gas validation.`, riskScore: risk.riskScore, status: risk.status });
    }
    if (step === 'reset') {
      setScenario('NORMAL');
      permitStore.resetPermits();
      emergency.reset();
      emergency.lastAutoKey = null;
      vision.reset();
      alerts.alerts.filter(a => a.status !== 'RESOLVED').forEach(a => alerts.resolve(a.id, 'Demo reset'));
      broadcastPermits();
      recomputeRisk();
      return res.json({ step, message: 'Demo reset to baseline.' });
    }
    res.status(400).json({ error: 'step must be drift | permit | reset' });
  });

  api.get('/mqtt/status', (req, res) => res.json({
    brokerRunning: !!state.mqttBroker, brokerStats: state.mqttBroker?.getStats() ?? null,
    ingestion: state.mqttIngestion?.getStatus() ?? null, port: config.mqtt.port,
  }));

  app.use('/api', api);
  app.get('/', (req, res) => res.json({ name: 'SafeForge Nexus API', version: VERSION, docs: '/api/health' }));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error('[API]', err);
    res.status(500).json({ error: 'Internal error' });
  });

  // ════════════════════════════════════════════════════════════════════════
  // WebSocket
  // ════════════════════════════════════════════════════════════════════════
  io.on('connection', (socket) => {
    socket.emit('sensors:initial', state.sensors);
    socket.emit('workers:initial', workerSim.getAllWorkers());
    socket.emit('permits:initial', permitStore.getPermits());
    socket.emit('shift:info', shiftInfo);
    socket.emit('emergency:state', emergency.getState());
    socket.emit('scada:initial', state.scada);
    socket.emit('risk:update', state.risk);
    socket.emit('cv:initial', vision.liveByZone());
    socket.emit('alerts:initial', alerts.list({ limit: 60 }));
    socket.emit('alerts:stats', alerts.stats());
    socket.emit('scenario:changed', { scenario: state.scenario });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════════
  const timers = [];
  sensorSim.on('readings', (readings) => {
    state.sensors = readings;
    io.emit('sensors:update', readings);
    sensorAlerts(readings);
    recomputeRisk();
    if (state.mqttBroker) {
      const byZone = {};
      readings.forEach(r => { (byZone[r.zone] = byZone[r.zone] || {})[r.type] = { value: r.value, unit: r.unit, status: r.status }; });
      Object.entries(byZone).forEach(([zone, data]) => state.mqttBroker.publish(`plant/${zone}/telemetry`, data));
    }
  });
  workerSim.on('locations', (w) => io.emit('workers:update', w));
  scadaSim.on('scada:update', (s) => {
    state.scada = s;
    io.emit('scada:update', s);
    const crit = s.registers.filter(r => r.status === 'CRITICAL');
    if (crit.length && state.mqttBroker) state.mqttBroker.publish('plant/scada/alarms', { critical: crit, timestamp: s.timestamp });
  });

  async function startMqtt() {
    if (!config.mqtt.enabled) return;
    try {
      const MqttBroker = require('./mqtt/broker');
      const { MqttIngestion } = require('./mqtt/ingestion');
      const broker = new MqttBroker(config.mqtt.port);
      await broker.start();
      state.mqttBroker = broker;
      scadaSim.broker = broker;
      state.mqttIngestion = new MqttIngestion({
        port: config.mqtt.port, io,
        onVision: (payload) => vision.ingest(payload, 'mqtt'),
        onEmergency: (p) => emergency.trigger(p.level || 'LEVEL_2', p.cause || 'External emergency signal (MQTT)', p.zones || [], state.sensors),
      });
      state.mqttIngestion.connect();
    } catch (err) {
      console.warn(`[MQTT] Broker not started (${err.message}) — continuing without MQTT`);
    }
  }

  function start(port = config.port) {
    return new Promise((resolve) => {
      server.listen(port, async () => {
        sensorSim.start(config.simulation.sensorMs);
        workerSim.start(config.simulation.workerMs);
        scadaSim.start(config.simulation.scadaMs);
        timers.push(setInterval(() => vision.sweep(), 5000));
        recomputeRisk();
        await startMqtt();
        resolve(server.address().port);
      });
    });
  }

  async function stop() {
    sensorSim.stop(); workerSim.stop(); scadaSim.stop();
    timers.forEach(clearInterval);
    emergency.reset();
    state.mqttIngestion?.close();
    if (state.mqttBroker) await state.mqttBroker.stop();
    io.close();
    await new Promise(r => server.close(() => r()));
  }

  return { app, server, io, state, start, stop, alerts, vision, riskEngine, emergency, sensorSim, recomputeRisk, permitStore };
}

module.exports = { createPlatform };
