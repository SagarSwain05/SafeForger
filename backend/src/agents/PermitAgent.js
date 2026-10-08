// Permit Intelligence Agent — validates a permit request against live conditions before it is
// issued: atmosphere in the zone and adjacent zones, SIMOPS conflicts, CCTV PPE compliance,
// and the PPE the work will require. Blocks unsafe permits; explains every decision.
const llm = require('../services/llm');
const { PERMIT_TYPES } = require('../data/permitStore');
const regulations = require('../data/regulations.json');

const FLAMMABLE = ['CH4', 'H2S'];

class PermitAgent {
  constructor({ kg, layout, permits }) {
    this.kg = kg;
    this.permits = permits;
    this.layout = layout;
  }

  async validatePermit(permitData, sensors, { vision = {}, requiredPPE = null } = {}) {
    const violations = [];
    const warnings = [];
    const type = permitData.type;
    const zone = permitData.zone;
    if (!PERMIT_TYPES[type]) return { canApprove: false, violations: [{ severity: 'BLOCK', rule: 'Input', message: `Unknown permit type ${type}` }], warnings, riskScore: 100, aiAnalysis: 'Invalid permit type.' };
    const near = (s) => this.kg.areAdjacent(zone, s.zone);

    if (type === 'HOT_WORK') {
      const gas = sensors.filter(s => FLAMMABLE.includes(s.type) && near(s) && s.value > s.warningThreshold * 0.1 && s.value > (s.baseline ?? 0) * 1.5);
      gas.forEach(s => {
        const blocking = s.zone === zone ? s.value > s.warningThreshold * 0.25 : s.value > s.warningThreshold * 0.5;
        (blocking ? violations : warnings).push({
          severity: blocking ? 'BLOCK' : 'WARN', rule: 'OISD-STD-105',
          message: `${s.type} at ${s.id} (${s.zone === zone ? 'this zone' : `adjacent ${s.zone}`}) reads ${s.value} ${s.unit} — ${Math.round(s.value / s.warningThreshold * 100)}% of alarm level. ${blocking ? 'Hot work cannot be authorised until the atmosphere is cleared.' : 'Continuous gas monitoring required.'}`,
        });
      });
    }

    if (type === 'CONFINED_SPACE') {
      const o2 = sensors.find(s => s.type === 'O2' && s.zone === zone);
      if (o2 && o2.value < 19.5) violations.push({ severity: 'BLOCK', rule: 'Factories Act 1948, Section 36', message: `O₂ at ${o2.value}% in ${zone}; minimum 19.5% required for entry.` });
      else if (o2 && o2.value < 20.5) warnings.push({ severity: 'WARN', rule: 'Factories Act 1948, Section 36', message: `O₂ at ${o2.value}% — borderline. Continuous monitoring and a standby attendant are mandatory.` });
      const gas = sensors.filter(s => FLAMMABLE.includes(s.type) && s.zone === zone && s.value > s.warningThreshold * 0.1);
      gas.forEach(s => violations.push({ severity: 'BLOCK', rule: 'Factories Act 1948, Section 36', message: `${s.type} ${s.value} ${s.unit} inside the confined space.` }));
    }

    const conflicts = this.permits.detectSimops({ type, zone, id: 'NEW' });
    conflicts.forEach(c => warnings.push({ severity: 'WARN', rule: 'OISD-STD-105 (SIMOPS)', message: `${c.reason}. A SIMOPS risk assessment must be signed before issue.` }));

    const v = vision[zone];
    if (v && v.ppe_violations > 0) {
      warnings.push({ severity: 'WARN', rule: 'Factories Act 1948, Section 111', message: `CCTV ${v.camera_id} currently shows ${v.ppe_violations} worker(s) in ${zone} without required PPE.` });
    }
    if (v && (v.fire_detected || v.smoke_detected)) {
      violations.push({ severity: 'BLOCK', rule: 'Factories Act 1948, Section 38', message: `CCTV ${v.camera_id} reports ${v.fire_detected ? 'fire' : 'smoke'} in ${zone}.` });
    }

    let aiAnalysis = null;
    if (violations.length || warnings.length) {
      const prompt = `As a permit-to-work safety reviewer at an Indian process plant, give a 2-sentence recommendation (approve / hold / reject) for this request. Cite only a regulation named in the findings. Plain text, no markdown.
PERMIT: ${PERMIT_TYPES[type].label} in zone ${zone}.
FINDINGS:
${[...violations, ...warnings].map(x => `- [${x.severity}] ${x.message}`).join('\n')}`;
      aiAnalysis = await llm.generate(prompt, { tier: 'fast', maxOutputTokens: 200 });
    }

    const canApprove = violations.length === 0;
    const tag = type.toLowerCase();
    return {
      canApprove,
      decision: canApprove ? (warnings.length ? 'APPROVE_WITH_CONDITIONS' : 'APPROVE') : 'BLOCK',
      violations, warnings,
      requiredPPE,
      aiAnalysis: aiAnalysis || (canApprove
        ? (warnings.length ? 'Approve with conditions: address every warning before work starts.' : 'No blocking conditions detected. Standard precautions apply.')
        : 'BLOCKED: live conditions make this work unsafe. Resolve the blocking findings and re-validate.'),
      riskScore: Math.min(100, violations.length * 35 + warnings.length * 10 + (PERMIT_TYPES[type].risk || 0) * 2),
      applicableRegs: regulations.filter(r => (r.tags || []).some(t => t === tag || t.replace(/_/g, '') === tag.replace(/_/g, ''))).map(r => r.code),
    };
  }
}

module.exports = PermitAgent;
