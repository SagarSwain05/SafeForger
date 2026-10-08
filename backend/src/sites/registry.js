// Site registry — real-facility presets + user-created sites, access control, and lazy
// runtime management (a site's simulation/agents run only while someone is using it).
const crypto = require('crypto');
const config = require('../config');
const { PRESETS, DEFAULT_SITE_ID } = require('./presets');
const { SECTORS, buildLayout } = require('./templates');
const { buildSiteLayout, SENSOR_TYPES } = require('./profile');
const { SiteRuntime } = require('./runtime');

const CONTACT_ROLES = ['Fire & Safety', 'Safety Officer', 'Shift Supervisor', 'Process Engineer', 'Maintenance Lead', 'Instrument Tech', 'Plant Manager'];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'site';
const presetKey = (id) => crypto.createHash('sha256').update(`safeforge-preset:${id}:${process.env.INGEST_SALT || ''}`).digest('hex').slice(0, 32);

function withLayout(site, overrides = {}) {
  site.layout = buildSiteLayout(site, buildLayout(site.sector, site.name, overrides));
  return site;
}

function presetSite(p) {
  return withLayout({
    id: p.id, kind: p.company.includes('sandbox') ? 'sandbox' : 'preset', name: p.name, company: p.company,
    sector: p.sector, sectorLabel: SECTORS[p.sector].label, featured: !!p.featured,
    location: { city: p.city, state: p.state, country: 'India' },
    description: p.description || `Digital twin of ${p.company}'s ${p.name} (${p.city}, ${p.state}). Simulated telemetry — connect your own cameras and sensors to go live.`,
    ownerId: null, members: [], contacts: [], mode: 'simulated',
    ingestKey: presetKey(p.id),
    createdAt: '2026-10-01T00:00:00.000Z',
  });
}

function sanitiseSensors(list, zones) {
  const ids = new Set(zones.map(z => z.id));
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 60).map((x, i) => {
    let id = String(x.id || '').trim().slice(0, 40) || `S-${String(x.type || 'GAS').slice(0, 5)}-${String(i + 1).padStart(2, '0')}`;
    while (seen.has(id)) id += 'b';
    seen.add(id);
    return { id, type: SENSOR_TYPES[x.type] ? x.type : null, zone: ids.has(x.zone) ? x.zone : null, label: String(x.label || '').slice(0, 60) };
  }).filter(x => x.type && x.zone);
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

  /**
   * Demo account: all simulated plants + its own sandboxes.
   * Real accounts: exactly one facility — the site they own or were invited to.
   */
  canAccess(user, site) {
    if (!site) return false;
    if (!site.ownerId) return !!user.isDemo;
    return site.ownerId === user.id || (site.members || []).includes(user.email);
  }

  /** The single site a real account is attached to (owned first, else first invitation). */
  async attachedSite(user) {
    const owned = await this.store.findOne('sites', { ownerId: user.id });
    if (owned) return owned;
    return (await this.store.find('sites', {})).find(s => (s.members || []).includes(user.email)) || null;
  }

  canEdit(user, site) { return !!site && !!site.ownerId && site.ownerId === user.id; }

  summary(site, user) {
    const { layout, ingestKey, ...rest } = site;
    const rt = this.runtimes.get(site.id);
    return {
      ...rest,
      zones: layout.zones.length, cameras: layout.cameras.length, sensors: layout.sensors.length,
      plantName: layout.plant.name, mode: rest.mode || 'simulated',
      canEdit: user ? this.canEdit(user, site) : false,
      live: rt ? { running: rt.running, clients: rt.connectedClients(), openAlerts: rt.alerts.stats().open, risk: rt.state.risk?.status } : null,
    };
  }

  async listFor(user) {
    if (!user.isDemo) {
      const site = await this.attachedSite(user);
      return site ? [this.summary(site, user)] : [];
    }
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
    // Real accounts start from a real-facility template (or from scratch) and get one live site
    const template = body.templateId ? this.presets.get(body.templateId) : null;
    if (template) {
      body = { ...body, name: body.name || template.name, company: body.company || template.company, sector: template.sector,
        city: body.city || template.location.city, state: body.state || template.location.state };
    }
    const errors = this._validate(body);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
    if (!user.isDemo) {
      const attached = await this.attachedSite(user);
      if (attached) throw Object.assign(new Error(`Your account is already attached to ${attached.name}. Each account manages one facility — edit it in Site & Cameras.`), { status: 409 });
    }
    const mine = await this.store.find('sites', { ownerId: user.id });
    if (user.isDemo) {
      // The demo account is shared publicly: keep only its 5 most recent custom sites
      const old = mine.sort((x, y) => x.createdAt.localeCompare(y.createdAt)).slice(0, Math.max(0, mine.length - 4));
      for (const o of old) { this.restartRuntime(o.id, false); await this.store.deleteOne('sites', { id: o.id }); }
    } else if (mine.length >= 10) throw Object.assign(new Error('Site limit reached (10 per account)'), { status: 400 });
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
      mode: user.isDemo ? 'simulated' : 'live',
      templateId: template?.id || null,
      ingestKey: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    site.sensorsConfig = body.sensors ? sanitiseSensors(body.sensors, buildLayout(body.sector, name).zones) : null;
    withLayout(site, { zones: body.zones, cameras: body.cameras });
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
    if (body.sensors) patch.sensorsConfig = sanitiseSensors(body.sensors, site.layout.zones);
    if (body.sector || body.zones || body.cameras || body.name || body.sensors) {
      const zones = body.zones || site.layout.zones.map(z => ({ name: z.name, hazardClass: z.hazardClass, requiredPPE: z.requiredPPE }));
      patch.sector = sector;
      patch.sectorLabel = SECTORS[sector].label;
      const next = { ...site, ...patch };
      patch.layout = withLayout(next, { zones: body.sector && !body.zones ? undefined : zones, cameras: body.cameras || site.layout.cameras }).layout;
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

  templates() {
    return [...this.presets.values()].filter(p => p.kind === 'preset').map(p => ({
      id: p.id, name: p.name, company: p.company, sector: p.sector, sectorLabel: p.sectorLabel, location: p.location,
    }));
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
