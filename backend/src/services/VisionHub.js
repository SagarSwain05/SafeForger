// Vision Hub — ingests detection payloads from every edge (browser, Python agent, HTTP API,
// MQTT), applies the *effective* PPE rules for the zone (zone baseline + active-permit
// requirements), keeps the live per-zone vision state, and turns confirmed events into alerts.
let manifest;
try {
  manifest = require('../../../models/manifest.json');   // shared with the edge engines
} catch {
  manifest = {                                           // backend deployed without the models folder
    default_required_ppe: ['helmet', 'vest'],
    ppe_items: { helmet: { label: 'Helmet' }, vest: { label: 'Hi-vis vest' }, boots: { label: 'Safety footwear' }, gloves: { label: 'Gloves' }, goggles: { label: 'Eye protection' }, mask: { label: 'Mask / respirator' }, ear: { label: 'Ear protection' } },
  };
}

const PPE_LABELS = Object.fromEntries(Object.entries(manifest.ppe_items).map(([k, v]) => [k, v.label]));
const KNOWN_ITEMS = new Set(Object.keys(manifest.ppe_items));
const EVENT_TYPES = new Set(['FIRE', 'SMOKE', 'PPE_VIOLATION']);
const MAX_EVIDENCE_CHARS = 1_500_000;   // ~1.1 MB JPEG

class VisionHub {
  constructor({ io, layout, alerts, getActivePermitsByZone, regulationsFor, config }) {
    this.io = io;
    this.layout = layout;
    this.zones = Object.fromEntries(layout.zones.map(z => [z.id, z]));
    this.cameras = Object.fromEntries((layout.cameras || []).map(c => [c.id, c]));
    this.alerts = alerts;
    this.getActivePermitsByZone = getActivePermitsByZone;
    this.regulationsFor = regulationsFor || (() => []);
    this.cfg = config;
    this.byZone = {};          // zone → latest normalised detection
    this.byCamera = {};        // camera → latest normalised detection
    this.stats = { received: 0, rejected: 0, bySource: {}, lastLatencyMs: null };
    this.fireListeners = [];
  }

  onFire(fn) { this.fireListeners.push(fn); }

  /** Zone baseline PPE + extra PPE demanded by active permits in that zone. */
  requiredPPE(zoneId) {
    const zone = this.zones[zoneId];
    const base = zone?.requiredPPE ?? manifest.default_required_ppe;
    const permits = this.getActivePermitsByZone()[zoneId] || [];
    const extra = permits.flatMap(p => this.layout.permitPPE?.[p.type] || []);
    const items = [...new Set([...base, ...extra])].filter(i => KNOWN_ITEMS.has(i));
    return { items, base, permitDriven: [...new Set(extra)].filter(i => !base.includes(i)), permits: permits.map(p => p.id) };
  }

  requirementsTable() {
    return Object.fromEntries(Object.keys(this.zones).map(z => [z, this.requiredPPE(z)]));
  }

  /** Validate + normalise; returns { ok, error?, detection? } */
  ingest(raw, transport = 'http') {
    if (!raw || typeof raw !== 'object') return this._reject('Body must be a JSON object');
    const cameraId = String(raw.camera_id || raw.cameraId || '').slice(0, 40);
    if (!cameraId) return this._reject('camera_id required');
    const zoneId = raw.zone || this.cameras[cameraId]?.zone;
    if (!zoneId || !this.zones[zoneId]) return this._reject(`Unknown zone for camera ${cameraId}`);
    if (raw.evidence && (typeof raw.evidence !== 'string' || !raw.evidence.startsWith('data:image/') || raw.evidence.length > MAX_EVIDENCE_CHARS)) {
      raw.evidence = null;
    }

    const req = this.requiredPPE(zoneId);
    // Map position: edge-supplied homography coords, else project the feet point into the camera's zone
    const zr = this.zones[zoneId];
    const fw = Number(raw.frame?.w), fh = Number(raw.frame?.h);
    const project = (bbox) => {
      if (!Array.isArray(bbox) || !(fw > 0 && fh > 0)) return null;
      const fx = Math.min(1, Math.max(0, ((bbox[0] + bbox[2]) / 2) / fw)), fy = Math.min(1, Math.max(0, bbox[3] / fh));
      return [+(zr.x + 6 + fx * (zr.w - 12)).toFixed(1), +(zr.y + 6 + fy * (zr.h - 12)).toFixed(1)];
    };
    const workers = Array.isArray(raw.workers) ? raw.workers.slice(0, 100).map(w => {
      const ppe = w.ppe && typeof w.ppe === 'object' ? w.ppe : {};
      const missing = req.items.filter(i => ppe[i] === 'missing');
      const plant_coords = Array.isArray(w.plant_coords) ? w.plant_coords : project(w.bbox);
      return { ...w, ppe, missing, compliant: missing.length === 0, plant_coords };
    }) : [];
    const hasWorkerDetail = workers.length > 0;
    const violators = workers.filter(w => !w.compliant);
    const num = (v) => (Number.isFinite(+v) ? +v : 0);

    const now = Date.now();
    const sourceTs = Date.parse(raw.timestamp);
    const d = {
      camera_id: cameraId,
      camera_label: this.cameras[cameraId]?.label || cameraId,
      zone: zoneId,
      zone_name: this.zones[zoneId].name,
      source: String(raw.source || transport).slice(0, 20),
      timestamp: Number.isFinite(sourceTs) ? new Date(sourceTs).toISOString() : new Date(now).toISOString(),
      receivedAt: now,
      fps: num(raw.fps),
      inference_ms: num(raw.inference_ms),
      frame: raw.frame || null,
      required_ppe: req.items,
      permit_ppe: req.permitDriven,
      worker_count: hasWorkerDetail ? workers.length : num(raw.worker_count ?? raw.workerCount),
      ppe_violations: hasWorkerDetail ? violators.length : num(raw.ppe_violations ?? raw.ppeViolations),
      compliant_workers: hasWorkerDetail ? workers.length - violators.length : num(raw.compliant_workers),
      fire_detected: !!(raw.fire_detected ?? raw.fireDetected),
      smoke_detected: !!(raw.smoke_detected ?? raw.smokeDetected),
      fire_confidence: num(raw.fire_confidence),
      smoke_confidence: num(raw.smoke_confidence),
      workers,
      hazards: Array.isArray(raw.hazards) ? raw.hazards.slice(0, 50) : [],
      zones_occupied: Array.isArray(raw.zones_occupied) ? raw.zones_occupied : [],
      mapped_positions: workers.filter(w => w.plant_coords).map(w => ({
        person_id: w.id, plant_coords: w.plant_coords, zone_id: w.zone_id || zoneId, compliant: w.compliant, missing: w.missing,
      })),
      events: [],
    };
    d.ppe_compliance_pct = d.worker_count ? Math.round((d.compliant_workers / d.worker_count) * 100) : null;
    if (Number.isFinite(sourceTs)) this.stats.lastLatencyMs = Math.max(0, now - sourceTs);

    // Events: trust the edge's temporal confirmation, but re-derive PPE against effective rules
    const edgeEvents = Array.isArray(raw.events) ? raw.events.filter(e => EVENT_TYPES.has(e?.type)) : [];
    const types = new Set(edgeEvents.map(e => e.type));
    if (types.has('FIRE') || (raw.events === undefined && d.fire_detected)) d.events.push({ type: 'FIRE', confidence: d.fire_confidence });
    if (types.has('SMOKE') || (raw.events === undefined && d.smoke_detected)) d.events.push({ type: 'SMOKE', confidence: d.smoke_confidence });
    const ppeConfirmed = types.has('PPE_VIOLATION') || raw.events === undefined;
    if (ppeConfirmed && d.ppe_violations > 0) {
      const missing = [...new Set(violators.flatMap(w => w.missing))];
      d.events.push({ type: 'PPE_VIOLATION', count: d.ppe_violations, missing });
    }

    this.byZone[zoneId] = d;
    this.byCamera[cameraId] = d;
    this.stats.received++;
    this.stats.bySource[d.source] = (this.stats.bySource[d.source] || 0) + 1;

    this._raiseAlerts(d, raw.evidence || null);
    const { workers: _w, ...slim } = d;
    this.io?.emit('cv:detection', { ...slim, workers: d.workers.map(({ bbox, ppe, missing, compliant, id, zone_id }) => ({ id, bbox, ppe, missing, compliant, zone_id })) });
    return { ok: true, detection: d };
  }

  _reject(error) {
    this.stats.rejected++;
    return { ok: false, error };
  }

  _raiseAlerts(d, evidence) {
    const zone = this.zones[d.zone];
    const permits = this.getActivePermitsByZone()[d.zone] || [];
    const hotWork = permits.some(p => p.type === 'HOT_WORK');
    const hazardous = ['CRITICAL', 'HIGH'].includes(zone.hazardClass);
    const where = `${zone.name} (${d.zone}) · ${d.camera_label}`;

    for (const ev of d.events) {
      const base = { zone: d.zone, cameraId: d.camera_id, source: `vision:${d.source}`, evidence, detectedAt: d.timestamp };
      if (ev.type === 'FIRE') {
        const alert = this.alerts.raise({
          ...base, type: 'FIRE', severity: 'CRITICAL',
          title: `Fire detected — ${zone.name}`,
          message: `Flames detected on CCTV at ${where} (confidence ${(d.fire_confidence * 100).toFixed(0)}%).${hotWork ? ' Hot-work permit active in this zone.' : ''}${hazardous ? ` ${zone.type} hazardous area.` : ''}`,
          details: { confidence: d.fire_confidence, workersInView: d.worker_count, permits: permits.map(p => p.id) },
          regulations: ['Factories Act 1948, Section 38', 'OISD-STD-116', ...this.regulationsFor('fire flames detection evacuation alarm', 1)],
        });
        this.fireListeners.forEach(fn => fn(d, alert));
      } else if (ev.type === 'SMOKE') {
        const severity = hotWork || zone.hazardClass === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
        this.alerts.raise({
          ...base, type: 'SMOKE', severity,
          title: `Smoke detected — ${zone.name}`,
          message: `Smoke visible on CCTV at ${where} (confidence ${(d.smoke_confidence * 100).toFixed(0)}%). Early-stage fire indicator${hotWork ? ' with hot work in progress' : ''}.`,
          details: { confidence: d.smoke_confidence, permits: permits.map(p => p.id) },
          regulations: ['OISD-STD-116', 'Factories Act 1948, Section 38'],
        });
      } else if (ev.type === 'PPE_VIOLATION') {
        const items = (ev.missing || []).map(i => PPE_LABELS[i] || i);
        const permitItems = (ev.missing || []).filter(i => d.permit_ppe.includes(i));
        const severity = (hazardous || permits.length) ? 'HIGH' : 'MEDIUM';
        this.alerts.raise({
          ...base, type: 'PPE_VIOLATION', severity,
          title: `PPE violation — ${zone.name}`,
          message: `${ev.count} worker(s) at ${where} missing required PPE: ${items.join(', ') || 'required items'}.${permitItems.length ? ` (${permitItems.map(i => PPE_LABELS[i]).join(', ')} required by active ${permits.map(p => p.type.replace('_', ' ').toLowerCase()).join(', ')} permit)` : ''}`,
          details: { count: ev.count, missing: ev.missing, required: d.required_ppe, workersInView: d.worker_count, compliancePct: d.ppe_compliance_pct },
          regulations: this._ppeRegulations(ev.missing || []),
        });
      }
    }
  }

  _ppeRegulations(missing) {
    const refs = ['Factories Act 1948, Section 111', 'OISD-STD-155'];
    if (missing.includes('helmet')) refs.push('IS 2925');
    if (missing.includes('boots')) refs.push('IS 15298');
    if (missing.includes('vest')) refs.push('ISO 20471');
    if (missing.includes('goggles')) refs.push('Factories Act 1948, Section 35');
    return refs;
  }

  /** Periodic sweep: mark alerts inactive when their camera stopped reporting the condition. */
  sweep() {
    const now = Date.now();
    for (const [zone, d] of Object.entries(this.byZone)) {
      const stale = now - d.receivedAt > this.cfg.vision.staleMs;
      const active = new Set(stale ? [] : d.events.map(e => e.type));
      for (const t of ['FIRE', 'SMOKE', 'PPE_VIOLATION']) if (!active.has(t)) this.alerts.clear(`${t}:${zone}`);
      if (stale && !d.stale) {
        d.stale = true;
        this.io?.emit('cv:stale', { zone, camera_id: d.camera_id });
      }
    }
  }

  /** Forget all camera state (demo reset). */
  reset() {
    for (const zone of Object.keys(this.byZone)) this.io?.emit('cv:stale', { zone });
    this.byZone = {};
    this.byCamera = {};
  }

  /** Live (non-stale) state per zone — consumed by the risk engine, graph and heatmap. */
  liveByZone() {
    const now = Date.now();
    return Object.fromEntries(Object.entries(this.byZone).filter(([, d]) => now - d.receivedAt <= this.cfg.vision.staleMs));
  }

  summary() {
    const live = Object.values(this.liveByZone());
    const workers = live.reduce((s, d) => s + d.worker_count, 0);
    const violations = live.reduce((s, d) => s + d.ppe_violations, 0);
    return {
      camerasOnline: live.length,
      cameras: Object.values(this.byCamera).map(d => ({
        camera_id: d.camera_id, label: d.camera_label, zone: d.zone, zone_name: d.zone_name, source: d.source,
        worker_count: d.worker_count, ppe_violations: d.ppe_violations, compliance_pct: d.ppe_compliance_pct,
        fire: d.fire_detected, smoke: d.smoke_detected, fps: d.fps, inference_ms: d.inference_ms,
        events: d.events.map(e => e.type), age_ms: Date.now() - d.receivedAt, stale: Date.now() - d.receivedAt > this.cfg.vision.staleMs,
      })),
      workersObserved: workers,
      ppeViolations: violations,
      ppeCompliancePct: workers ? Math.round(((workers - violations) / workers) * 100) : null,
      fireZones: live.filter(d => d.fire_detected).map(d => d.zone),
      smokeZones: live.filter(d => d.smoke_detected).map(d => d.zone),
      stats: this.stats,
    };
  }
}

module.exports = { VisionHub };
