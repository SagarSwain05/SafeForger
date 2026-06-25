// Emergency Response Orchestrator — Autonomous response on critical trigger
const { generateWithFallback } = require('./geminiService');
const { getPermits } = require('../data/permitStore');

let emergencyState = {
  active: false,
  level: null,
  triggeredAt: null,
  triggeredBy: null,
  affectedZones: [],
  timeline: [],
  evidenceSnapshot: null,
  reportGenerated: false,
  report: null
};

class EmergencyOrchestrator {
  constructor(io) {
    this.io = io;
  }

  async trigger(level, cause, affectedZones, sensorSnapshot) {
    if (emergencyState.active) return emergencyState;

    const now = new Date().toISOString();
    emergencyState = {
      active: true,
      level, // 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'
      triggeredAt: now,
      triggeredBy: cause,
      affectedZones,
      timeline: [],
      evidenceSnapshot: null,
      reportGenerated: false,
      report: null
    };

    // Autonomous response sequence
    this._addEvent('🚨 EMERGENCY DECLARED', `Level: ${level} | Cause: ${cause}`);
    
    setTimeout(() => {
      this._addEvent('📢 PA SYSTEM ACTIVATED', 'Plant-wide emergency announcement broadcast');
      this.io?.emit('emergency:state', emergencyState);
    }, 500);

    setTimeout(() => {
      this._addEvent('🏃 EVACUATION INITIATED', `Zones affected: ${affectedZones.join(', ')}. All non-essential personnel to Assembly Point A`);
      this.io?.emit('emergency:state', emergencyState);
    }, 1200);

    setTimeout(() => {
      this._addEvent('📱 ALERTS DISPATCHED', 'SMS sent to: Safety Officer, Plant Manager, DGMS Regional Office, Fire Station');
      this.io?.emit('emergency:state', emergencyState);
    }, 2000);

    setTimeout(() => {
      // Preserve evidence
      emergencyState.evidenceSnapshot = {
        timestamp: now,
        sensors: sensorSnapshot,
        activePermits: getPermits({ status: 'ACTIVE' }).map(p => ({ id: p.id, type: p.type, zone: p.zone })),
        frozenAt: new Date().toISOString()
      };
      this._addEvent('🗄️ EVIDENCE PRESERVED', 'Sensor readings, permit logs, and CCTV timestamps frozen for regulatory compliance');
      this.io?.emit('emergency:state', emergencyState);
    }, 3000);

    setTimeout(() => {
      this._addEvent('🚒 FIRE & RESCUE NOTIFIED', 'Emergency response team mobilized. ETA: 4 minutes');
      this.io?.emit('emergency:state', emergencyState);
    }, 4000);

    setTimeout(async () => {
      this._addEvent('📋 GENERATING INCIDENT REPORT', 'DGMS/Factory Act compliant preliminary report in progress...');
      this.io?.emit('emergency:state', emergencyState);
      
      const report = await this._generateReport(level, cause, affectedZones, sensorSnapshot);
      emergencyState.report = report;
      emergencyState.reportGenerated = true;
      this._addEvent('✅ REPORT READY', 'Preliminary DGMS/Factory Act compliant incident report generated');
      this.io?.emit('emergency:state', emergencyState);
      this.io?.emit('emergency:report', report);
    }, 6000);

    this.io?.emit('emergency:triggered', { level, cause, affectedZones });
    return emergencyState;
  }

  async _generateReport(level, cause, affectedZones, sensorSnapshot) {
    const sensorsText = (sensorSnapshot || [])
      .filter(s => s.status !== 'NORMAL')
      .map(s => `${s.id}: ${s.value}${s.unit} [${s.status}]`)
      .join(', ');
    const activePermits = getPermits({ status: 'ACTIVE' });
    const permitsText = activePermits.map(p => `${p.id} (${p.type} in ${p.zone})`).join(', ');

    const prompt = `Generate a DGMS/Factory Act compliant preliminary incident report for a petrochemical plant emergency.

INCIDENT DETAILS:
- Emergency Level: ${level}
- Cause: ${cause}
- Time: ${new Date().toISOString()}
- Plant: Visakhapatnam Refinery Unit-3
- Affected Zones: ${affectedZones.join(', ')}
- Abnormal Sensor Readings: ${sensorsText}
- Active Permits at Time of Incident: ${permitsText}

Generate a formal preliminary incident report with these sections:
1. INCIDENT SUMMARY (2-3 sentences)
2. IMMEDIATE ACTIONS TAKEN (bullet points)
3. REGULATORY NOTIFICATIONS REQUIRED (list agencies with timeline)
4. PRELIMINARY ROOT CAUSE INDICATORS
5. EVIDENCE PRESERVED
6. NEXT STEPS (within 24 hours)

Use formal language. Cite OISD/DGMS/Factory Act references where applicable. Keep under 300 words.`;

    const aiReport = await generateWithFallback(prompt);
    
    return {
      title: 'PRELIMINARY INCIDENT REPORT',
      reportId: `INC-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      classification: level,
      plant: 'Visakhapatnam Refinery Unit-3',
      content: aiReport || this._getFallbackReport(level, cause, affectedZones),
      regulatory: ['DGMS Regional Office — Visakhapatnam', 'Factory Inspector', 'PESO (Petroleum & Explosives Safety Organisation)'],
      status: 'PRELIMINARY'
    };
  }

  _getFallbackReport(level, cause, affectedZones) {
    return `PRELIMINARY INCIDENT REPORT — ${new Date().toLocaleString()}

1. INCIDENT SUMMARY
An emergency condition (${level}) was triggered at Visakhapatnam Refinery Unit-3 at ${new Date().toLocaleString()}. The triggering condition was: ${cause}. Affected zones: ${affectedZones.join(', ')}.

2. IMMEDIATE ACTIONS TAKEN
• PA system activated — plant-wide evacuation announced
• All non-essential personnel evacuated to Assembly Point A
• Emergency response team notified
• SCADA system set to safe state
• All work permits suspended

3. REGULATORY NOTIFICATIONS REQUIRED
• DGMS Regional Office — within 2 hours (per DGMS Circular)
• Chief Inspector of Factories — within 24 hours (Factory Act Section 88)
• State Pollution Control Board — if gas release detected

4. PRELIMINARY ROOT CAUSE INDICATORS
${cause}. Full investigation per OISD investigation protocol to follow.

5. EVIDENCE PRESERVED
Sensor readings, permit logs, CCTV timestamps preserved at trigger time.

6. NEXT STEPS
• Site preservation for investigation
• Worker head-count verification
• DGMS joint investigation initiation`;
  }

  reset() {
    emergencyState = {
      active: false, level: null, triggeredAt: null, triggeredBy: null,
      affectedZones: [], timeline: [], evidenceSnapshot: null, reportGenerated: false, report: null
    };
    return emergencyState;
  }

  getState() { return emergencyState; }

  _addEvent(title, description) {
    emergencyState.timeline.push({ title, description, timestamp: new Date().toISOString() });
  }
}

module.exports = EmergencyOrchestrator;
