// Alert Manager — single place where every hazard becomes an actionable, routed alert.
//
//   source event (vision / compound risk / sensor / emergency)
//     → dedupe by type+zone (re-occurrences update the open alert, escalate if severity rises)
//     → enrich with location, regulation references and recommended actions
//     → route to the right people (role matrix + permit holders in the zone)
//     → push to dashboard (Socket.io) + external channels (Telegram / webhook / simulated SMS)
//     → track acknowledgement and resolution for response-time KPIs
const crypto = require('crypto');
const notifier = require('./notifier');
const config = require('../config');

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const NOTIFY_MIN_RANK = SEVERITY_RANK.HIGH;
const MAX_ALERTS = 300;

// Who must hear about what (roles from the shift roster)
const ROUTING = {
  FIRE: ['Fire & Safety', 'Safety Officer', 'Shift Supervisor', 'Process Engineer'],
  SMOKE: ['Fire & Safety', 'Safety Officer', 'Shift Supervisor'],
  PPE_VIOLATION: ['Shift Supervisor', 'Safety Officer'],
  COMPOUND_RISK: ['Safety Officer', 'Shift Supervisor', 'Process Engineer'],
  SENSOR: ['Shift Supervisor', 'Instrument Tech'],
  EMERGENCY: ['Fire & Safety', 'Safety Officer', 'Shift Supervisor', 'Maintenance Lead', 'Process Engineer'],
};

const DEFAULT_ACTIONS = {
  FIRE: ['Sound the zone fire alarm and evacuate to the emergency assembly point', 'Dispatch fire & safety team with extinguishers / hydrant crew', 'Isolate fuel sources and suspend all hot-work permits in adjacent zones'],
  SMOKE: ['Dispatch a field operator to verify the smoke source', 'Suspend hot work in the zone until cleared', 'Prepare fire crew for standby'],
  PPE_VIOLATION: ['Stop work for the affected worker(s) until PPE is worn', 'Supervisor to brief the crew on the zone PPE matrix', 'Record the observation in the safety log'],
  COMPOUND_RISK: ['Review and suspend the conflicting permit(s)', 'Re-test the atmosphere before work resumes'],
  SENSOR: ['Verify the reading with a portable detector', 'Check the instrument calibration and bypass status'],
};

class AlertManager {
  constructor({ io, layout, roster = [], getPermits = () => [] }) {
    this.io = io;
    this.zones = Object.fromEntries((layout?.zones || []).map(z => [z.id, z]));
    this.cameras = Object.fromEntries((layout?.cameras || []).map(c => [c.id, c]));
    this.roster = roster;
    this.getPermits = getPermits;
    this.alerts = [];               // newest first
    this.listeners = [];
  }

  onAlert(fn) { this.listeners.push(fn); }

  _recipients(type, zone) {
    const roles = ROUTING[type] || ROUTING.COMPOUND_RISK;
    const people = [];
    for (const role of roles) {
      const p = this.roster.find(w => w.role === role);
      if (p) people.push({ name: p.name, role: p.role, reason: 'role' });
    }
    // Permit holders working in the zone are directly affected
    if (zone) {
      for (const permit of this.getPermits({ status: 'ACTIVE', zone })) {
        for (const name of [permit.requestedBy, permit.approvedBy]) {
          if (name && !people.some(x => x.name === name)) people.push({ name, role: `Permit ${permit.id}`, reason: 'permit' });
        }
      }
    }
    return people;
  }

  _location(zone, cameraId) {
    const z = this.zones[zone];
    const cam = cameraId ? this.cameras[cameraId] : null;
    if (cam) return { x: cam.x, y: cam.y, source: 'camera' };
    if (z) return { x: z.x + z.w / 2, y: z.y + z.h / 2, source: 'zone' };
    return null;
  }

  /**
   * Raise (or refresh) an alert.
   * @param {object} e { type, severity, title, message, zone, cameraId, source, evidence, details, regulations, recommendedActions, detectedAt, key }
   */
  raise(e) {
    const now = Date.now();
    const key = e.key || `${e.type}:${e.zone || 'PLANT'}`;
    const existing = this.alerts.find(a => a.key === key && a.status !== 'RESOLVED');

    if (existing) {
      const escalated = SEVERITY_RANK[e.severity] > SEVERITY_RANK[existing.severity];
      const reactivated = !existing.active;
      const prevEvidenceAt = existing._evidenceAt;
      existing.lastSeenAt = new Date(now).toISOString();
      existing.occurrences += 1;
      existing.active = true;
      existing.message = e.message || existing.message;
      existing.details = { ...existing.details, ...e.details };
      if (e.evidence && (!existing.evidence || escalated || now - existing._evidenceAt > 20000)) {
        existing.evidence = e.evidence;
        existing._evidenceAt = now;
      }
      if (escalated) {
        existing.severity = e.severity;
        existing.title = e.title || existing.title;
        existing.escalatedAt = existing.lastSeenAt;
        this._notify(existing);
      }
      // Throttle routine refreshes; push immediately when something operator-visible changed
      if (escalated || reactivated || existing._evidenceAt !== prevEvidenceAt || now - (existing._emittedAt || 0) > 5000) {
        this._emit('alert:update', existing);
      }
      return existing;
    }

    // Cool-down: a just-resolved alert does not immediately re-open for the same condition
    const recent = this.alerts.find(a => a.key === key && a.status === 'RESOLVED' && now - Date.parse(a.resolvedAt) < config.alerts.cooldownMs);
    if (recent) return recent;

    const zone = this.zones[e.zone];
    const alert = {
      id: `ALR-${new Date(now).toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      key,
      type: e.type,
      severity: e.severity || 'MEDIUM',
      title: e.title,
      message: e.message,
      zone: e.zone || null,
      zoneName: zone?.name || null,
      hazardClass: zone?.hazardClass || null,
      cameraId: e.cameraId || null,
      location: this._location(e.zone, e.cameraId),
      source: e.source || 'system',
      evidence: e.evidence || null,
      _evidenceAt: now,
      details: e.details || {},
      regulations: e.regulations || [],
      recommendedActions: e.recommendedActions || DEFAULT_ACTIONS[e.type] || [],
      recipients: this._recipients(e.type, e.zone),
      status: 'OPEN',
      active: true,
      occurrences: 1,
      createdAt: new Date(now).toISOString(),
      detectedAt: e.detectedAt || new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null,
      deliveries: [{ channel: 'dashboard', status: 'sent', at: new Date(now).toISOString() }],
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > MAX_ALERTS) this.alerts.length = MAX_ALERTS;

    this._emit('alert:new', alert);
    if (SEVERITY_RANK[alert.severity] >= NOTIFY_MIN_RANK) this._notify(alert);
    this.listeners.forEach(fn => { try { fn(alert); } catch (err) { console.error('[Alerts] listener error', err.message); } });
    return alert;
  }

  /** Mark alerts of a key family inactive when their condition is no longer observed. */
  clear(key) {
    const a = this.alerts.find(x => x.key === key && x.status !== 'RESOLVED' && x.active);
    if (a) {
      a.active = false;
      a.clearedAt = new Date().toISOString();
      this._emit('alert:update', a);
    }
  }

  async _notify(alert) {
    const log = await notifier.dispatch(this.public(alert));
    alert.deliveries.push(...log);
    this._emit('alert:update', alert);
  }

  acknowledge(id, by = 'Control Room') {
    const a = this.get(id);
    if (!a || a.status !== 'OPEN') return a;
    a.status = 'ACKNOWLEDGED';
    a.acknowledgedAt = new Date().toISOString();
    a.acknowledgedBy = by;
    this._emit('alert:update', a);
    return a;
  }

  resolve(id, by = 'Control Room', note = '') {
    const a = this.get(id);
    if (!a || a.status === 'RESOLVED') return a;
    if (!a.acknowledgedAt) { a.acknowledgedAt = new Date().toISOString(); a.acknowledgedBy = by; }
    a.status = 'RESOLVED';
    a.active = false;
    a.resolvedAt = new Date().toISOString();
    a.resolvedBy = by;
    a.resolutionNote = note;
    this._emit('alert:update', a);
    return a;
  }

  get(id) { return this.alerts.find(a => a.id === id) || null; }

  list({ status, type, zone, limit = 100, includeEvidence = false } = {}) {
    return this.alerts
      .filter(a => (!status || a.status === status) && (!type || a.type === type) && (!zone || a.zone === zone))
      .slice(0, limit)
      .map(a => this.public(a, includeEvidence));
  }

  stats() {
    const open = this.alerts.filter(a => a.status === 'OPEN');
    const acked = this.alerts.filter(a => a.acknowledgedAt);
    const mtta = acked.length
      ? Math.round(acked.reduce((s, a) => s + (Date.parse(a.acknowledgedAt) - Date.parse(a.createdAt)), 0) / acked.length / 1000)
      : null;
    const byType = {};
    this.alerts.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
    return {
      total: this.alerts.length,
      open: open.length,
      openCritical: open.filter(a => a.severity === 'CRITICAL').length,
      acknowledged: this.alerts.filter(a => a.status === 'ACKNOWLEDGED').length,
      resolved: this.alerts.filter(a => a.status === 'RESOLVED').length,
      meanTimeToAcknowledgeSec: mtta,
      byType,
      channels: notifier.channels(),
    };
  }

  /** Strip internal fields; evidence images are large so lists omit them unless asked. */
  public(a, includeEvidence = true) {
    const { _evidenceAt, _emittedAt, ...rest } = a;
    const base = { ...rest, hasEvidence: !!a.evidence, evidenceAt: a.evidence ? new Date(_evidenceAt).toISOString() : null };
    return includeEvidence ? base : { ...base, evidence: undefined };
  }

  _emit(event, alert) {
    alert._emittedAt = Date.now();
    // New alerts carry their evidence frame; updates only carry evidenceAt (clients refetch if it changed)
    this.io?.emit(event, this.public(alert, event === 'alert:new'));
    this.io?.emit('alerts:stats', this.stats());
  }
}

module.exports = { AlertManager, SEVERITY_RANK };
