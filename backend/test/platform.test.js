// End-to-end tests against an isolated platform instance (no LLM, no MQTT, no email, random port).
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.MQTT_ENABLED = 'false';
process.env.RATE_LIMIT_SCALE = '20';
for (let i = 1; i <= 5; i++) process.env[`GEMINI_KEY_${i}`] = '';
process.env.GEMINI_API_KEYS = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.ALERT_WEBHOOK_URL = '';
process.env.BREVO_API_KEY = '';
process.env.MONGO_URI = '';
process.env.MONGODB_URI = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'safeforge-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/platform');

const SITE = 'demo-refinery';
let platform, root, token;
const call = async (url, opts = {}, auth = token) => {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const api = (p, opts) => call(`${root}/sites/${SITE}${p}`, opts);   // site-scoped
const g = (p, opts, auth) => call(`${root}${p}`, opts, auth);        // global
const runtime = () => platform.ctx.sites.runtimes.get(SITE);

/** Fast-forward the sensor simulator by n ticks (2 s each) without waiting in real time. */
function fastForward(n) {
  const rt = runtime();
  let t = Date.now() - n * 2000;
  for (let i = 0; i < n; i++) { t += 2000; rt.sensorSim._step(t); }
  rt.sensorSim.readings = rt.sensorSim._snapshot();
  rt.state.sensors = rt.sensorSim.readings;
}

before(async () => {
  platform = createPlatform();
  const port = await platform.start(0);
  root = `http://127.0.0.1:${port}/api`;
  const login = await g('/auth/login', { method: 'POST', body: { email: 'safeforgerdemo@gmail.com', password: 'Safeforger@20226' } }, null);
  assert.equal(login.status, 200, JSON.stringify(login.body));
  token = login.body.token;
  await api('/risk');   // start the demo site runtime
});
after(async () => { await platform.stop(); });

test('demo account is seeded and wrong passwords are rejected', async () => {
  assert.ok(token);
  const me = await g('/auth/me');
  assert.equal(me.body.user.email, 'safeforgerdemo@gmail.com');
  assert.equal(me.body.user.isDemo, true);
  assert.equal((await g('/auth/login', { method: 'POST', body: { email: 'safeforgerdemo@gmail.com', password: 'nope12345' } }, null)).status, 401);
});

test('demo sessions survive a restart with fresh storage', async () => {
  const { createPlatform: make } = require('../src/platform');
  const fresh = make();
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'safeforge-test2-'));
  delete require.cache[require.resolve('../src/config')];
  const port = await fresh.start(0);
  const res = await call(`http://127.0.0.1:${port}/api/auth/me`);
  await fresh.stop();
  assert.equal(res.status, 200, 'token from the first instance is accepted by a fresh one');
});

test('site API requires authentication', async () => {
  assert.equal((await call(`${root}/sites/${SITE}/risk`, {}, null)).status, 401);
  assert.equal((await g('/sites', {}, null)).status, 401);
});

test('registration without email service activates the account', async () => {
  const r = await g('/auth/register', { method: 'POST', body: { name: 'Asha Rao', email: 'asha@example.com', password: 'Factory2026', role: 'Shift Supervisor', organization: 'Test Steel' } }, null);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.verificationRequired, false);
  assert.ok(r.body.token);
  assert.equal((await g('/auth/register', { method: 'POST', body: { name: 'x', email: 'asha@example.com', password: 'Factory2026' } }, null)).status, 409);
  assert.equal((await g('/auth/register', { method: 'POST', body: { name: 'x', email: 'weak@example.com', password: 'short' } }, null)).status, 400);
});

test('site catalogue lists real-facility presets across sectors', async () => {
  const { body } = await g('/sites');
  assert.ok(body.length >= 15);
  const sectors = new Set(body.map(s => s.sector));
  ['refinery', 'steel', 'power', 'mining', 'automotive'].forEach(x => assert.ok(sectors.has(x), x));
  assert.ok(body.some(s => s.id === 'rinl-vizag-steel'));
  assert.ok(!('ingestKey' in body[0]), 'catalogue never leaks ingest keys');
});

test('custom site: create, isolate from other users, ingest with key', async () => {
  const created = await g('/sites', { method: 'POST', body: {
    name: 'Ennore Test Works', company: 'Test Co', sector: 'steel', city: 'Chennai', state: 'Tamil Nadu',
    cameras: [{ label: 'Gate cam', zone: 'Z-03', sourceType: 'rtsp', url: 'rtsp://10.0.0.5/stream' }],
    contacts: [{ name: 'Kiran Das', role: 'Safety Officer', email: 'kiran@example.com' }],
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const detail = (await g(`/sites/${id}`)).body;
  assert.equal(detail.layout.zones[0].name, 'Coke Oven Battery');
  assert.equal(detail.layout.cameras[0].label, 'Gate cam');
  assert.ok(detail.ingestKey);

  const other = (await g('/auth/register', { method: 'POST', body: { name: 'Other', email: 'other@example.com', password: 'Factory2026' } }, null)).body.token;
  assert.equal((await g(`/sites/${id}`, {}, other)).status, 404);
  assert.equal((await call(`${root}/sites/${id}/risk`, {}, other)).status, 404);

  const payload = { camera_id: 'CAM-01', workers: [{ id: 'W1', bbox: [0, 0, 5, 5], confidence: 0.9, ppe: { helmet: 'missing' } }], events: [{ type: 'PPE_VIOLATION' }] };
  assert.equal((await call(`${root}/sites/${id}/vision/detections`, { method: 'POST', body: payload, headers: { 'X-API-Key': 'wrong' } }, null)).status, 401);
  const ok = await call(`${root}/sites/${id}/vision/detections`, { method: 'POST', body: payload, headers: { 'X-API-Key': detail.ingestKey } }, null);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.zone, 'Z-03');
  const alerts = (await call(`${root}/sites/${id}/alerts?type=PPE_VIOLATION`)).body;
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].recipients.some(r => r.name === 'Kiran Das'), 'site contacts are used for routing');
  // the demo site is unaffected
  assert.equal((await api('/alerts?type=PPE_VIOLATION')).body.length, 0);
  assert.equal((await g(`/sites/${id}`, { method: 'DELETE' })).status, 200);
});

test('shared demo account keeps only its 5 most recent custom sites', async () => {
  for (let i = 0; i < 7; i++) {
    const r = await g('/sites', { method: 'POST', body: { name: `Demo plant ${i}`, sector: 'cement' } });
    assert.equal(r.status, 201);
  }
  const mine = (await g('/sites')).body.filter(s => s.kind === 'custom' && s.canEdit);
  assert.equal(mine.length, 5);
  assert.ok(mine.some(s => s.name === 'Demo plant 6') && !mine.some(s => s.name === 'Demo plant 0'));
});

test('system status reports storage and email modes', async () => {
  const { body } = await g('/system/status', {}, null);
  assert.equal(body.status, 'ok');
  assert.equal(body.storage.kind, 'file');
  assert.equal(body.email.verification, false);
});

test('baseline plant is calm', async () => {
  const { body } = await api('/risk');
  assert.ok(body.riskScore < 45, `baseline risk ${body.riskScore}`);
  assert.ok(!body.alerts.some(a => a.severity === 'CRITICAL'));
});

test('permit intelligence blocks hot work into a gas build-up', async () => {
  runtime().sensorSim.setScenario('KILL_CHAIN');
  fastForward(40);
  const ch4 = runtime().state.sensors.find(s => s.id === 'S-GAS-01');
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
  const risk = runtime().state.risk;
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
  runtime().sensorSim.setScenario('KILL_CHAIN');
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

test('every simulated plant has its own layout, sensors, situation and numbers', async () => {
  const ids = ['rinl-vizag-steel', 'ntpc-simhadri', 'hpcl-visakh', 'secl-gevra', 'demo-pharma'];
  const sites = await Promise.all(ids.map(id => g(`/sites/${id}`).then(r => r.body)));
  const geoms = new Set(sites.map(s => JSON.stringify(s.layout.zones.map(z => [z.x, z.y, z.w, z.h]))));
  assert.equal(geoms.size, ids.length, 'map geometry differs per site');
  const plans = new Set(sites.map(s => s.layout.sensors.map(x => `${x.zone}:${x.type}`).join('|')));
  assert.ok(plans.size >= 4, 'sector sensor plans differ');
  const equipment = new Set(sites.map(s => s.layout.equipment.map(e => e.label).join('|')));
  assert.ok(equipment.size >= 4, 'sector equipment differs');
  const readings = await Promise.all(ids.map(id => call(`${root}/sites/${id}/sensors`).then(r => r.body.map(x => x.value).join(','))));
  assert.equal(new Set(readings).size, ids.length, 'live numbers differ');
  const situations = await Promise.all(ids.map(id => platform.ctx.sites.runtimes.get(id)?.profile.sim.situation?.title));
  assert.ok(situations.filter(Boolean).length >= 4, 'each plant has an active situation');
  const rosters = new Set(ids.map(id => platform.ctx.sites.runtimes.get(id).profile.roster.map(w => w.name).join(',')));
  assert.equal(rosters.size, ids.length, 'workforce differs');
});

test('real accounts: no demo plants, exactly one live facility, real inputs only', async () => {
  const reg = await g('/auth/register', { method: 'POST', body: { name: 'Plant Head', email: 'head@realplant.com', password: 'Factory2026', role: 'Plant Manager' } }, null);
  const t = reg.body.token;
  assert.deepEqual((await g('/sites', {}, t)).body, [], 'starts with no site');
  assert.equal((await call(`${root}/sites/demo-refinery/risk`, {}, t)).status, 404, 'demo plants are hidden from real accounts');
  const templates = (await g('/sites/templates', {}, t)).body;
  assert.ok(templates.some(x => x.id === 'jsw-vijayanagar'));

  const created = await g('/sites', { method: 'POST', body: { templateId: 'jsw-vijayanagar', contacts: [{ name: 'Lata Shetty', role: 'Safety Officer' }], members: ['teammate@realplant.com'] } }, t);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.mode, 'live');
  assert.equal(created.body.sector, 'steel');
  const second = await g('/sites', { method: 'POST', body: { name: 'Another', sector: 'cement' } }, t);
  assert.equal(second.status, 409, 'one facility per account');

  const id = created.body.id;
  const site = (await g(`/sites/${id}`, {}, t)).body;
  const S = (p, o = {}, a = t) => call(`${root}/sites/${id}${p}`, o, a);
  const sensors = (await S('/sensors')).body;
  assert.ok(sensors.length > 0 && sensors.every(x => x.value === null && x.status === 'OFFLINE'), 'no invented sensor values');
  assert.equal((await S('/permits')).body.length, 0, 'no seeded permits');
  assert.equal((await S('/workers')).body.length, 0, 'no simulated workers');
  assert.equal((await S('/scada/state')).body.connected, false);
  assert.equal((await S('/demo/kill-chain', { method: 'POST', body: { step: 'drift' } })).status, 409);
  const risk0 = (await S('/risk')).body;
  assert.equal(risk0.alerts.length, 0);

  // Gateway telemetry with the ingest key, then a manual handheld reading by the user
  const gas = sensors.find(x => x.type === 'CH4');
  const key = { headers: { 'X-API-Key': site.ingestKey } };
  const tel = await call(`${root}/sites/${id}/telemetry`, { method: 'POST', body: { readings: [{ sensorId: gas.id, value: 12.5 }, { sensorId: 'NEW-CO-1', type: 'CO', zone: 'Z-04', value: 8 }] }, ...key }, null);
  assert.equal(tel.status, 200, JSON.stringify(tel.body));
  assert.equal(tel.body.accepted, 2);
  const after = (await S('/sensors')).body;
  const g1 = after.find(x => x.id === gas.id);
  assert.equal(g1.status, 'WARNING');
  assert.equal(g1.online, true);
  assert.ok(after.some(x => x.id === 'NEW-CO-1'), 'gateway can register new detectors');
  assert.equal((await S('/telemetry', { method: 'POST', body: { sensorId: gas.id, value: 3.1 } })).status, 200, 'manual reading by a signed-in user');
  assert.ok((await S('/alerts?type=SENSOR')).body.length >= 1, 'a real warning raised a real alert');

  // SCADA gateway + badge presence
  assert.equal((await call(`${root}/sites/${id}/scada`, { method: 'POST', body: { equipment: [{ id: 'BF-1', label: 'Blast furnace 1', zone: 'Z-03', state: 'RUNNING', value: 1180, unit: '°C' }] }, ...key }, null)).status, 200);
  assert.equal((await S('/scada/state')).body.connected, true);
  assert.equal((await call(`${root}/sites/${id}/presence`, { method: 'POST', body: { workers: [{ id: 'B-77', name: 'Kiran', zone: 'Z-03' }] }, ...key }, null)).status, 200);
  assert.equal((await S('/workers')).body.length, 1);
  const conn = (await S('/connections')).body;
  assert.equal(conn.mode, 'live');
  assert.ok(conn.sensors.online >= 1 && conn.scada.connected && conn.presence.people === 1);

  // An invited teammate is attached to the same single facility
  const mate = (await g('/auth/register', { method: 'POST', body: { name: 'Mate', email: 'teammate@realplant.com', password: 'Factory2026' } }, null)).body.token;
  const mateSites = (await g('/sites', {}, mate)).body;
  assert.equal(mateSites.length, 1);
  assert.equal(mateSites[0].id, id);
  assert.equal((await g('/sites', { method: 'POST', body: { name: 'X', sector: 'cement' } }, mate)).status, 409);
});

test('sign-up plant linking: add a plant, own it, colleagues request to join, owner approves', async () => {
  const meta = (await g('/directory/meta', {}, null)).body;
  assert.ok(meta.states.length >= 36 && meta.sectors.some(s => s.id === 'manufacturing'));

  // Owner signs up with a plant that is not in the directory yet
  const plant = { newPlant: { name: 'Kakinada Agro Foods Unit 2', organization: 'Kakinada Agro', sector: 'manufacturing', district: 'Kakinada', state: 'Andhra Pradesh' } };
  const owner = (await g('/auth/register', { method: 'POST', body: { name: 'Owner One', email: 'owner@kagro.in', password: 'Factory2026', plant } }, null)).body.token;
  const fac = (await g('/me/facility', {}, owner)).body;
  assert.equal(fac.status, 'attached', JSON.stringify(fac));
  assert.equal(fac.site.mode, 'live');
  assert.equal(fac.site.sector, 'manufacturing');
  assert.equal(fac.site.name, 'Kakinada Agro Foods Unit 2');

  // The new plant is now searchable for everyone (case-insensitive, partial words)
  const found = (await g('/directory/search?q=kakinada agro', {}, null)).body.results;
  assert.ok(found.length >= 1 && found[0].source === 'user');
  const plantId = found[0].id;

  // A colleague picks the same plant at sign-up → pending until the owner approves
  const mate = (await g('/auth/register', { method: 'POST', body: { name: 'Shift Lead', email: 'lead@kagro.in', password: 'Factory2026', plant: { directoryId: plantId } } }, null)).body.token;
  const pending = (await g('/me/facility', {}, mate)).body;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.site.id, fac.site.id);
  assert.equal((await call(`${root}/sites/${fac.site.id}/risk`, {}, mate)).status, 404, 'no access before approval');

  const site = (await g(`/sites/${fac.site.id}`, {}, owner)).body;
  assert.equal(site.joinRequests.length, 1);
  assert.equal((await g(`/sites/${fac.site.id}`, { method: 'PATCH', body: { approveJoin: 'lead@kagro.in' } }, owner)).status, 200);
  const after = (await g('/me/facility', {}, mate)).body;
  assert.equal(after.status, 'attached');
  assert.equal((await call(`${root}/sites/${fac.site.id}/risk`, {}, mate)).status, 200);

  // Adding the same plant again re-uses the entry instead of duplicating it
  const third = (await g('/auth/register', { method: 'POST', body: { name: 'Third', email: 'third@kagro.in', password: 'Factory2026', plant } }, null)).body.token;
  assert.equal((await g('/me/facility', {}, third)).body.status, 'pending');
  assert.equal((await g('/directory/search?q=kakinada agro', {}, null)).body.total, 1);
});
