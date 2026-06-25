// SafeForger Backend — Phase 1 Enhanced Server
// Integrates: MQTT broker, SCADA simulator, CV detection API, spatial homography
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// ── Agents & Simulators ─────────────────────────────────────────────────────
const SensorSimulator = require('./simulation/SensorSimulator');
const { WorkerSimulator } = require('./simulation/WorkerSimulator');
const ScadaSimulator = require('./simulation/ScadaSimulator');
const CompoundRiskOrchestrator = require('./agents/CompoundRiskOrchestrator');
const RAGAgent = require('./agents/RAGAgent');
const EmergencyOrchestrator = require('./agents/EmergencyOrchestrator');
const PermitAgent = require('./agents/PermitAgent');

// ── MQTT ─────────────────────────────────────────────────────────────────────
let mqttBroker = null;
let mqttIngestion = null;
const initMqtt = async (io) => {
  try {
    const MqttBroker = require('./mqtt/broker');
    const { MqttIngestion } = require('./mqtt/ingestion');
    mqttBroker = new MqttBroker();
    await mqttBroker.start();
    mqttIngestion = new MqttIngestion(io);
    // Small delay so broker is ready before client connects
    setTimeout(() => {
      mqttIngestion.connect();
      console.log('[MQTT] Ingestion bridge connected');
    }, 800);
  } catch (err) {
    console.warn('[MQTT] Could not start broker (aedes may not be installed):', err.message);
    console.warn('[MQTT] Continuing without MQTT — run: npm install aedes mqtt');
  }
};

// ── Data ─────────────────────────────────────────────────────────────────────
const { getPermits, createPermit, updatePermitStatus, getActivePermitsByZone, detectSimops } = require('./data/permitStore');
const plantLayout = require('./data/plant-layout.json');
const incidents = require('./data/incidents.json');
const regulations = require('./data/regulations.json');
const scadaBaselines = require('./data/scada-baselines.json');

// ── Express + Socket.io Setup ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST', 'PATCH'] }
});
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '2mb' }));

// ── Initialize Agents ────────────────────────────────────────────────────────
const sensorSim = new SensorSimulator();
const workerSim = new WorkerSimulator();
const riskOrchestrator = new CompoundRiskOrchestrator();
const ragAgent = new RAGAgent();
const emergencyOrchestrator = new EmergencyOrchestrator(io);
const permitAgent = new PermitAgent();
const scadaSim = new ScadaSimulator(mqttBroker);

let lastSensorReadings = sensorSim.getAllReadings();
let lastScadaState = scadaSim.getState();
let lastCvDetections = {}; // zone_id → latest CV detection

const shiftInfo = {
  current: 'A', supervisor: 'Deepika Patel',
  startTime: new Date(Date.now() - 3 * 3600000).toISOString(),
  workersOnSite: 12, nextChange: new Date(Date.now() + 5 * 3600000).toISOString()
};

// ════════════════════════════════════════════════════════════════════════════
// REST Routes
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => res.json({
  status: 'ok', timestamp: new Date().toISOString(),
  services: {
    sensors: lastSensorReadings.length > 0,
    scada: true,
    mqtt: !!mqttBroker,
    cvDetections: Object.keys(lastCvDetections).length,
  }
}));

// ── Plant Layout ─────────────────────────────────────────────────────────────
app.get('/api/plant-layout', (req, res) => res.json(plantLayout));

// ── IoT Sensors ──────────────────────────────────────────────────────────────
app.get('/api/sensors', (req, res) => res.json(lastSensorReadings));

// ── SCADA ─────────────────────────────────────────────────────────────────────
app.get('/api/scada/state', (req, res) => res.json(lastScadaState));

app.get('/api/scada/registers', (req, res) => {
  const registers = lastScadaState.registers ?? [];
  const zone = req.query.zone;
  const type = req.query.type;
  let filtered = registers;
  if (zone) filtered = filtered.filter(r => r.zone === zone);
  if (type) filtered = filtered.filter(r => r.type === type);
  res.json({
    count: filtered.length,
    registers: filtered,
    timestamp: lastScadaState.timestamp,
  });
});

app.get('/api/scada/equipment', (req, res) => {
  res.json({
    equipment: lastScadaState.equipment ?? [],
    timestamp: lastScadaState.timestamp,
    baselines: scadaBaselines.scada_equipment,
  });
});

// Modbus register read (simulated OPC-UA / Modbus TCP)
app.get('/api/scada/register/:address', (req, res) => {
  const address = parseInt(req.params.address);
  const reg = (lastScadaState.registers ?? []).find(r => r.address === address);
  if (!reg) return res.status(404).json({ error: `Register ${address} not found` });
  res.json({ ...reg, source: 'modbus_tcp', protocol: address < 40000 ? 'input_register' : 'holding_register' });
});

// ── CV Detections ─────────────────────────────────────────────────────────────

// Receive detection events from Python CV service (HTTP bridge for non-MQTT scenarios)
app.post('/api/cctv/detection', (req, res) => {
  const { camera_id, zone, detections, worker_count, ppe_violations, smoke_detected, mapped_positions, zones_occupied, timestamp } = req.body;
  if (!camera_id) return res.status(400).json({ error: 'camera_id required' });

  const zoneKey = zone || 'UNKNOWN';
  lastCvDetections[zoneKey] = {
    camera_id, zone: zoneKey, worker_count: worker_count ?? 0,
    ppe_violations: ppe_violations ?? 0, smoke_detected: smoke_detected ?? false,
    detections: detections ?? [], mapped_positions: mapped_positions ?? [],
    zones_occupied: zones_occupied ?? [], receivedAt: Date.now(),
    timestamp: timestamp ?? new Date().toISOString(),
  };

  // Forward to WebSocket clients
  io.emit('cv:detection', lastCvDetections[zoneKey]);

  // Feed mapped positions into worker simulator for heatmap
  if (mapped_positions?.length > 0) {
    mapped_positions.forEach(pos => {
      if (pos.plant_coords && pos.zone_id) {
        io.emit('cv:worker_position', {
          source: 'cv',
          person_id: pos.person_id,
          x: pos.plant_coords[0], y: pos.plant_coords[1],
          zone_id: pos.zone_id,
          has_helmet: pos.has_helmet, has_vest: pos.has_vest,
        });
      }
    });
  }

  res.json({ status: 'ok', zone: zoneKey });
});

// Get all CV detection states per zone
app.get('/api/cctv/zones', (req, res) => {
  const summary = Object.entries(lastCvDetections).map(([zone, d]) => ({
    zone, camera_id: d.camera_id, worker_count: d.worker_count,
    ppe_violations: d.ppe_violations, smoke_detected: d.smoke_detected,
    zones_occupied: d.zones_occupied, age_ms: Date.now() - d.receivedAt,
    stale: (Date.now() - d.receivedAt) > 30000,
  }));
  const totalWorkers = summary.reduce((s, d) => s + (d.worker_count || 0), 0);
  const totalViolations = summary.reduce((s, d) => s + (d.ppe_violations || 0), 0);
  const smokeZones = summary.filter(d => d.smoke_detected).map(d => d.zone);
  res.json({ zones: summary, totalWorkers, totalViolations, smokeZones });
});

app.get('/api/cctv/detection/:zone', (req, res) => {
  const d = lastCvDetections[req.params.zone];
  if (!d) return res.json({ zone: req.params.zone, worker_count: 0, message: 'No CV data for this zone' });
  res.json(d);
});

// ── MQTT Status ──────────────────────────────────────────────────────────────
app.get('/api/mqtt/status', (req, res) => {
  res.json({
    brokerRunning: !!mqttBroker,
    brokerStats: mqttBroker?.getStats() ?? null,
    ingestionStatus: mqttIngestion?.getStatus() ?? null,
    port: 1883,
  });
});

// ── Spatial / Homography ─────────────────────────────────────────────────────
app.get('/api/spatial/zones', (req, res) => {
  res.json({
    zones: plantLayout.zones,
    plant: plantLayout.plant,
    bounds: { width: 1180, height: 640 },
  });
});

// Receive calibration matrix from calibration tool
app.post('/api/spatial/calibrate', (req, res) => {
  const { camera_id, matrix, src_points, dst_points } = req.body;
  if (!camera_id || !matrix) return res.status(400).json({ error: 'camera_id and matrix required' });
  // Store in memory (in production: persist to DB)
  if (!app.locals.homographyMatrices) app.locals.homographyMatrices = {};
  app.locals.homographyMatrices[camera_id] = { matrix, src_points, dst_points, updated_at: new Date().toISOString() };
  io.emit('spatial:calibration_updated', { camera_id });
  res.json({ status: 'ok', camera_id, message: 'Homography matrix stored' });
});

app.get('/api/spatial/homography', (req, res) => {
  res.json(app.locals.homographyMatrices ?? {});
});

// ── Workers ──────────────────────────────────────────────────────────────────
app.get('/api/workers', (req, res) => res.json(workerSim.getAllWorkers()));

// ── Permits ──────────────────────────────────────────────────────────────────
app.get('/api/permits', (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.zone) filter.zone = req.query.zone;
  res.json(getPermits(filter));
});

app.post('/api/permits', async (req, res) => {
  const validation = await permitAgent.validatePermit(req.body, lastSensorReadings);
  const permit = createPermit({ ...req.body, ...validation });
  res.json({ permit, validation });
});

app.post('/api/permits/:type/validate', async (req, res) => {
  const validation = await permitAgent.validatePermit(req.body, lastSensorReadings);
  res.json(validation);
});

app.post('/api/permits/:id/validate', async (req, res) => {
  const validation = await permitAgent.validatePermit(req.body, lastSensorReadings);
  res.json(validation);
});

app.patch('/api/permits/:id/status', (req, res) => {
  const permit = updatePermitStatus(req.params.id, req.body.status);
  io.emit('permits:updated', getPermits());
  res.json(permit);
});

// ── Risk Assessment ───────────────────────────────────────────────────────────
app.get('/api/risk', async (req, res) => {
  const risk = await riskOrchestrator.analyze(lastSensorReadings);
  res.json(risk);
});

app.get('/api/risk/graph', (req, res) => res.json(riskOrchestrator.getKnowledgeGraph()));

// ── RAG ───────────────────────────────────────────────────────────────────────
app.post('/api/rag/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  const result = await ragAgent.query(query);
  res.json(result);
});

app.get('/api/incidents', (req, res) => res.json(incidents));
app.get('/api/regulations', (req, res) => res.json(regulations));

// ── Emergency ─────────────────────────────────────────────────────────────────
app.post('/api/emergency/trigger', async (req, res) => {
  const { level, cause, affectedZones } = req.body;
  const state = await emergencyOrchestrator.trigger(
    level || 'LEVEL_2', cause || 'Manual trigger',
    affectedZones || ['Z-01'], lastSensorReadings
  );
  res.json(state);
});

app.post('/api/emergency/reset', (req, res) => {
  const state = emergencyOrchestrator.reset();
  io.emit('emergency:reset', state);
  res.json(state);
});

app.get('/api/emergency/state', (req, res) => res.json(emergencyOrchestrator.getState()));

// ── Shift ─────────────────────────────────────────────────────────────────────
app.get('/api/shift', (req, res) => res.json(shiftInfo));

// ── Scenario (Kill Chain demo) ────────────────────────────────────────────────
app.post('/api/scenario', (req, res) => {
  const { scenario } = req.body;
  sensorSim.setScenario(scenario);
  scadaSim.setScenario(scenario);
  io.emit('scenario:changed', { scenario });
  res.json({ success: true, scenario });
});

// ── Compliance ────────────────────────────────────────────────────────────────
app.get('/api/compliance', async (req, res) => {
  const simops = detectSimops();
  const criticalSensors = lastSensorReadings.filter(s => s.status === 'CRITICAL');
  const items = [
    { id: 'COMP-001', standard: 'OISD-STD-105', topic: 'Hot Work Permit System', status: criticalSensors.length > 0 ? 'NON_COMPLIANT' : 'COMPLIANT', score: criticalSensors.length > 0 ? 45 : 95, lastChecked: new Date().toISOString() },
    { id: 'COMP-002', standard: 'OISD-GDN-169', topic: 'Confined Space Procedures', status: 'COMPLIANT', score: 88, lastChecked: new Date().toISOString() },
    { id: 'COMP-003', standard: 'OISD-STD-118', topic: 'Instrumentation & Calibration', status: 'OBSERVATION', score: 72, lastChecked: new Date().toISOString() },
    { id: 'COMP-004', standard: 'DGMS Circular 6/2018', topic: 'SIMOPS Risk Assessment', status: simops.length > 0 ? 'NON_COMPLIANT' : 'COMPLIANT', score: simops.length > 0 ? 50 : 92, lastChecked: new Date().toISOString() },
    { id: 'COMP-005', standard: 'Factory Act Section 36', topic: 'Confined Space Entry Standards', status: 'COMPLIANT', score: 90, lastChecked: new Date().toISOString() },
    { id: 'COMP-006', standard: 'OISD-GDN-192', topic: 'Shift Handover Procedures', status: 'OBSERVATION', score: 68, lastChecked: new Date().toISOString() },
  ];
  const overallScore = Math.round(items.reduce((s, i) => s + i.score, 0) / items.length);
  res.json({ items, overallScore, lastAudit: new Date().toISOString() });
});

// ── SCADA Baselines (public dataset info) ─────────────────────────────────────
app.get('/api/scada/baselines', (req, res) => res.json(scadaBaselines));

// ════════════════════════════════════════════════════════════════════════════
// WebSocket Events
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);
  socket.emit('sensors:initial', lastSensorReadings);
  socket.emit('workers:initial', workerSim.getAllWorkers());
  socket.emit('permits:initial', getPermits());
  socket.emit('shift:info', shiftInfo);
  socket.emit('emergency:state', emergencyOrchestrator.getState());
  socket.emit('scada:initial', lastScadaState);
  socket.emit('mqtt:status', { brokerRunning: !!mqttBroker });
  socket.emit('cv:initial', lastCvDetections);

  socket.on('disconnect', () => console.log('[Socket.io] Client disconnected:', socket.id));
});

// ════════════════════════════════════════════════════════════════════════════
// Real-time Loop
// ════════════════════════════════════════════════════════════════════════════

// IoT Sensors tick
sensorSim.on('readings', async (readings) => {
  lastSensorReadings = readings;
  io.emit('sensors:update', readings);

  // Publish sensor data to MQTT as well
  if (mqttBroker) {
    const byZone = {};
    readings.forEach(r => {
      if (!byZone[r.zone]) byZone[r.zone] = {};
      byZone[r.zone][r.type] = { value: r.value, unit: r.unit, status: r.status };
    });
    Object.entries(byZone).forEach(([zone, data]) => {
      mqttBroker.publish(`plant/${zone}/telemetry`, data);
    });
  }

  if (sensorSim.scenarioStep % 5 === 0) {
    const risk = await riskOrchestrator.analyze(readings);
    io.emit('risk:update', risk);

    const emergency = emergencyOrchestrator.getState();
    if (risk.status === 'CRITICAL' && !emergency.active && risk.riskScore >= 80) {
      const criticalAlert = risk.alerts.find(a => a.severity === 'CRITICAL');
      if (criticalAlert) {
        emergencyOrchestrator.trigger('LEVEL_2', criticalAlert.details, criticalAlert.affectedZones || [], readings);
      }
    }
  }
});

// Worker location tick
workerSim.on('locations', (locations) => {
  io.emit('workers:update', locations);
  // Publish worker positions to MQTT
  if (mqttBroker) {
    locations.forEach(w => {
      mqttBroker.publish(`plant/worker/${w.id}`, { id: w.id, x: w.x, y: w.y, zone: w.zoneId, name: w.name });
    });
  }
});

// SCADA tick every 3 seconds
scadaSim.on('scada:update', (state) => {
  lastScadaState = state;
  io.emit('scada:update', state);

  // Feed SCADA anomalies into MQTT
  if (mqttBroker) {
    const criticalRegs = state.registers.filter(r => r.status === 'CRITICAL');
    if (criticalRegs.length > 0) {
      mqttBroker.publish('plant/scada/alarms', {
        critical: criticalRegs.map(r => ({ name: r.name, value: r.value, unit: r.unit, zone: r.zone })),
        timestamp: state.timestamp,
      });
    }
  }
});

// MQTT CV detection → risk correlation
if (mqttIngestion) {
  mqttIngestion.onVision((zone, payload) => {
    lastCvDetections[zone] = { ...payload, zone, receivedAt: Date.now() };
    // Smoke detection → auto-escalate risk
    if (payload.smoke_detected) {
      console.log(`[CV] SMOKE DETECTED in zone ${zone} — escalating risk`);
      io.emit('risk:cv_alert', { type: 'SMOKE', zone, timestamp: new Date().toISOString() });
    }
    // PPE violations + active permit = compound risk
    if (payload.ppe_violations > 0) {
      const zonePermits = getActivePermitsByZone ? getActivePermitsByZone(zone) : [];
      if (zonePermits.length > 0) {
        io.emit('risk:cv_alert', {
          type: 'PPE_VIOLATION_WITH_ACTIVE_PERMIT',
          zone, violations: payload.ppe_violations, permits: zonePermits.map(p => p.id),
          severity: 'HIGH', timestamp: new Date().toISOString(),
        });
      }
    }
  });
}

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
server.listen(PORT, async () => {
  // Initialize MQTT after server starts
  await initMqtt(io);
  // Wire SCADA sim to MQTT broker after it starts
  setTimeout(() => {
    if (mqttBroker) scadaSim.broker = mqttBroker;
  }, 1500);

  sensorSim.start(2000);
  workerSim.start(1500);
  scadaSim.start(3000);

  console.log(`
╔══════════════════════════════════════════════════════╗
║   SafeForger Backend — Phase 1 ONLINE                 ║
║   Port:    ${PORT}                                      ║
║   IoT:     ${Object.keys(sensorSim.sensors ?? {}).length} sensor streams                         ║
║   SCADA:   Modbus register simulation (UCI/WUSTL)     ║
║   MQTT:    Embedded Aedes broker on port 1883         ║
║   CV API:  POST /api/cctv/detection                   ║
║   Python:  cd cv-service && ./start_cv.sh mock        ║
╚══════════════════════════════════════════════════════╝`);
});

module.exports = { app, server };
