// Permit Intelligence Agent — validates permits against live sensor readings
const { generateWithFallback } = require('./geminiService');
const { getPermits, detectSimops } = require('../data/permitStore');
const regulations = require('../data/regulations.json');

class PermitAgent {
  async validatePermit(permitData, currentSensorReadings) {
    const warnings = [];
    const violations = [];

    // Rule 1: Hot work in zone with gas above 10% of warning threshold
    if (permitData.type === 'HOT_WORK') {
      const zoneGas = currentSensorReadings.filter(s =>
        s.zone === permitData.zone &&
        (s.type === 'CH4' || s.type === 'H2S') &&
        s.value > s.warningThreshold * 0.1
      );
      if (zoneGas.length > 0) {
        violations.push({
          severity: 'BLOCK',
          rule: 'OISD-STD-105 Section 4.2',
          message: `Gas detected in zone ${permitData.zone}: ${zoneGas.map(s => `${s.type}=${s.value.toFixed(1)}${s.unit}`).join(', ')}. Hot work cannot proceed.`
        });
      }
    }

    // Rule 2: Confined space — check O2 levels
    if (permitData.type === 'CONFINED_SPACE') {
      const o2Sensor = currentSensorReadings.find(s => s.zone === permitData.zone && s.type === 'O2');
      if (o2Sensor && o2Sensor.value < 19.5) {
        violations.push({
          severity: 'BLOCK',
          rule: 'OISD-GDN-169',
          message: `O2 level at ${o2Sensor.value.toFixed(1)}% in zone ${permitData.zone}. Minimum 19.5% required for entry (OISD-GDN-169).`
        });
      }
      if (o2Sensor && o2Sensor.value < 20.5) {
        warnings.push({
          severity: 'WARN',
          rule: 'OISD-GDN-169',
          message: `O2 at ${o2Sensor.value.toFixed(1)}% — borderline. Continuous monitoring mandatory during entry.`
        });
      }
    }

    // Rule 3: SIMOPS check
    const simops = detectSimops();
    const relevantSimops = simops.filter(s => {
      const permits = getPermits({ status: 'ACTIVE' });
      return permits.some(p => p.zone === permitData.zone);
    });
    if (relevantSimops.length > 0) {
      warnings.push({
        severity: 'WARN',
        rule: 'DGMS Circular 6/2018',
        message: `SIMOPS conflict: ${relevantSimops.length} simultaneous operation(s) in adjacent zones. SIMOPS risk assessment required.`
      });
    }

    // AI-enhanced validation
    let aiAnalysis = null;
    if (violations.length > 0 || warnings.length > 0) {
      const context = [...violations, ...warnings].map(v => v.message).join('\n');
      const prompt = `As an industrial safety AI, analyze this permit request and provide a brief risk assessment.

PERMIT: ${permitData.type} in Zone ${permitData.zone}
ISSUES DETECTED:
${context}

Give a 2-sentence expert recommendation on whether to approve, hold, or block this permit. Cite specific regulation.`;

      aiAnalysis = await generateWithFallback(prompt);
    }

    const canApprove = violations.filter(v => v.severity === 'BLOCK').length === 0;

    return {
      canApprove,
      violations,
      warnings,
      aiAnalysis: aiAnalysis || (canApprove ? 'No blocking violations detected. Standard precautions apply.' : 'BLOCKED: Critical safety violations prevent permit issuance.'),
      riskScore: violations.length * 30 + warnings.length * 10,
      applicableRegs: regulations
        .filter(r => r.tags.some(t => t.includes(permitData.type.toLowerCase().replace('_', ''))))
        .map(r => r.code)
    };
  }
}

module.exports = PermitAgent;
