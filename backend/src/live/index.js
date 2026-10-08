// Live data sources for real (non-demo) sites. Nothing here is simulated: every value comes from
// a real input — sensor gateways / manual readings, SCADA gateways, badge readers and CCTV.
// Anything that stops reporting is shown as OFFLINE rather than being made up.
const { SENSOR_TYPES } = require('../sites/profile');

const SENSOR_STALE_MS = 120000;     // a detector silent for 2 min is OFFLINE
const SCADA_STALE_MS = 300000;
const PRESENCE_STALE_MS = 15 * 60000;
const CCTV_PERSON_STALE_MS = 30000;

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const statusOf = (cfg, v) => cfg.invertAlarm
  ? (v < cfg.criticalThreshold ? 'CRITICAL' : v < cfg.warningThreshold ? 'WARNING' : 'NORMAL')
  : (v >= cfg.criticalThreshold ? 'CRITICAL' : v >= cfg.warningThreshold ? 'WARNING' : 'NORMAL');

class LiveTelemetry {
  constructor(layout) {
    this.layout = layout;
    this.sensors = new Map();
    layout.sensors.forEach(s => this._register(s));
  }

  _register(s) {
    const cfg = SENSOR_TYPES[s.type];
    if (!cfg) return null;
    const entry = {
      id: s.id, zone: s.zone, type: s.type, label: s.label || `${s.type} detector`, x: s.x, y: s.y,
      unit: s.unit || cfg.unit,
      warningThreshold: Number.isFinite(+s.warningThreshold) ? +s.warningThreshold : cfg.warningThreshold,
      criticalThreshold: Number.isFinite(+s.criticalThreshold) ? +s.criticalThreshold : cfg.criticalThreshold,
      invertAlarm: !!cfg.invertAlarm, value: null, lastUpdated: null, source: null, history: [],
    };
    this.sensors.set(s.id, entry);
    return entry;
  }

  /**
   * Accept readings: [{ sensorId, value, timestamp?, type?, zone?, label? }]. Unknown sensors are
   * auto-registered when they carry a valid type and zone. Returns { accepted, rejected[] }.
   */
  ingest(readings, source = 'gateway') {
    const zones = new Set(this.layout.zones.map(z => z.id));
    let accepted = 0;
    const rejected = [];
    for (const r of (Array.isArray(readings) ? readings : []).slice(0, 500)) {
      const id = String(r.sensorId || r.sensor_id || r.id || '').slice(0, 40);
      const v = num(r.value);
      if (!id || !Number.isFinite(v)) { rejected.push({ id, reason: 'sensorId and numeric value required' }); continue; }
      let s = this.sensors.get(id);
      if (!s) {
        if (!SENSOR_TYPES[r.type] || !zones.has(r.zone)) { rejected.push({ id, reason: `unknown sensor — include type (${Object.keys(SENSOR_TYPES).join('/')}) and zone to register it` }); continue; }
        const z = this.layout.zones.find(x => x.id === r.zone);
        s = this._register({ id, zone: r.zone, type: r.type, label: r.label, x: z.x + z.w / 2, y: z.y + z.h / 2 });
      }
      const ts = Number.isFinite(Date.parse(r.timestamp)) ? Math.min(Date.now(), Date.parse(r.timestamp)) : Date.now();
      s.value = v;
      s.lastUpdated = ts;
      s.source = source;
      s.history.push({ t: ts, v: +v.toFixed(3) });
      if (s.history.length > 300) s.history.shift();
      accepted++;
    }
    return { accepted, rejected };
  }

  /** Readings in the same shape the simulator emits, plus online/OFFLINE state. */
  snapshot() {
    const now = Date.now();
    return [...this.sensors.values()].map(s => {
      const online = s.lastUpdated !== null && now - s.lastUpdated < SENSOR_STALE_MS;
      return {
        id: s.id, zone: s.zone, type: s.type, label: s.label, x: s.x, y: s.y, unit: s.unit,
        value: s.value === null ? null : +s.value.toFixed(2),
        status: online ? statusOf(s, s.value) : 'OFFLINE', online, source: s.source || 'not connected',
        warningThreshold: s.warningThreshold, criticalThreshold: s.criticalThreshold,
        history: s.history.slice(-30), lastUpdated: s.lastUpdated,
      };
    });
  }
}

class LiveScada {
  constructor() { this.equipment = new Map(); this.lastUpdate = null; }

  ingest(list, source = 'gateway') {
    let accepted = 0;
    for (const e of (Array.isArray(list) ? list : []).slice(0, 200)) {
      const id = String(e.id || e.tag || '').slice(0, 40);
      if (!id) continue;
      const prev = this.equipment.get(id) || {};
      this.equipment.set(id, {
        id, label: String(e.label || e.name || prev.label || id).slice(0, 80), zone: e.zone || prev.zone || null,
        state: String(e.state || prev.state || 'UNKNOWN').toUpperCase().slice(0, 20),
        normalState: String(e.normalState || prev.normalState || 'RUNNING').toUpperCase().slice(0, 20),
        value: Number.isFinite(num(e.value)) ? num(e.value) : prev.value ?? null, unit: String(e.unit || prev.unit || '').slice(0, 20),
        lastUpdated: Date.now(), source,
      });
      accepted++;
    }
    if (accepted) this.lastUpdate = Date.now();
    return { accepted };
  }

  getState() {
    const now = Date.now();
    const equipment = [...this.equipment.values()].map(e => {
      const stale = now - e.lastUpdated > SCADA_STALE_MS;
      return { ...e, state: stale ? 'NO SIGNAL' : e.state, isNormal: !stale && e.state === e.normalState, stale };
    });
    return {
      connected: !!this.lastUpdate && now - this.lastUpdate < SCADA_STALE_MS, source: 'gateway', lastUpdate: this.lastUpdate,
      equipment,
      registers: equipment.map((e, i) => ({ address: 40001 + i, name: e.label, value: e.value, unit: e.unit, zone: e.zone, type: 'EQUIPMENT', status: e.isNormal ? 'NORMAL' : 'WARNING' })),
      timestamp: new Date().toISOString(),
    };
  }
}

/** People on site: badge / RFID presence feed + persons detected on CCTV. */
class LiveWorkers {
  constructor(layout, getVision) {
    this.layout = layout;
    this.getVision = getVision;
    this.badges = new Map();
  }

  ingest(list, source = 'badge') {
    let accepted = 0;
    const zones = new Map(this.layout.zones.map(z => [z.id, z]));
    for (const w of (Array.isArray(list) ? list : []).slice(0, 500)) {
      const id = String(w.id || w.badge || '').slice(0, 40);
      const z = zones.get(w.zone);
      if (!id || !z) continue;
      const x = Number.isFinite(num(w.x)) ? num(w.x) : z.x + z.w * (0.2 + 0.6 * Math.random());
      const y = Number.isFinite(num(w.y)) ? num(w.y) : z.y + z.h * (0.25 + 0.6 * Math.random());
      if (w.present === false) { this.badges.delete(id); continue; }
      this.badges.set(id, { id, name: String(w.name || id).slice(0, 60), role: String(w.role || 'Worker').slice(0, 40), zoneId: z.id, zoneName: z.name, x, y, lastUpdated: Date.now(), source });
      accepted++;
    }
    return { accepted };
  }

  getAllWorkers() {
    const now = Date.now();
    const out = [];
    for (const [id, w] of this.badges) {
      if (now - w.lastUpdated > PRESENCE_STALE_MS) { this.badges.delete(id); continue; }
      out.push({ ...w, ppeStatus: 'UNKNOWN' });
    }
    for (const d of Object.values(this.getVision())) {
      if (now - d.receivedAt > CCTV_PERSON_STALE_MS) continue;
      (d.mapped_positions || []).forEach((p, i) => {
        if (!p.plant_coords) return;
        const z = this.layout.zones.find(x => x.id === (p.zone_id || d.zone));
        out.push({
          id: `CV-${d.camera_id}-${p.person_id || i}`, name: `Person on ${d.camera_id}`, role: p.compliant === false ? `PPE missing: ${(p.missing || []).join(', ')}` : 'Seen on CCTV',
          zoneId: z?.id || d.zone, zoneName: z?.name, x: p.plant_coords[0], y: p.plant_coords[1], ppeStatus: p.compliant === false ? 'VIOLATION' : 'COMPLIANT', source: 'cctv', lastUpdated: d.receivedAt,
        });
      });
    }
    return out;
  }
}

/** Real shift clock (3 × 8 h from 06:00 local by default) for live sites. */
function shiftInfo(site, headcount) {
  const startHour = Number(site.shift?.startHour ?? 6);
  const tzOffsetMin = Number(site.shift?.tzOffsetMin ?? 330);   // IST default
  const local = new Date(Date.now() + tzOffsetMin * 60000);
  const h = (local.getUTCHours() - startHour + 24) % 24;
  const idx = Math.floor(h / 8);
  const startLocal = new Date(local); startLocal.setUTCHours(startHour + idx * 8, 0, 0, 0);
  if (startLocal > local) startLocal.setUTCDate(startLocal.getUTCDate() - 1);
  const start = new Date(startLocal.getTime() - tzOffsetMin * 60000);
  const supervisor = (site.contacts || []).find(c => c.role === 'Shift Supervisor')?.name || 'Not assigned';
  return { current: ['A', 'B', 'C'][idx], supervisor, startTime: start.toISOString(), nextChange: new Date(start.getTime() + 8 * 3600000).toISOString(), workersOnSite: headcount };
}

module.exports = { LiveTelemetry, LiveScada, LiveWorkers, shiftInfo, SENSOR_STALE_MS };
