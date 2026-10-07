// Emergency Response Orchestrator — autonomous response once a critical trigger is confirmed:
// declare → alarm/PA → suspend permits in affected zones → notify responders → preserve
// evidence (sensors, permits, CCTV frames, alerts) → generate a statutory preliminary report.
const llm = require('../services/llm');

const blank = () => ({
  active: false, level: null, triggeredAt: null, triggeredBy: null, auto: false, affectedZones: [],
  timeline: [], evidenceSnapshot: null, suspendedPermits: [], reportGenerated: false, report: null,
});

class EmergencyOrchestrator {
  constructor({ io, getPermits, suspendPermit, getVision, getAlerts, raiseAlert, layout }) {
    this.io = io;
    this.getPermits = getPermits;
    this.suspendPermit = suspendPermit;
    this.getVision = getVision || (() => ({}));
    this.getAlerts = getAlerts || (() => []);
    this.raiseAlert = raiseAlert || (() => {});
    this.zones = Object.fromEntries((layout?.zones || []).map(z => [z.id, z]));
    this.state = blank();
    this.timers = [];
    this.lastAutoKey = null;
    this.lastAutoAt = 0;
  }

  _push() { this.io?.emit('emergency:state', this.state); }
  _event(title, description) {
    this.state.timeline.push({ title, description, timestamp: new Date().toISOString() });
    this._push();
  }
  _later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  /** Auto-trigger guard: one automatic declaration per cause key every 5 minutes. */
  shouldAutoTrigger(key) {
    if (this.state.active) return false;
    return !(key === this.lastAutoKey && Date.now() - this.lastAutoAt < 5 * 60000);
  }

  async trigger(level, cause, affectedZones, sensorSnapshot, { auto = false, key = null } = {}) {
    if (this.state.active) return this.state;
    if (auto) { this.lastAutoKey = key; this.lastAutoAt = Date.now(); }
    const zones = (affectedZones || []).filter(Boolean);
    const zoneNames = zones.map(z => `${this.zones[z]?.name || z} (${z})`).join(', ') || 'plant-wide';
    this.state = { ...blank(), active: true, level, auto, triggeredAt: new Date().toISOString(), triggeredBy: cause, affectedZones: zones };

    this._event('🚨 EMERGENCY DECLARED', `${level}${auto ? ' (automatic)' : ''} — ${cause}`);
    this.io?.emit('emergency:triggered', { level, cause, affectedZones: zones, auto });
    this.raiseAlert({ type: 'EMERGENCY', severity: 'CRITICAL', key: 'EMERGENCY:ACTIVE', zone: zones[0], title: `Emergency ${level} declared`, message: `${cause}. Affected: ${zoneNames}.`, source: auto ? 'auto' : 'manual' });

    this._later(500, () => this._event('📢 ALARM & PA ACTIVATED', `Zone alarm sounded; evacuation announcement for ${zoneNames}.`));
    this._later(1200, () => {
      const toSuspend = this.getPermits({ status: 'ACTIVE' }).filter(p => !zones.length || zones.includes(p.zone));
      toSuspend.forEach(p => this.suspendPermit(p.id));
      this.state.suspendedPermits = toSuspend.map(p => p.id);
      this._event('⛔ PERMITS SUSPENDED', toSuspend.length ? `Suspended ${toSuspend.map(p => `${p.id} (${p.type})`).join(', ')}.` : 'No active permits in the affected zones.');
    });
    this._later(2000, () => this._event('🏃 EVACUATION INITIATED', `Personnel in ${zoneNames} directed to Emergency Assembly (Z-15). Head-count in progress.`));
    this._later(2800, () => this._event('📱 RESPONDERS NOTIFIED', 'Fire & Safety, Safety Officer, Shift Supervisor and Plant Manager paged (dashboard + configured channels).'));
    this._later(3600, () => {
      const vision = this.getVision();
      this.state.evidenceSnapshot = {
        frozenAt: new Date().toISOString(),
        sensors: (sensorSnapshot || []).map(({ history, ...s }) => s),
        activePermits: this.getPermits({ status: 'ACTIVE' }).map(p => ({ id: p.id, type: p.type, zone: p.zone })),
        suspendedPermits: this.state.suspendedPermits,
        cctv: Object.values(vision).map(d => ({ camera: d.camera_id, zone: d.zone, workers: d.worker_count, ppeViolations: d.ppe_violations, fire: d.fire_detected, smoke: d.smoke_detected, at: d.timestamp })),
        alerts: this.getAlerts().slice(0, 10).map(a => ({ id: a.id, type: a.type, severity: a.severity, title: a.title, zone: a.zone, createdAt: a.createdAt, hasEvidence: a.hasEvidence })),
      };
      this._event('🗄️ EVIDENCE PRESERVED', `Frozen: ${this.state.evidenceSnapshot.sensors.length} sensor readings, ${this.state.evidenceSnapshot.cctv.length} CCTV states, ${this.state.evidenceSnapshot.alerts.length} alerts (${this.state.evidenceSnapshot.alerts.filter(a => a.hasEvidence).length} with CCTV frames).`);
    });
    this._later(4500, () => this._event('🚒 FIRE & RESCUE MOBILISED', 'Site fire crew dispatched; external fire service on standby.'));
    this._later(5500, async () => {
      this._event('📋 GENERATING INCIDENT REPORT', 'Drafting Factories Act / OISD-aligned preliminary report…');
      const report = await this._report(level, cause, zones, sensorSnapshot);
      if (!this.state.active) return;   // reset while generating
      this.state.report = report;
      this.state.reportGenerated = true;
      this._event('✅ REPORT READY', `Preliminary incident report ${report.reportId} generated (${report.generatedBy}).`);
      this.io?.emit('emergency:report', report);
    });
    return this.state;
  }

  async _report(level, cause, zones, sensors) {
    const abnormal = (sensors || []).filter(s => s.status !== 'NORMAL').map(s => `${s.id} ${s.type} ${s.value}${s.unit} [${s.status}]`).join(', ') || 'none in alarm';
    const vision = Object.values(this.getVision()).filter(d => d.fire_detected || d.smoke_detected || d.ppe_violations)
      .map(d => `${d.camera_id} in ${d.zone}: ${[d.fire_detected && 'fire', d.smoke_detected && 'smoke', d.ppe_violations && `${d.ppe_violations} PPE violation(s)`].filter(Boolean).join(', ')}`).join('; ') || 'no CCTV anomalies';
    const prompt = `Write a formal PRELIMINARY INCIDENT REPORT for an Indian process plant (Visakhapatnam Refinery Unit-3, demo site).
Facts (use only these):
- Emergency level: ${level}; declared ${new Date().toISOString()}${this.state.auto ? ' automatically by the SafeForge risk engine' : ' manually'}
- Trigger: ${cause}
- Affected zones: ${zones.map(z => `${this.zones[z]?.name || z} (${z})`).join(', ') || 'plant-wide'}
- Sensors in alarm: ${abnormal}
- CCTV observations: ${vision}
- Permits suspended: ${this.state.suspendedPermits.join(', ') || 'none'}
Sections (plain text, numbered): 1 Incident summary, 2 Immediate actions taken, 3 Statutory notifications required (Factories Act 1948 s.88 and state rules; PESO/OISD where relevant) with timelines, 4 Preliminary causal indicators, 5 Evidence preserved, 6 Next steps (24 h). Under 300 words. Plain text without markdown symbols. Do not invent injuries or numbers not given.`;
    const ai = await llm.generate(prompt, { tier: 'quality', maxOutputTokens: 1200 });
    return {
      title: 'PRELIMINARY INCIDENT REPORT',
      reportId: `INC-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      generatedBy: ai ? 'AI (Gemini) from preserved evidence' : 'rule-based template',
      classification: level,
      plant: 'Visakhapatnam Refinery Unit-3 (demo site)',
      content: ai || this._fallback(level, cause, zones, abnormal, vision),
      regulatory: ['Factories Act 1948, Section 88 — notice of accident', 'Chief Inspector of Factories (state)', 'PESO / OISD (petroleum installations)'],
      status: 'PRELIMINARY',
    };
  }

  _fallback(level, cause, zones, abnormal, vision) {
    const t = new Date().toLocaleString('en-IN');
    return `PRELIMINARY INCIDENT REPORT — ${t}

1. INCIDENT SUMMARY
An emergency (${level}) was declared at Visakhapatnam Refinery Unit-3 at ${t}. Trigger: ${cause}. Affected zones: ${zones.join(', ') || 'plant-wide'}.

2. IMMEDIATE ACTIONS TAKEN
• Zone alarm and PA evacuation announcement
• Permits suspended: ${this.state.suspendedPermits.join(', ') || 'none active in the affected zones'}
• Personnel evacuated to Emergency Assembly (Z-15); head-count initiated
• Fire & Safety, Safety Officer and Shift Supervisor notified

3. STATUTORY NOTIFICATIONS REQUIRED
• Inspector of Factories — per Factories Act 1948, Section 88 and state rules, if reportable injury occurs
• PESO / OISD — for petroleum installations, as applicable

4. PRELIMINARY CAUSAL INDICATORS
Sensors in alarm: ${abnormal}. CCTV: ${vision}.

5. EVIDENCE PRESERVED
Sensor snapshot, permit register, CCTV detection states and alert frames frozen at trigger time.

6. NEXT STEPS (24 h)
• Preserve the scene; joint investigation
• Verify head-count and medical status
• Root-cause analysis before permits are re-issued`;
  }

  reset() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.state = blank();
    this._push();
    this.io?.emit('emergency:reset', this.state);
    return this.state;
  }

  getState() { return this.state; }
}

module.exports = EmergencyOrchestrator;
