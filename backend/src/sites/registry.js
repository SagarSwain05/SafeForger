// Site registry — real-facility presets + user-created sites, access control, and lazy
// runtime management (a site's simulation/agents run only while someone is using it).
const crypto = require('crypto');
const config = require('../config');
const { PRESETS, DEFAULT_SITE_ID } = require('./presets');
const { SECTORS, buildLayout } = require('./templates');
const { SiteRuntime } = require('./runtime');

const CONTACT_ROLES = ['Fire & Safety', 'Safety Officer', 'Shift Supervisor', 'Process Engineer', 'Maintenance Lead', 'Instrument Tech', 'Plant Manager'];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'site';
const presetKey = (id) => crypto.createHash('sha256').update(`safeforge-preset:${id}:${process.env.INGEST_SALT || ''}`).digest('hex').slice(0, 32);

function presetSite(p) {
  return {
    id: p.id, kind: p.company.includes('sandbox') ? 'sandbox' : 'preset', name: p.name, company: p.company,
    sector: p.sector, sectorLabel: SECTORS[p.sector].label, featured: !!p.featured,
    location: { city: p.city, state: p.state, country: 'India' },
    description: p.description || `Digital twin of ${p.company}'s ${p.name} (${p.city}, ${p.state}). Simulated telemetry — connect your own cameras and sensors to go live.`,
    ownerId: null, members: [], contacts: [],
    layout: buildLayout(p.sector, p.name),
    ingestKey: presetKey(p.id),
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function sanitiseContacts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map(c => ({
    name: String(c.name || '').trim().slice(0, 60),
    role: CONTACT_ROLES.includes(c.role) ? c.role : 'Safety Officer',
    email: String(c.email || '').trim().slice(0, 120),
    phone: String(c.phone || '').trim().slice(0, 30),
  })).filter(c => c.name);
}

class SiteRegistry {
  constructor({ store, io, shared }) {
    this.store = store;
    this.io = io;
    this.shared = shared;
    this.presets = new Map(PRESETS.map(p => [p.id, presetSite(p)]));
    this.runtimes = new Map();
    this.routers = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60000);
    this.sweeper.unref();
  }

  async get(id) {
    return this.presets.get(id) || await this.store.findOne('sites', { id });
  }

  canAccess(user, site) {
    if (!site) return false;
    if (!site.ownerId) return true;                         // presets / sandboxes are shared
    return site.ownerId === user.id || (site.members || []).includes(user.email);
  }

  canEdit(user, site) { return !!site && !!site.ownerId && site.ownerId === user.id; }

  summary(site, user) {
    const { layout, ingestKey, ...rest } = site;
    const rt = this.runtimes.get(site.id);
    return {
      ...rest,
      zones: layout.zones.length, cameras: layout.cameras.length, sensors: layout.sensors.length,
      plantName: layout.plant.name,
      canEdit: user ? this.canEdit(user, site) : false,
      live: rt ? { running: rt.running, clients: rt.connectedClients(), openAlerts: rt.alerts.stats().open, risk: rt.state.risk?.status } : null,
    };
  }

  async listFor(user) {
    const mine = await this.store.find('sites', { ownerId: user.id });
    const shared = (await this.store.find('sites', {})).filter(s => s.ownerId !== user.id && (s.members || []).includes(user.email));
    return [...mine, ...shared, ...this.presets.values()].map(s => this.summary(s, user));
  }

  _validate(body, partial = false) {
    const errors = [];
    if (!partial || body.name !== undefined) if (!String(body.name || '').trim()) errors.push('Site name is required');
    if (!partial || body.sector !== undefined) if (!SECTORS[body.sector]) errors.push('Choose an industry sector');
    return errors;
  }

  async create(user, body) {
    const errors = this._validate(body);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
    const mineCount = (await this.store.find('sites', { ownerId: user.id })).length;
    if (mineCount >= 10) throw Object.assign(new Error('Site limit reached (10 per account)'), { status: 400 });
    const name = String(body.name).trim().slice(0, 80);
    const site = {
      id: `${slug(name)}-${crypto.randomBytes(3).toString('hex')}`,
      kind: 'custom', name, company: String(body.company || user.organization || '').slice(0, 100),
      sector: body.sector, sectorLabel: SECTORS[body.sector].label,
      location: { city: String(body.city || '').slice(0, 60), state: String(body.state || '').slice(0, 60), country: String(body.country || 'India').slice(0, 60) },
      description: String(body.description || '').slice(0, 500),
      ownerId: user.id, ownerEmail: user.email,
      members: (Array.isArray(body.members) ? body.members : []).map(e => String(e).trim().toLowerCase()).filter(e => e.includes('@')).slice(0, 20),
      contacts: sanitiseContacts(body.contacts),
      layout: buildLayout(body.sector, name, { zones: body.zones, cameras: body.cameras }),
      ingestKey: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    await this.store.insertOne('sites', site);
    return site;
  }

  async update(user, id, body) {
    const site = await this.get(id);
    if (!this.canEdit(user, site)) throw Object.assign(new Error('Only the site owner can edit this site'), { status: 403 });
    const errors = this._validate(body, true);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
    const patch = {};
    for (const k of ['name', 'company', 'description']) if (body[k] !== undefined) patch[k] = String(body[k]).slice(0, k === 'description' ? 500 : 100);
    if (body.location) patch.location = { ...site.location, ...body.location };
    if (body.members) patch.members = body.members.map(e => String(e).trim().toLowerCase()).filter(e => e.includes('@')).slice(0, 20);
    if (body.contacts) patch.contacts = sanitiseContacts(body.contacts);
    const sector = body.sector || site.sector;
    if (body.sector || body.zones || body.cameras || body.name) {
      const zones = body.zones || site.layout.zones.map(z => ({ name: z.name, hazardClass: z.hazardClass, requiredPPE: z.requiredPPE }));
      patch.sector = sector;
      patch.sectorLabel = SECTORS[sector].label;
      patch.layout = buildLayout(sector, patch.name || site.name, { zones: body.sector && !body.zones ? undefined : zones, cameras: body.cameras || site.layout.cameras });
    }
    if (body.rotateKey) patch.ingestKey = crypto.randomBytes(16).toString('hex');
    const updated = await this.store.updateOne('sites', { id }, patch);
    this.restartRuntime(id);   // pick up the new layout / contacts
    return updated;
  }

  async remove(user, id) {
    const site = await this.get(id);
    if (!this.canEdit(user, site)) throw Object.assign(new Error('Only the site owner can delete this site'), { status: 403 });
    this.restartRuntime(id, false);
    await this.store.deleteOne('sites', { id });
  }

  /** Get (and start) the runtime for a site document. */
  runtime(site) {
    let rt = this.runtimes.get(site.id);
    if (!rt) {
      rt = new SiteRuntime(site, this.io, this.shared);
      this.runtimes.set(site.id, rt);
      this.routers.set(site.id, rt.router());
    }
    rt.touch();
    if (!rt.running) rt.start();
    return rt;
  }

  router(siteId) { return this.routers.get(siteId); }

  restartRuntime(id, notify = true) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.stop();
    this.runtimes.delete(id);
    this.routers.delete(id);
    if (notify) this.io?.to(rt.room).emit('site:reload', { id });
  }

  sweep() {
    const now = Date.now();
    for (const [id, rt] of this.runtimes) {
      if (rt.running && rt.connectedClients() === 0 && now - rt.lastActive > config.runtime.idleStopMs) rt.stop();
    }
  }

  stats() {
    return { presets: this.presets.size, runtimes: [...this.runtimes.values()].map(r => r.status()) };
  }

  async stopAll() {
    clearInterval(this.sweeper);
    for (const rt of this.runtimes.values()) rt.stop();
  }
}

module.exports = { SiteRegistry, CONTACT_ROLES, DEFAULT_SITE_ID };
