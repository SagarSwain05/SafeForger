// End-to-end tests against an isolated platform instance (no LLM, no MQTT, random port).
process.env.MQTT_ENABLED = 'false';
for (let i = 1; i <= 5; i++) process.env[`GEMINI_KEY_${i}`] = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.ALERT_WEBHOOK_URL = '';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/platform');

let platform, base;
const api = async (path, opts = {}) => {
  const res = await fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json() };
};

/** Fast-forward the sensor simulator by n ticks (2 s each) without waiting in real time. */
function fastForward(n) {
  let t = Date.now() - n * 2000;
  for (let i = 0; i < n; i++) { t += 2000; platform.sensorSim._step(t); }
  platform.sensorSim.readings = platform.sensorSim._snapshot();
  platform.state.sensors = platform.sensorSim.readings;
}

before(async () => {
  platform = createPlatform();
  const port = await platform.start(0);
  base = `http://127.0.0.1:${port}/api`;
});
after(async () => { await platform.stop(); });

test('health reports services', async () => {
  const { status, body } = await api('/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.services.sensors, 11);
  assert.equal(body.services.llm.configured, false);
});

test('baseline plant is calm', async () => {
  const { body } = await api('/risk');
  assert.ok(body.riskScore < 45, `baseline risk ${body.riskScore}`);
  assert.ok(!body.alerts.some(a => a.severity === 'CRITICAL'));
});

test('permit intelligence blocks hot work into a gas build-up', async () => {
  platform.sensorSim.setScenario('KILL_CHAIN');
  fastForward(40);
  const ch4 = platform.state.sensors.find(s => s.id === 'S-GAS-01');
  assert.equal(ch4.status, 'NORMAL', 'drift must stay below the alarm level');
  assert.ok(ch4.value > 6, `CH4 should have drifted, got ${ch4.value}`);
  const { body } = await api('/permits/validate', { method: 'POST', body: { type: 'HOT_WORK', zone: 'Z-01' } });
  assert.equal(body.canApprove, false);
  assert.equal(body.decision, 'BLOCK');
});

test('activating a blocked permit without force is refused', async () => {
  const hot = (await api('/permits')).body.find(p => p.type === 'HOT_WORK');
  const { status } = await api(`/permits/${hot.id}/status`, { method: 'PATCH', body: { status: 'ACTIVE' } });
  assert.equal(status, 409);
});

test('kill chain: paper permit → compound risk → autonomous emergency → permit suspended', async () => {
  const { body } = await api('/demo/kill-chain', { method: 'POST', body: { step: 'permit' } });
  assert.equal(body.status, 'CRITICAL');
  const risk = platform.state.risk;
  assert.ok(risk.alerts.some(a => a.ruleId === 'CR-001'), 'CR-001 must fire');
  assert.ok(risk.zoneScores['Z-01'].score >= 80);
  const em = (await api('/emergency/state')).body;
  assert.equal(em.active, true);
  assert.equal(em.auto, true);
  assert.deepEqual(em.affectedZones, ['Z-01']);
  await new Promise(r => setTimeout(r, 1500));
  const hot = (await api('/permits')).body.find(p => p.type === 'HOT_WORK');
  assert.equal(hot.status, 'SUSPENDED');
  const alerts = (await api('/alerts?type=COMPOUND_RISK')).body;
  const cr1 = alerts.find(a => a.details.ruleId === 'CR-001');
  assert.ok(cr1 && cr1.recipients.some(r => r.role === 'Safety Officer'));
});

test('demo reset restores baseline', async () => {
  await api('/demo/kill-chain', { method: 'POST', body: { step: 'reset' } });
  const em = (await api('/emergency/state')).body;
  assert.equal(em.active, false);
  const hot = (await api('/permits')).body.find(p => p.type === 'HOT_WORK');
  assert.equal(hot.status, 'PENDING');
});

const visionPayload = (over = {}) => ({
  camera_id: 'CAM-03', source: 'test', timestamp: new Date().toISOString(),
  workers: [
    { id: 'W01', bbox: [0, 0, 10, 10], confidence: 0.9, ppe: { helmet: 'missing', vest: 'ok', boots: 'unknown' } },
    { id: 'W02', bbox: [20, 0, 30, 10], confidence: 0.9, ppe: { helmet: 'ok', vest: 'ok', boots: 'ok' } },
  ],
  fire_detected: false, smoke_detected: false,
  events: [{ type: 'PPE_VIOLATION' }],
  ...over,
});

test('vision ingest validates input', async () => {
  assert.equal((await api('/vision/detections', { method: 'POST', body: {} })).status, 400);
  assert.equal((await api('/vision/detections', { method: 'POST', body: { camera_id: 'CAM-X' } })).status, 400);
});

test('PPE violation → routed alert with location and regulations', async () => {
  const r = await api('/vision/detections', { method: 'POST', body: visionPayload() });
  assert.equal(r.status, 200);
  assert.equal(r.body.zone, 'Z-07');
  assert.equal(r.body.ppe_violations, 1);
  const a = (await api('/alerts?type=PPE_VIOLATION')).body[0];
  assert.equal(a.zone, 'Z-07');
  assert.equal(a.cameraId, 'CAM-03');
  assert.ok(a.location && a.location.x > 0);
  assert.ok(a.regulations.includes('IS 2925'));
  assert.equal(a.severity, 'HIGH');  // active electrical-isolation permit in Z-07
  const state = (await api('/vision/state')).body;
  assert.equal(state.camerasOnline, 1);
  assert.equal(state.ppeCompliancePct, 50);
});

test('effective PPE includes permit-driven items', async () => {
  const req = (await api('/vision/requirements')).body;
  assert.ok(req['Z-07'].items.includes('gloves'), 'electrical isolation permit requires gloves');
  assert.ok(!req['Z-05'].items.length, 'control room needs no PPE');
});

test('fire on CCTV → critical alert, auto emergency, ack/resolve lifecycle', async () => {
  const evidence = 'data:image/jpeg;base64,' + Buffer.from('fake').toString('base64');
  await api('/vision/detections', { method: 'POST', body: visionPayload({ camera_id: 'CAM-05', workers: [], fire_detected: true, fire_confidence: 0.82, events: [{ type: 'FIRE' }], evidence }) });
  const fire = (await api('/alerts?type=FIRE')).body[0];
  assert.equal(fire.severity, 'CRITICAL');
  assert.equal(fire.zone, 'Z-13');
  assert.equal(fire.hasEvidence, true);
  const full = (await api(`/alerts/${fire.id}`)).body;
  assert.ok(full.evidence.startsWith('data:image/jpeg'));
  assert.equal((await api('/emergency/state')).body.active, true);

  const ack = (await api(`/alerts/${fire.id}/ack`, { method: 'POST', body: { by: 'Priya Nair' } })).body;
  assert.equal(ack.status, 'ACKNOWLEDGED');
  const res = (await api(`/alerts/${fire.id}/resolve`, { method: 'POST', body: { by: 'Priya Nair' } })).body;
  assert.equal(res.status, 'RESOLVED');
  assert.ok((await api('/alerts/stats')).body.meanTimeToAcknowledgeSec !== null);
  await api('/emergency/reset', { method: 'POST' });
});

test('repeat detections refresh one alert instead of duplicating', async () => {
  const before = (await api('/alerts?type=PPE_VIOLATION')).body.length;
  for (let i = 0; i < 5; i++) await api('/vision/detections', { method: 'POST', body: visionPayload() });
  const list = (await api('/alerts?type=PPE_VIOLATION')).body;
  assert.equal(list.length, before);
  assert.ok(list[0].occurrences >= 5);
});

test('RAG retrieval works without an LLM', async () => {
  const { body } = await api('/rag/query', { method: 'POST', body: { query: 'worker without helmet near overhead work' } });
  assert.equal(body.mode, 'retrieval');
  assert.ok(body.sources.length > 0);
  assert.ok(body.sources.some(s => /2925|111|155|Struck/.test(`${s.code} ${s.title}`)));
});

test('compliance audit is derived from live state', async () => {
  const { body } = await api('/compliance');
  assert.ok(body.items.length >= 8);
  assert.ok(body.items.find(i => i.id === 'COMP-004').evidence.includes('worker'));
  assert.ok(typeof body.overallScore === 'number');
});

test('knowledge graph snapshot has typed nodes and edges', async () => {
  const { body } = await api('/risk/graph');
  const types = new Set(body.nodes.map(n => n.type));
  ['ZONE', 'SENSOR', 'PERMIT', 'CCTV'].forEach(t => assert.ok(types.has(t), `missing ${t}`));
  assert.ok(body.edges.length > 10);
});

test('a second critical incident extends the active emergency and suspends its permits', async () => {
  await api('/demo/kill-chain', { method: 'POST', body: { step: 'reset' } });
  // Incident 1: fire on CCTV in the loading bay → automatic emergency
  await api('/vision/detections', { method: 'POST', body: visionPayload({ camera_id: 'CAM-05', workers: [], fire_detected: true, fire_confidence: 0.8, events: [{ type: 'FIRE' }] }) });
  assert.deepEqual((await api('/emergency/state')).body.affectedZones, ['Z-13']);
  // Incident 2: kill chain in the CDU while the emergency is active
  platform.sensorSim.setScenario('KILL_CHAIN');
  fastForward(40);
  await api('/demo/kill-chain', { method: 'POST', body: { step: 'permit' } });
  const em = (await api('/emergency/state')).body;
  assert.ok(em.affectedZones.includes('Z-01'), `zones ${em.affectedZones}`);
  const hot = (await api('/permits')).body.find(p => p.type === 'HOT_WORK');
  assert.equal(hot.status, 'SUSPENDED');
  assert.ok(em.timeline.some(e => e.title.includes('EXTENDED')));
  await api('/demo/kill-chain', { method: 'POST', body: { step: 'reset' } });
  assert.equal((await api('/vision/state')).body.camerasOnline, 0, 'demo reset clears camera state');
});
