// Quality & Compliance Audit Agent — continuously scores live plant conditions against the
// statutory / standard requirements in the knowledge base. Every item carries the evidence
// that produced its status, so an auditor can trace the score back to live data.

const STATUS_SCORE = { COMPLIANT: 95, OBSERVATION: 70, NON_COMPLIANT: 35 };

function item(id, standard, topic, status, evidence, score) {
  return { id, standard, topic, status, evidence, score: score ?? STATUS_SCORE[status] ?? null, lastChecked: new Date().toISOString() };
}

class ComplianceAgent {
  audit({ risk, vision, sensors, permits, alertStats, alerts, emergency }) {
    const rules = new Set((risk?.alerts || []).map(a => a.ruleId));
    const active = permits.filter(p => p.status === 'ACTIVE');
    const items = [];

    const hot = active.filter(p => p.type === 'HOT_WORK');
    items.push(rules.has('CR-001')
      ? item('COMP-001', 'OISD-STD-105', 'Hot work vs flammable atmosphere', 'NON_COMPLIANT', risk.alerts.find(a => a.ruleId === 'CR-001').details)
      : item('COMP-001', 'OISD-STD-105', 'Hot work vs flammable atmosphere', 'COMPLIANT', `${hot.length} hot-work permit(s) active; no flammable build-up near them.`));

    const cs = active.filter(p => p.type === 'CONFINED_SPACE');
    items.push(rules.has('CR-002')
      ? item('COMP-002', 'Factories Act 1948, Section 36', 'Confined-space atmosphere', 'NON_COMPLIANT', risk.alerts.find(a => a.ruleId === 'CR-002').details)
      : item('COMP-002', 'Factories Act 1948, Section 36', 'Confined-space atmosphere', 'COMPLIANT', `${cs.length} confined-space entry permit(s); O₂ within limits.`));

    items.push(rules.has('CR-003')
      ? item('COMP-003', 'OISD-STD-105', 'Simultaneous operations (SIMOPS)', 'NON_COMPLIANT', risk.alerts.filter(a => a.ruleId === 'CR-003').map(a => a.details).join(' '))
      : item('COMP-003', 'OISD-STD-105', 'Simultaneous operations (SIMOPS)', 'COMPLIANT', 'No conflicting permits in the same or adjacent zones.'));

    // PPE compliance from CCTV
    const v = vision;
    if (!v.camerasOnline) {
      items.push(item('COMP-004', 'Factories Act 1948, Section 111 · OISD-STD-155', 'PPE compliance (CCTV)', 'NO_DATA', 'No camera has reported in the last 30 s. Start a feed on the Vision AI page or run the edge agent.', null));
    } else {
      const pct = v.ppeCompliancePct;
      const status = pct === null ? 'COMPLIANT' : pct >= 95 ? 'COMPLIANT' : pct >= 80 ? 'OBSERVATION' : 'NON_COMPLIANT';
      items.push(item('COMP-004', 'Factories Act 1948, Section 111 · OISD-STD-155', 'PPE compliance (CCTV)', status,
        `${v.workersObserved} worker(s) observed on ${v.camerasOnline} camera(s); ${v.ppeViolations} without required PPE (${pct ?? 100}% compliant).`, pct ?? 100));
    }

    // Fire / smoke detection and response
    const fireOpen = alerts.filter(a => (a.type === 'FIRE' || a.type === 'SMOKE') && a.status === 'OPEN');
    const overdue = fireOpen.filter(a => Date.now() - Date.parse(a.createdAt) > 120000);
    items.push(overdue.length
      ? item('COMP-005', 'Factories Act 1948, Section 38 · OISD-STD-116', 'Fire/smoke detection & response', 'NON_COMPLIANT', `${overdue.length} fire/smoke alert(s) unacknowledged for more than 2 minutes.`)
      : fireOpen.length
        ? item('COMP-005', 'Factories Act 1948, Section 38 · OISD-STD-116', 'Fire/smoke detection & response', 'OBSERVATION', `${fireOpen.length} fire/smoke alert(s) open — awaiting acknowledgement.`)
        : item('COMP-005', 'Factories Act 1948, Section 38 · OISD-STD-116', 'Fire/smoke detection & response', 'COMPLIANT', `Automated CCTV fire/smoke detection active on ${v.camerasOnline || 0} camera(s); no open fire alerts.`));

    // Gas detection coverage
    const stale = sensors.filter(s => s.online === false || Date.now() - (s.lastUpdated || 0) > 150000);
    const inAlarm = sensors.filter(s => s.online !== false && !['NORMAL', 'OFFLINE'].includes(s.status));
    items.push(!sensors.length
      ? item('COMP-006', 'Site gas-detection policy', 'Fixed gas detector coverage', 'NO_DATA', 'No gas detectors are connected yet. Connect a telemetry gateway or log handheld readings.', null)
      : stale.length
      ? item('COMP-006', 'Site gas-detection policy', 'Fixed gas detector coverage', 'NON_COMPLIANT', `${stale.length} of ${sensors.length} detector(s) not reporting.`)
      : item('COMP-006', 'Site gas-detection policy', 'Fixed gas detector coverage', inAlarm.length ? 'OBSERVATION' : 'COMPLIANT', `${sensors.length} detectors reporting; ${inAlarm.length} in alarm.`));

    items.push(rules.has('CR-008')
      ? item('COMP-007', 'OISD-GDN-192', 'Shift handover of open permits', 'OBSERVATION', risk.alerts.find(a => a.ruleId === 'CR-008').details)
      : item('COMP-007', 'OISD-GDN-192', 'Shift handover of open permits', 'COMPLIANT', 'No high-risk handover window open.'));

    const mtta = alertStats.meanTimeToAcknowledgeSec;
    items.push(item('COMP-008', 'Factories Act 1948, Section 41H · site KPI', 'Alert acknowledgement time', mtta === null ? 'COMPLIANT' : mtta <= 120 ? 'COMPLIANT' : mtta <= 300 ? 'OBSERVATION' : 'NON_COMPLIANT',
      mtta === null ? 'No alerts acknowledged yet in this session.' : `Mean time to acknowledge: ${mtta}s (target ≤ 120 s).`));

    items.push(emergency?.active
      ? item('COMP-009', 'Factories Act 1948, Section 88', 'Accident notification readiness', emergency.reportGenerated ? 'COMPLIANT' : 'OBSERVATION', emergency.reportGenerated ? 'Emergency active — preliminary incident report generated for statutory notification.' : 'Emergency active — preliminary report being generated.')
      : item('COMP-009', 'Factories Act 1948, Section 88', 'Accident notification readiness', 'COMPLIANT', 'Report generator and evidence preservation ready.'));

    const scored = items.filter(i => i.score !== null);
    const overallScore = scored.length ? Math.round(scored.reduce((s, i) => s + i.score, 0) / scored.length) : null;
    return {
      items, overallScore, lastAudit: new Date().toISOString(),
      summary: {
        compliant: items.filter(i => i.status === 'COMPLIANT').length,
        observations: items.filter(i => i.status === 'OBSERVATION').length,
        nonCompliant: items.filter(i => i.status === 'NON_COMPLIANT').length,
        noData: items.filter(i => i.status === 'NO_DATA').length,
      },
      disclaimer: 'Regulatory references are summaries for decision support; verify against the official texts before formal use.',
    };
  }
}

module.exports = ComplianceAgent;
