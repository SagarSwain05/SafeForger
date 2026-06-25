// Compound Risk Orchestrator — The Brain of SafeForger
// Cross-correlates sensor readings, permits, workers, and shift data to detect compound risks
const { generateWithFallback } = require('./geminiService');
const { getActivePermitsByZone, detectSimops } = require('../data/permitStore');

const RISK_RULES = [
  {
    id: 'CR-001',
    name: 'Hot Work + Gas Accumulation',
    severity: 'CRITICAL',
    regulation: 'OISD-STD-105 Section 4.2 + DGMS Circular 6/2018',
    check: (sensors, permits) => {
      const hotWorkZones = Object.entries(permits)
        .filter(([z, ps]) => ps.some(p => p.type === 'HOT_WORK'))
        .map(([z]) => z);
      const gasReadings = sensors.filter(s =>
        (s.type === 'CH4' || s.type === 'H2S') &&
        hotWorkZones.includes(s.zone) &&
        s.value > (s.warningThreshold * 0.6)
      );
      if (gasReadings.length > 0) {
        return {
          triggered: true,
          details: `Hot work active in ${hotWorkZones.join(', ')} with gas reading at ${gasReadings[0].value.toFixed(1)} ${gasReadings[0].unit} (${((gasReadings[0].value / gasReadings[0].warningThreshold) * 100).toFixed(0)}% of warning threshold)`,
          affectedZones: hotWorkZones,
          sensors: gasReadings.map(s => s.id)
        };
      }
      return { triggered: false };
    }
  },
  {
    id: 'CR-002',
    name: 'Confined Space + O2 Depletion',
    severity: 'CRITICAL',
    regulation: 'OISD-GDN-169 + Factory Act Section 36',
    check: (sensors, permits) => {
      const csZones = Object.entries(permits)
        .filter(([z, ps]) => ps.some(p => p.type === 'CONFINED_SPACE'))
        .map(([z]) => z);
      const o2Sensors = sensors.filter(s =>
        s.type === 'O2' &&
        csZones.includes(s.zone) &&
        s.value < 20.0
      );
      if (o2Sensors.length > 0) {
        return {
          triggered: true,
          details: `Confined space entry active with O2 at ${o2Sensors[0].value.toFixed(1)}% (safe minimum 19.5%). Immediate re-testing required.`,
          affectedZones: csZones,
          sensors: o2Sensors.map(s => s.id)
        };
      }
      return { triggered: false };
    }
  },
  {
    id: 'CR-003',
    name: 'Simultaneous Operations Conflict',
    severity: 'HIGH',
    regulation: 'DGMS Circular 6/2018 — SIMOPS Risk Assessment Required',
    check: (sensors, permits) => {
      const simops = detectSimops();
      if (simops.length > 0) {
        return {
          triggered: true,
          details: `${simops.length} simultaneous operation conflict(s) detected: ${simops.map(s => s.reason).join('; ')}`,
          affectedZones: [],
          conflicts: simops
        };
      }
      return { triggered: false };
    }
  },
  {
    id: 'CR-004',
    name: 'Rising Gas + Multiple Active Permits',
    severity: 'HIGH',
    regulation: 'OISD-STD-105 + OISD-GDN-192',
    check: (sensors, permits) => {
      const activeZones = Object.keys(permits).length;
      const risingGas = sensors.filter(s =>
        (s.type === 'CH4' || s.type === 'H2S') &&
        s.value > s.warningThreshold * 0.5 &&
        s.value <= s.warningThreshold
      );
      if (risingGas.length >= 1 && activeZones >= 2) {
        return {
          triggered: true,
          details: `Gas rising in ${risingGas.length} zone(s) while ${activeZones} permits are active. Below individual alarm thresholds but compound exposure requires immediate review.`,
          affectedZones: [...new Set(risingGas.map(s => s.zone))],
          sensors: risingGas.map(s => s.id)
        };
      }
      return { triggered: false };
    }
  },
  {
    id: 'CR-005',
    name: 'Extreme Temperature + Pressure',
    severity: 'HIGH',
    regulation: 'OISD-STD-118',
    check: (sensors) => {
      const highTemp = sensors.find(s => s.type === 'TEMP' && s.status === 'WARNING');
      const highPress = sensors.find(s => s.type === 'PRESSURE' && s.status === 'WARNING');
      if (highTemp && highPress) {
        return {
          triggered: true,
          details: `Co-occurring high temperature (${highTemp.value.toFixed(1)}°C) and high pressure (${highPress.value.toFixed(1)} bar) detected. Potential runaway risk.`,
          affectedZones: [highTemp.zone, highPress.zone],
          sensors: [highTemp.id, highPress.id]
        };
      }
      return { triggered: false };
    }
  }
];

class CompoundRiskOrchestrator {
  constructor() {
    this.currentAlerts = [];
    this.alertHistory = [];
    this.riskScore = 0;
    this.overallStatus = 'SAFE';
  }

  async analyze(sensorReadings) {
    const permitsByZone = getActivePermitsByZone();
    const triggeredRules = [];

    // Run all compound risk rules
    for (const rule of RISK_RULES) {
      try {
        const result = rule.check(sensorReadings, permitsByZone);
        if (result.triggered) {
          triggeredRules.push({
            ...rule,
            ...result,
            timestamp: new Date().toISOString(),
            id: `ALERT-${rule.id}-${Date.now()}`
          });
        }
      } catch (err) {
        console.error(`Rule ${rule.id} failed:`, err.message);
      }
    }

    // Calculate risk score (0–100)
    let score = 0;
    triggeredRules.forEach(r => {
      if (r.severity === 'CRITICAL') score += 35;
      else if (r.severity === 'HIGH') score += 20;
      else if (r.severity === 'MEDIUM') score += 10;
    });
    // Add base from sensor states
    const criticalSensors = sensorReadings.filter(s => s.status === 'CRITICAL').length;
    const warningSensors = sensorReadings.filter(s => s.status === 'WARNING').length;
    score += criticalSensors * 10 + warningSensors * 3;
    score = Math.min(100, score);

    let status = 'SAFE';
    if (score >= 70) status = 'CRITICAL';
    else if (score >= 40) status = 'HIGH';
    else if (score >= 20) status = 'ELEVATED';
    else if (score >= 5) status = 'LOW';

    this.riskScore = score;
    this.overallStatus = status;
    this.currentAlerts = triggeredRules;

    // AI enrichment for critical alerts
    if (triggeredRules.length > 0 && triggeredRules.some(r => r.severity === 'CRITICAL')) {
      await this._enrichWithAI(triggeredRules, sensorReadings);
    }

    return {
      riskScore: score,
      status,
      alerts: this.currentAlerts,
      timestamp: new Date().toISOString()
    };
  }

  async _enrichWithAI(alerts, sensors) {
    try {
      const context = alerts.map(a => `${a.name}: ${a.details}`).join('\n');
      const sensorSummary = sensors
        .filter(s => s.status !== 'NORMAL')
        .map(s => `${s.id}(${s.type}): ${s.value}${s.unit} [${s.status}]`)
        .join(', ');

      const prompt = `You are an industrial safety AI for a petrochemical plant. Analyze these compound risks and give a concise (2-3 sentence) expert recommendation in plain English, citing specific regulation codes.

COMPOUND RISKS DETECTED:
${context}

SENSOR ANOMALIES:
${sensorSummary}

Provide: 1) Immediate action required, 2) Which regulation is violated, 3) Lead time estimate before escalation.
Keep response under 100 words.`;

      const aiResponse = await generateWithFallback(prompt);
      if (aiResponse) {
        this.currentAlerts = this.currentAlerts.map(a => ({
          ...a,
          aiRecommendation: aiResponse
        }));
      }
    } catch (err) {
      console.error('AI enrichment failed:', err.message);
    }
  }

  getKnowledgeGraph() {
    const permitsByZone = getActivePermitsByZone();
    const nodes = [];
    const edges = [];

    // Zone nodes
    const activeZones = new Set();
    this.currentAlerts.forEach(a => (a.affectedZones || []).forEach(z => activeZones.add(z)));
    Object.keys(permitsByZone).forEach(z => activeZones.add(z));

    activeZones.forEach(zoneId => {
      nodes.push({ id: zoneId, label: zoneId, type: 'ZONE', color: '#4488ff' });
    });

    // Permit nodes
    Object.entries(permitsByZone).forEach(([zoneId, permits]) => {
      permits.forEach(permit => {
        nodes.push({ id: permit.id, label: permit.type, type: 'PERMIT', color: '#ff8844' });
        edges.push({ from: permit.id, to: zoneId, label: 'active_in' });
      });
    });

    // Alert nodes
    this.currentAlerts.forEach(alert => {
      nodes.push({ id: alert.id, label: alert.name, type: 'RISK', color: alert.severity === 'CRITICAL' ? '#ff2244' : '#ff8844' });
      (alert.affectedZones || []).forEach(z => {
        edges.push({ from: alert.id, to: z, label: 'risk_in', color: '#ff2244' });
      });
    });

    return { nodes, edges };
  }
}

module.exports = CompoundRiskOrchestrator;
