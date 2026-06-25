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
  },
  {
    id: 'CR-006',
    name: 'PPE Violation + Active Permit',
    severity: 'HIGH',
    regulation: 'OISD-STD-105 + site PPE matrix',
    check: (sensors, permits, context = {}) => {
      const cvByZone = context.cvDetections ?? {};
      const violations = Object.entries(cvByZone)
        .map(([zone, d]) => ({
          zone,
          count: d.ppe_violations ?? d.ppeViolations ?? 0,
          camera: d.camera_id ?? d.cameraId,
        }))
        .filter(v => v.count > 0 && (permits[v.zone] ?? []).length > 0);

      if (violations.length > 0) {
        return {
          triggered: true,
          details: `${violations.reduce((sum, v) => sum + v.count, 0)} PPE violation(s) detected by CCTV while permit work is active.`,
          affectedZones: [...new Set(violations.map(v => v.zone))],
          cameras: violations.map(v => v.camera).filter(Boolean),
        };
      }
      return { triggered: false };
    }
  },
  {
    id: 'CR-007',
    name: 'Visual Smoke + Process Hazard',
    severity: 'CRITICAL',
    regulation: 'OISD-STD-116 + emergency response plan',
    check: (sensors, permits, context = {}) => {
      const cvByZone = context.cvDetections ?? {};
      const smokeZones = Object.entries(cvByZone)
        .filter(([, d]) => d.smoke_detected || d.smokeDetected)
        .map(([zone]) => zone);

      if (smokeZones.length === 0) return { triggered: false };

      const processHazards = sensors.filter(s =>
        smokeZones.includes(s.zone) &&
        (s.status === 'WARNING' || s.status === 'CRITICAL' || (permits[s.zone] ?? []).length > 0)
      );

      if (processHazards.length > 0 || smokeZones.some(z => (permits[z] ?? []).length > 0)) {
        return {
          triggered: true,
          details: `CCTV smoke indication in ${smokeZones.join(', ')} with active process hazard or permit context. Dispatch field verification and isolate ignition sources.`,
          affectedZones: smokeZones,
          sensors: processHazards.map(s => s.id),
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
    this.lastSensorReadings = [];
    this.lastContext = {};
  }

  async analyze(sensorReadings, context = {}) {
    const permitsByZone = getActivePermitsByZone();
    const triggeredRules = [];
    this.lastSensorReadings = sensorReadings;
    this.lastContext = context;

    // Run all compound risk rules
    for (const rule of RISK_RULES) {
      try {
        const result = rule.check(sensorReadings, permitsByZone, context);
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

    const cvDetections = Object.values(context.cvDetections ?? {});
    const ppeViolations = cvDetections.reduce((sum, d) => sum + (d.ppe_violations ?? d.ppeViolations ?? 0), 0);
    const smokeDetections = cvDetections.filter(d => d.smoke_detected || d.smokeDetected).length;
    score += Math.min(15, ppeViolations * 5) + smokeDetections * 20;
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
    const sensors = this.lastSensorReadings ?? [];
    const cvDetections = this.lastContext.cvDetections ?? {};
    const scadaRegisters = this.lastContext.scada?.registers ?? [];
    const nodes = [];
    const edges = [];
    const seen = new Set();

    const addNode = (node) => {
      if (seen.has(node.id)) return;
      nodes.push(node);
      seen.add(node.id);
    };

    // Zone nodes
    const activeZones = new Set();
    this.currentAlerts.forEach(a => (a.affectedZones || []).forEach(z => activeZones.add(z)));
    Object.keys(permitsByZone).forEach(z => activeZones.add(z));
    sensors.forEach(s => activeZones.add(s.zone));
    Object.keys(cvDetections).forEach(z => activeZones.add(z));
    scadaRegisters.forEach(r => activeZones.add(r.zone));

    activeZones.forEach(zoneId => {
      addNode({ id: zoneId, label: zoneId, type: 'ZONE', color: '#4488ff' });
    });

    // Permit nodes
    Object.entries(permitsByZone).forEach(([zoneId, permits]) => {
      permits.forEach(permit => {
        addNode({ id: permit.id, label: permit.type, type: 'PERMIT', color: '#ff8844' });
        edges.push({ from: permit.id, to: zoneId, label: 'active_in' });
      });
    });

    // Sensor nodes
    sensors.forEach(sensor => {
      const color = sensor.status === 'CRITICAL' ? '#ff2244' : sensor.status === 'WARNING' ? '#ffb300' : '#00cc77';
      addNode({ id: sensor.id, label: `${sensor.type}: ${sensor.value}${sensor.unit}`, type: 'SENSOR', color });
      edges.push({ from: sensor.id, to: sensor.zone, label: 'located_in' });
    });

    // CCTV nodes
    Object.entries(cvDetections).forEach(([zoneId, detection]) => {
      const cameraId = detection.camera_id ?? detection.cameraId ?? `CV-${zoneId}`;
      const violationCount = detection.ppe_violations ?? detection.ppeViolations ?? 0;
      const smoke = detection.smoke_detected || detection.smokeDetected;
      addNode({
        id: cameraId,
        label: `${cameraId}: ${detection.worker_count ?? detection.workerCount ?? 0} workers`,
        type: 'CCTV',
        color: smoke ? '#ff2244' : violationCount > 0 ? '#ff8844' : '#00cc77',
      });
      edges.push({ from: cameraId, to: zoneId, label: 'observes' });
    });

    // SCADA register nodes, limited to abnormal or first few normals to keep graph readable
    scadaRegisters
      .filter((r, idx) => r.status !== 'NORMAL' || idx < 8)
      .forEach(reg => {
        const id = `REG-${reg.address}`;
        const color = reg.status === 'CRITICAL' ? '#ff2244' : reg.status === 'WARNING' ? '#ffb300' : '#4aa3ff';
        addNode({ id, label: `${reg.name}: ${reg.value}${reg.unit}`, type: 'SCADA', color });
        edges.push({ from: id, to: reg.zone, label: 'measures' });
      });

    // Alert nodes
    this.currentAlerts.forEach(alert => {
      addNode({ id: alert.id, label: alert.name, type: 'RISK', color: alert.severity === 'CRITICAL' ? '#ff2244' : '#ff8844' });
      (alert.affectedZones || []).forEach(z => {
        edges.push({ from: alert.id, to: z, label: 'risk_in', color: '#ff2244' });
      });
    });

    return { nodes, edges };
  }
}

module.exports = CompoundRiskOrchestrator;
