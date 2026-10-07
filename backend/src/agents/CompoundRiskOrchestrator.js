// Compound Risk Orchestrator — the reasoning core of SafeForge.
//
// Fuses sensors (+ trend forecasts), permits, CCTV vision, worker locations and shift context
// through spatial rules evaluated over the knowledge graph (same / adjacent zones). Produces:
//   • compound-risk alerts with an explainable graph chain and regulation references
//   • a 0–100 risk score per zone (drives the heatmap) and for the plant
//   • lead time: minutes until a worsening sensor near active work reaches its alarm level
// AI recommendations are generated asynchronously and cached, so analysis stays real-time.
const llm = require('../services/llm');
const { detectSimops } = require('../data/permitStore');

const FLAMMABLE = ['CH4', 'H2S'];
const HAZARD_BASE = { CRITICAL: 10, HIGH: 8, MEDIUM: 5, LOW: 2, SAFE: 0 };
const PERMIT_WEIGHT = { HOT_WORK: 12, CONFINED_SPACE: 10, RADIATION: 8, ELECTRICAL_ISOLATION: 5, HEIGHT_WORK: 5, COLD_WORK: 3 };
const RULE_WEIGHT = { CRITICAL: 45, HIGH: 25, MEDIUM: 12 };

const RULES = [
  {
    id: 'CR-001', name: 'Hot Work + Flammable Gas Build-up', severity: 'CRITICAL',
    regulation: 'OISD-STD-105 (hot work) · Factories Act 1948, Section 36',
    actions: ['Suspend the hot-work permit immediately and remove ignition sources', 'Isolate the gas source and ventilate', 'Re-test the atmosphere before work resumes'],
    check: ({ sensors, permitsByZone, kg, fc }) => {
      const hits = [];
      for (const [zone, ps] of Object.entries(permitsByZone)) {
        const hot = ps.filter(p => p.type === 'HOT_WORK');
        if (!hot.length) continue;
        const gas = sensors.filter(s => FLAMMABLE.includes(s.type) && kg.areAdjacent(zone, s.zone) &&
          (s.value > 0.6 * s.warningThreshold || (s.value > 0.35 * s.warningThreshold && fc[s.id]?.trend === 'WORSENING' && fc[s.id]?.etaWarningMin !== null && fc[s.id].etaWarningMin < 15)));
        if (gas.length) {
          const g = gas.sort((a, b) => b.value / b.warningThreshold - a.value / a.warningThreshold)[0];
          hits.push({
            zones: [...new Set([zone, ...gas.map(s => s.zone)])],
            details: `Hot work ${hot.map(p => p.id).join(', ')} active in ${zone} while ${g.type} at ${g.id} (${g.zone}) reads ${g.value} ${g.unit} — ${Math.round(g.value / g.warningThreshold * 100)}% of its alarm level${fc[g.id]?.etaWarningMin ? `, alarm in ~${fc[g.id].etaWarningMin} min` : ''}. No single sensor is in alarm, but this is an ignition scenario.`,
            sensors: gas.map(s => s.id), permits: hot.map(p => p.id),
          });
        }
      }
      return hits;
    },
  },
  {
    id: 'CR-002', name: 'Confined Space Entry + Oxygen Depletion', severity: 'CRITICAL',
    regulation: 'Factories Act 1948, Section 36 · OISD-GDN-169',
    actions: ['Evacuate the confined space now; attendant to account for all entrants', 'Force-ventilate and re-test before re-entry'],
    check: ({ sensors, permitsByZone, fc }) => {
      const hits = [];
      for (const [zone, ps] of Object.entries(permitsByZone)) {
        const cs = ps.filter(p => p.type === 'CONFINED_SPACE');
        if (!cs.length) continue;
        const o2 = sensors.find(s => s.type === 'O2' && s.zone === zone && (s.value < 20.0 || (s.value < 20.5 && fc[s.id]?.trend === 'WORSENING' && fc[s.id]?.etaWarningMin !== null && fc[s.id].etaWarningMin < 20)));
        if (o2) hits.push({ zones: [zone], details: `Confined-space entry ${cs.map(p => p.id).join(', ')} with O₂ at ${o2.value}% (safe minimum 19.5%)${fc[o2.id]?.trend === 'WORSENING' ? ' and falling' : ''}.`, sensors: [o2.id], permits: cs.map(p => p.id) });
      }
      return hits;
    },
  },
  {
    id: 'CR-003', name: 'Simultaneous Operations Conflict', severity: 'HIGH',
    regulation: 'OISD-STD-105 (work permit system — simultaneous operations)',
    actions: ['Hold one of the conflicting permits until a SIMOPS assessment is signed off'],
    check: () => detectSimops().map(c => ({ zones: [...new Set(c.zones)], details: `SIMOPS: ${c.reason} (${c.permitA} / ${c.permitB}).`, permits: [c.permitA, c.permitB] })),
  },
  {
    id: 'CR-004', name: 'Rising Gas Near Active Work', severity: 'HIGH',
    regulation: 'OISD-STD-105 · Factories Act 1948, Section 36',
    actions: ['Increase gas-test frequency at the work site', 'Brief permit holders and prepare to stop work'],
    check: ({ sensors, permitsByZone, kg, fc }) => {
      const hits = [];
      const workZones = Object.keys(permitsByZone);
      for (const s of sensors) {
        if (!FLAMMABLE.includes(s.type) && s.type !== 'CO') continue;
        const f = fc[s.id];
        if (!(f?.trend === 'WORSENING' && s.value > 0.4 * s.warningThreshold && s.value < s.warningThreshold)) continue;
        const near = workZones.filter(z => kg.areAdjacent(z, s.zone));
        if (near.length) hits.push({ zones: [...new Set([s.zone, ...near])], details: `${s.type} at ${s.id} (${s.zone}) rising ${f.slopePerMin}/min to ${s.value} ${s.unit}${f.etaWarningMin ? ` — alarm in ~${f.etaWarningMin} min` : ''}, with permit work in ${near.join(', ')}.`, sensors: [s.id] });
      }
      return hits;
    },
  },
  {
    id: 'CR-005', name: 'High Temperature + High Pressure', severity: 'HIGH',
    regulation: 'OISD-STD-116',
    actions: ['Check relief systems and reduce unit throughput'],
    check: ({ sensors, kg }) => {
      const hot = sensors.filter(s => s.type === 'TEMP' && s.status !== 'NORMAL');
      const press = sensors.filter(s => s.type === 'PRESSURE' && s.status !== 'NORMAL');
      const hits = [];
      hot.forEach(t => press.filter(p => kg.areAdjacent(t.zone, p.zone)).forEach(p => hits.push({ zones: [...new Set([t.zone, p.zone])], details: `Temperature ${t.value}°C (${t.zone}) with pressure ${p.value} bar (${p.zone}) — runaway risk.`, sensors: [t.id, p.id] })));
      return hits;
    },
  },
  {
    id: 'CR-006', name: 'PPE Violation During Permit Work', severity: 'HIGH',
    regulation: 'Factories Act 1948, Section 111 · OISD-STD-155',
    actions: ['Stop the permit work until every worker wears the required PPE'],
    check: ({ vision, permitsByZone }) => Object.entries(vision)
      .filter(([zone, d]) => d.ppe_violations > 0 && (permitsByZone[zone] || []).length)
      .map(([zone, d]) => ({ zones: [zone], details: `${d.ppe_violations} worker(s) on CCTV ${d.camera_id} missing required PPE while ${(permitsByZone[zone] || []).map(p => `${p.id} (${p.type})`).join(', ')} is active.`, cameras: [d.camera_id], permits: permitsByZone[zone].map(p => p.id) })),
  },
  {
    id: 'CR-007', name: 'Visual Fire/Smoke + Process Hazard', severity: 'CRITICAL',
    regulation: 'Factories Act 1948, Section 38 · OISD-STD-116',
    actions: ['Raise the fire alarm and evacuate the zone', 'Stop all hot work plant-wide; isolate fuel sources'],
    check: ({ vision, permitsByZone, sensors, kg, zones }) => Object.entries(vision)
      .filter(([, d]) => d.fire_detected || d.smoke_detected)
      .filter(([zone, d]) => d.fire_detected || (permitsByZone[zone] || []).length || ['CRITICAL', 'HIGH'].includes(zones[zone]?.hazardClass) ||
        sensors.some(s => FLAMMABLE.includes(s.type) && kg.areAdjacent(zone, s.zone) && s.value > 0.4 * s.warningThreshold))
      .map(([zone, d]) => ({ zones: [zone], details: `CCTV ${d.camera_id} shows ${[d.fire_detected && 'fire', d.smoke_detected && 'smoke'].filter(Boolean).join(' and ')} in ${zones[zone]?.name} (${zones[zone]?.hazardClass} hazard)${(permitsByZone[zone] || []).length ? ` with ${(permitsByZone[zone] || []).map(p => p.type).join(', ')} permit active` : ''}.`, cameras: [d.camera_id] })),
  },
  {
    id: 'CR-008', name: 'Shift Handover With High-Risk Permits Open', severity: 'MEDIUM',
    regulation: 'OISD-GDN-192 (shift handover)',
    actions: ['Hold a joint handover walk-down of every open high-risk permit'],
    check: ({ permitsByZone, shift }) => {
      if (!shift?.nextChange) return [];
      const mins = (Date.parse(shift.nextChange) - Date.now()) / 60000;
      const risky = Object.values(permitsByZone).flat().filter(p => ['HOT_WORK', 'CONFINED_SPACE', 'RADIATION'].includes(p.type));
      if (mins < 0 || mins > 30 || risky.length < 2) return [];
      return [{ zones: [...new Set(risky.map(p => p.zone))], details: `Shift change in ${Math.round(mins)} min with ${risky.length} high-risk permits open.`, permits: risky.map(p => p.id) }];
    },
  },
  {
    id: 'CR-009', name: 'Workers Exposed to Critical Atmosphere', severity: 'CRITICAL',
    regulation: 'Factories Act 1948, Section 41H · Section 36',
    actions: ['Order immediate evacuation of the zone and account for all personnel'],
    check: ({ sensors, workers }) => {
      const crit = sensors.filter(s => s.status === 'CRITICAL' && s.type !== 'PRESSURE' && s.type !== 'TEMP');
      return [...new Set(crit.map(s => s.zone))].map(zone => ({ zone, n: workers.filter(w => w.zoneId === zone).length }))
        .filter(x => x.n > 0)
        .map(x => ({ zones: [x.zone], details: `${x.n} worker(s) in ${x.zone} where ${crit.filter(s => s.zone === x.zone).map(s => `${s.type} ${s.value}${s.unit}`).join(', ')} is at a critical level.`, sensors: crit.filter(s => s.zone === x.zone).map(s => s.id) }));
    },
  },
];

const statusOf = (score) => score >= 70 ? 'CRITICAL' : score >= 45 ? 'HIGH' : score >= 25 ? 'ELEVATED' : score >= 10 ? 'LOW' : 'SAFE';

class CompoundRiskOrchestrator {
  constructor({ layout, kg }) {
    this.layout = layout;
    this.kg = kg;
    this.zones = Object.fromEntries(layout.zones.map(z => [z.id, z]));
    this.aiCache = new Map();       // signature → recommendation
    this.aiPending = new Set();
    this.last = { riskScore: 0, status: 'SAFE', alerts: [], zoneScores: {}, forecasts: [], leadTimeMin: null, timestamp: new Date().toISOString() };
  }

  analyze({ sensors = [], permitsByZone = {}, vision = {}, workers = [], shift = null, forecasts = [], emergencyZones = [] }) {
    const fc = Object.fromEntries(forecasts.map(f => [f.sensorId, f]));
    const ctx = { sensors, permitsByZone, vision, workers, shift, fc, kg: this.kg, zones: this.zones };

    const alerts = [];
    for (const rule of RULES) {
      let hits = [];
      try { hits = rule.check(ctx) || []; } catch (err) { console.error(`[Risk] ${rule.id} failed:`, err.message); }
      for (const h of hits) {
        const zoneKey = (h.zones || []).slice().sort().join('+') || 'PLANT';
        alerts.push({
          id: `${rule.id}:${zoneKey}`,
          ruleId: rule.id, name: rule.name, severity: rule.severity, regulation: rule.regulation,
          details: h.details, affectedZones: h.zones || [], sensors: h.sensors || [], permits: h.permits || [], cameras: h.cameras || [],
          recommendedActions: rule.actions,
          triggered: true,
        });
      }
    }

    // Explainability: attach knowledge-graph chains that connect each alert's zones
    const paths = this.kg.compoundPaths({ sensors, permits: Object.values(permitsByZone).flat(), vision, forecasts });
    alerts.forEach(a => {
      a.chains = paths.filter(p => a.affectedZones.includes(p.zone) && (!a.permits.length || a.permits.includes(p.permit))).slice(0, 3).map(p => p.chain);
    });

    // Zone scores
    const zoneScores = {};
    for (const z of this.layout.zones) {
      const drivers = [];
      let score = HAZARD_BASE[z.hazardClass] || 0;
      for (const s of sensors.filter(x => x.zone === z.id)) {
        if (s.status === 'CRITICAL') { score += 35; drivers.push(`${s.type} critical`); }
        else if (s.status === 'WARNING') { score += 15; drivers.push(`${s.type} warning`); }
        else if (fc[s.id]?.trend === 'WORSENING' && s.type !== 'O2' && s.value > 0.4 * s.warningThreshold) { score += 10; drivers.push(`${s.type} rising`); }
      }
      for (const p of permitsByZone[z.id] || []) { score += PERMIT_WEIGHT[p.type] || 4; drivers.push(`${p.type} permit`); }
      const v = vision[z.id];
      if (v) {
        if (v.fire_detected) { score += 60; drivers.push('fire on CCTV'); }
        if (v.smoke_detected) { score += 35; drivers.push('smoke on CCTV'); }
        if (v.ppe_violations > 0) { score += Math.min(25, 10 + 5 * v.ppe_violations); drivers.push(`${v.ppe_violations} PPE violation(s)`); }
      }
      const zoneRules = alerts.filter(x => x.affectedZones.includes(z.id));
      for (const a of zoneRules) { score += RULE_WEIGHT[a.severity] || 10; drivers.push(a.ruleId); }
      // A compound rule sets a floor: CRITICAL always paints the zone red, HIGH at least amber
      if (zoneRules.some(a => a.severity === 'CRITICAL')) score = Math.max(score, 85);
      else if (zoneRules.some(a => a.severity === 'HIGH')) score = Math.max(score, 50);
      if (v?.fire_detected) score = Math.max(score, 90);
      // A zone under a declared emergency stays red until the emergency is stood down
      if (emergencyZones.includes(z.id)) { score = Math.max(score, 90); drivers.push('EMERGENCY active'); }
      score = Math.min(100, Math.round(score));
      zoneScores[z.id] = { score, status: statusOf(score), drivers };
    }

    const scores = Object.values(zoneScores).map(z => z.score).sort((a, b) => b - a);
    const hotZones = scores.filter(s => s >= 45).length;
    const riskScore = Math.min(100, (scores[0] || 0) + Math.max(0, hotZones - 1) * 5);

    // Lead time: soonest alarm among worsening sensors near active work (the "hours ahead" signal)
    const workZones = Object.keys(permitsByZone);
    const leads = forecasts.filter(f => f.trend === 'WORSENING' && f.etaWarningMin && workZones.some(z => this.kg.areAdjacent(z, f.zone)));
    const leadTimeMin = leads.length ? Math.min(...leads.map(f => f.etaWarningMin)) : null;

    this._attachAI(alerts, sensors);

    this.last = {
      riskScore, status: statusOf(riskScore), alerts, zoneScores,
      forecasts: forecasts.filter(f => f.trend !== 'STABLE'),
      leadTimeMin, timestamp: new Date().toISOString(),
    };
    return this.last;
  }

  _attachAI(alerts, sensors) {
    const serious = alerts.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH');
    if (!serious.length || !llm.isConfigured()) return;
    const signature = serious.map(a => a.id).sort().join('|');
    const cached = this.aiCache.get(signature);
    if (cached) { serious.forEach(a => { a.aiRecommendation = cached; }); return; }
    if (this.aiPending.has(signature)) return;
    this.aiPending.add(signature);
    const abnormal = sensors.filter(s => s.status !== 'NORMAL').map(s => `${s.id} ${s.type}=${s.value}${s.unit} [${s.status}]`).join(', ') || 'none in alarm';
    const prompt = `You are the safety AI of an Indian process plant control room. Compound risks detected:
${serious.map(a => `- [${a.severity}] ${a.name}: ${a.details} (ref: ${a.regulation})`).join('\n')}
Sensors in alarm: ${abnormal}.
In under 90 words give: (1) the single most important immediate action, (2) who must do it, (3) why this combination is dangerous even though individual alarms may be silent. Cite only a regulation listed above (Indian standards). Plain text, no markdown.`;
    llm.generate(prompt, { tier: 'fast', maxOutputTokens: 300 })
      .then(text => { if (text) this.aiCache.set(signature, text); if (this.aiCache.size > 50) this.aiCache.delete(this.aiCache.keys().next().value); })
      .finally(() => this.aiPending.delete(signature));
  }

  getLast() { return this.last; }
}

module.exports = CompoundRiskOrchestrator;
module.exports.RULES = RULES;
module.exports.statusOf = statusOf;
