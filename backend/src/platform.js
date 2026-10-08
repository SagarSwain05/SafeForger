// SafeForge Nexus — platform assembly.
//   /api/health, /api/system/*        service status + restart (status widget)
//   /api/auth/*                       accounts (Brevo email OTP, JWT)
//   /api/sectors, /api/sites          industry templates, site catalogue, create/edit sites
//   /api/sites/:siteId/*              everything plant-specific, served by that site's runtime
// createPlatform() returns an un-started instance so tests can run isolated copies.
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config');
const llm = require('./services/llm');
const notifier = require('./services/notifier');
const emailSvc = require('./auth/email');
const { createStore } = require('./store');
const { AuthService, authRouter, requireAuth } = require('./auth');
const { SiteRegistry, CONTACT_ROLES, DEFAULT_SITE_ID } = require('./sites/registry');
const { SECTORS, SECTOR_LIST } = require('./sites/templates');
const RAGAgent = require('./agents/RAGAgent');
const { PlantDirectory } = require('./directory');
const { SENSOR_PLANS, SENSOR_TYPES } = require('./sites/profile');

const VERSION = require('../package.json').version;

/** Tiny fixed-window rate limiter (per IP + bucket) — enough to protect a public demo. */
function rateLimit(bucket, max, windowMs) {
  max = Math.round(max * (Number(process.env.RATE_LIMIT_SCALE) || 1));   // raised in tests
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

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createPlatform() {
  const app = express();
  const server = http.createServer(app);
  // Configured dashboard origins, plus any localhost port for local development
  const corsOrigin = config.corsOrigins.length
    ? (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin.replace(/\/$/, '')) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    : '*';
  const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }, maxHttpBufferSize: 4e6 });
  app.set('trust proxy', 1);
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '3mb' }));

  const startedAt = Date.now();
  const limiters = {
    ingestLimiter: rateLimit('ingest', 240, 10000),
    writeLimiter: rateLimit('write', 90, 60000),
    llmLimiter: rateLimit('llm', 20, 60000),
  };
  const authLimiter = rateLimit('auth', 20, 60000);
  const shared = { rag: new RAGAgent(), limiters };
  const ctx = { store: null, auth: null, sites: null };
  let lastRestart = 0;

  // ── Public service status ─────────────────────────────────────────────────
  const statusBody = () => ({
    status: ctx.auth ? 'ok' : 'starting', version: VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(), node: process.version,
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    storage: ctx.store ? { kind: ctx.store.kind, durable: ctx.store.durable } : null,
    email: { verification: emailSvc.enabled(), provider: 'brevo' },
    llm: { configured: llm.isConfigured(), lastModel: llm.stats.lastModel },
    notifications: notifier.channels(),
    sites: ctx.sites ? ctx.sites.stats() : null,
    sessionsSurviveRestart: !config.auth.jwtSecretIsEphemeral,
  });
  app.get('/api/health', (req, res) => res.json(statusBody()));
  app.get('/api/system/status', (req, res) => res.json(statusBody()));

  // ── Everything below needs the store / auth ───────────────────────────────
  app.use('/api', (req, res, next) => (ctx.auth ? next() : res.status(503).json({ error: 'Starting up — try again in a moment' })));
  const authed = (req, res, next) => requireAuth(ctx.auth)(req, res, next);
  let authRoutes = null;
  app.use('/api/auth', (req, res, next) => (authRoutes = authRoutes || authRouter(ctx.auth, authLimiter, ctx.directory))(req, res, next));

  // ── All-India plant directory (public search for sign-up) ────────────────
  const dirLimiter = rateLimit('directory', 120, 60000);
  app.get('/api/directory/meta', (req, res) => res.json(ctx.directory.meta()));
  app.get('/api/directory/search', dirLimiter, (req, res) => res.json(ctx.directory.search({
    q: String(req.query.q || '').slice(0, 80), state: String(req.query.state || ''), sector: String(req.query.sector || ''), limit: Number(req.query.limit) || 25,
  })));
  app.get('/api/directory/:id', (req, res) => {
    const p = ctx.directory.get(req.params.id);
    return p ? res.json(p) : res.status(404).json({ error: 'Plant not found' });
  });

  // ── The signed-in real account's facility (link / pending / attached) ─────
  app.get('/api/me/facility', authed, wrap(async (req, res) => {
    if (req.user.isDemo) return res.json({ status: 'demo' });
    res.json(await ctx.sites.facilityFor(req.user));
  }));
  app.post('/api/me/plant', authed, limiters.writeLimiter, wrap(async (req, res) => {
    const { directoryId, newPlant } = req.body || {};
    if (!directoryId && !newPlant) return res.status(400).json({ error: 'Choose a plant or add a new one' });
    res.json(await ctx.sites.linkPlant(req.user, { directoryId, newPlant }));
  }));

  app.post('/api/system/restart', authed, (req, res) => {
    if (Date.now() - lastRestart < 120000) return res.status(429).json({ error: 'A restart was requested less than 2 minutes ago' });
    lastRestart = Date.now();
    console.warn(`[System] restart requested by ${req.user.email}`);
    res.json({ restarting: true, message: 'Server restarting — the hosting platform brings it back automatically in a few seconds.' });
    io.emit('system:restarting', { by: req.user.name });
    setTimeout(() => process.exit(0), 400);
  });

  app.get('/api/sectors', (req, res) => res.json({
    sectors: SECTOR_LIST.map(s => ({
      ...s, zones: SECTORS[s.id].zones.map(([name, hazardClass, type, requiredPPE]) => ({ name, hazardClass, type, requiredPPE })), cameras: SECTORS[s.id].cameras,
      sensors: (SENSOR_PLANS[s.id] || []).map(([zone, type, label]) => ({ zone, type, label })),
    })),
    sensorTypes: Object.fromEntries(Object.entries(SENSOR_TYPES).map(([k, v]) => [k, { unit: v.unit, warningThreshold: v.warningThreshold, criticalThreshold: v.criticalThreshold }])),
    contactRoles: CONTACT_ROLES, defaultSiteId: DEFAULT_SITE_ID,
  }));

  app.get('/api/sites', authed, wrap(async (req, res) => res.json(await ctx.sites.listFor(req.user))));
  // Real-facility templates a real account can attach its (single) live site to
  app.get('/api/sites/templates', authed, (req, res) => res.json(ctx.sites.templates()));
  app.post('/api/sites', authed, limiters.writeLimiter, wrap(async (req, res) => {
    const site = await ctx.sites.create(req.user, req.body || {});
    res.status(201).json(ctx.sites.summary(site, req.user));
  }));

  // Site detail / edit (owner) — the ingest key is only shown to users with access
  const siteDetail = (site, user) => ({ ...site, canEdit: ctx.sites.canEdit(user, site) });
  app.get('/api/sites/:siteId', authed, wrap(async (req, res) => {
    const site = await ctx.sites.get(req.params.siteId);
    if (!site || !ctx.sites.canAccess(req.user, site)) return res.status(404).json({ error: 'Site not found' });
    res.json(siteDetail(site, req.user));
  }));
  app.patch('/api/sites/:siteId', authed, limiters.writeLimiter, wrap(async (req, res) => {
    const site = await ctx.sites.update(req.user, req.params.siteId, req.body || {});
    res.json(siteDetail(site, req.user));
  }));
  app.delete('/api/sites/:siteId', authed, wrap(async (req, res) => {
    await ctx.sites.remove(req.user, req.params.siteId);
    res.json({ deleted: true });
  }));

  // Site-scoped API: a signed-in user with access, or an edge device holding the site ingest key
  app.use('/api/sites/:siteId', wrap(async (req, res, next) => {
    const site = await ctx.sites.get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const key = req.headers['x-api-key'];
    // Devices holding the site ingest key may push real inputs and read the site map
    const isIngest = (req.method === 'POST' && ['/vision/detections', '/telemetry', '/scada', '/presence'].includes(req.path))
      || (req.method === 'GET' && ['/plant-layout', '/spatial/zones'].includes(req.path));
    if (key && isIngest) {
      if (key !== site.ingestKey) return res.status(401).json({ error: 'Invalid site ingest key' });
    } else {
      const h = req.headers.authorization || '';
      const user = h.startsWith('Bearer ') ? await ctx.auth.userFromToken(h.slice(7)) : null;
      if (!user) return res.status(401).json({ error: 'Sign in required' });
      if (!ctx.sites.canAccess(user, site)) return res.status(404).json({ error: 'Site not found' });
      req.user = user;
    }
    ctx.sites.runtime(site);
    ctx.sites.router(site.id)(req, res, next);
  }));

  app.get('/', (req, res) => res.json({ name: 'SafeForge Nexus API', version: VERSION, docs: '/api/health' }));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error('[API]', err);
    res.status(500).json({ error: 'Internal error' });
  });

  // ── WebSocket: authenticated, one room per site ───────────────────────────
  io.use(async (socket, next) => {
    try {
      const { token, siteId } = socket.handshake.auth || {};
      const user = ctx.auth ? await ctx.auth.userFromToken(token) : null;
      if (!user) return next(new Error('unauthorized'));
      const site = siteId ? await ctx.sites.get(siteId) : user.isDemo ? await ctx.sites.get(DEFAULT_SITE_ID) : await ctx.sites.attachedSite(user);
      if (!site || !ctx.sites.canAccess(user, site)) return next(new Error('site-not-found'));
      socket.data.user = user;
      socket.data.site = site;
      next();
    } catch (err) { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => {
    const rt = ctx.sites.runtime(socket.data.site);
    socket.join(rt.room);
    rt.sendInitial(socket);
    socket.on('disconnect', () => rt.touch());
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  async function start(port = config.port) {
    ctx.store = await createStore(config.store);
    ctx.auth = new AuthService(ctx.store);
    await ctx.auth.seedDemo();
    ctx.directory = await new PlantDirectory(ctx.store).load();
    ctx.sites = new SiteRegistry({ store: ctx.store, io, shared, directory: ctx.directory });
    await startMqtt();
    return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
  }

  // Optional on-premise MQTT bus: edge agents publish plant/{zone}/vision with a site_id
  async function startMqtt() {
    if (!config.mqtt.enabled) return;
    try {
      const MqttBroker = require('./mqtt/broker');
      const { MqttIngestion } = require('./mqtt/ingestion');
      ctx.mqttBroker = await new MqttBroker(config.mqtt.port).start();
      ctx.mqtt = new MqttIngestion({
        port: config.mqtt.port,
        onVision: async (payload) => {
          const site = await ctx.sites.get(payload.site_id || DEFAULT_SITE_ID);
          if (site) ctx.sites.runtime(site).vision.ingest(payload, 'mqtt');
        },
      });
      ctx.mqtt.connect();
    } catch (err) {
      console.warn(`[MQTT] Broker not started (${err.message}) — continuing without MQTT`);
    }
  }

  async function stop() {
    ctx.mqtt?.close();
    if (ctx.mqttBroker) await ctx.mqttBroker.stop();
    await ctx.sites?.stopAll();
    io.close();
    await new Promise(r => server.close(() => r()));
    await ctx.store?.close();
  }

  return { app, server, io, ctx, start, stop };
}

module.exports = { createPlatform, DEFAULT_SITE_ID };
