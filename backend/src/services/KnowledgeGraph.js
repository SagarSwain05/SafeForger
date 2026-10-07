// Knowledge Graph — in-memory property graph of the plant's live state.
//
// Nodes: Zone, Sensor, Permit, Worker, Camera, Alert   Edges: located_in, active_in,
// adjacent_to, observes, assigned_to, risk_in. Rebuilt from live state on demand (cheap at
// plant scale) and traversed to explain *why* a set of individually-safe signals forms a
// compound risk: e.g.  PTW-007 (HOT_WORK) ─active_in→ Z-01 ←located_in─ S-GAS-01 (CH4 rising).
// The same model maps 1:1 onto Neo4j labels/relationships for a production graph store.

const ADJACENCY_GAP = 60; // plant units between zone rectangles that still count as "adjacent"

function zoneGap(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

function buildAdjacency(zones) {
  const adj = {};
  zones.forEach(z => { adj[z.id] = new Set(); });
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (zoneGap(zones[i], zones[j]) <= ADJACENCY_GAP) {
        adj[zones[i].id].add(zones[j].id);
        adj[zones[j].id].add(zones[i].id);
      }
    }
  }
  return adj;
}

const COLORS = { ZONE: '#4488ff', SENSOR_OK: '#00cc77', SENSOR_WARN: '#ffb300', SENSOR_CRIT: '#ff2244', PERMIT: '#ff8844', WORKER: '#44ff88', CAMERA: '#b388ff', RISK: '#ff2244' };

class KnowledgeGraph {
  constructor(layout) {
    this.layout = layout;
    this.zones = Object.fromEntries(layout.zones.map(z => [z.id, z]));
    this.adjacency = buildAdjacency(layout.zones);
  }

  areAdjacent(a, b) { return a === b || !!this.adjacency[a]?.has(b); }
  neighbours(zoneId) { return [...(this.adjacency[zoneId] || [])]; }

  /** Graph snapshot for visualisation. state = { sensors, permits, workers, vision, alerts, forecasts } */
  snapshot(state) {
    const nodes = [];
    const edges = [];
    const seen = new Set();
    const add = (n) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
    const activePermits = (state.permits || []).filter(p => p.status === 'ACTIVE');
    const fc = Object.fromEntries((state.forecasts || []).map(f => [f.sensorId, f]));

    // Only zones that carry live context, plus their neighbours that carry context too
    const relevant = new Set([
      ...activePermits.map(p => p.zone),
      ...(state.sensors || []).filter(s => s.status !== 'NORMAL' || fc[s.id]?.trend === 'WORSENING').map(s => s.zone),
      ...Object.keys(state.vision || {}),
      ...(state.alerts || []).flatMap(a => a.affectedZones || (a.zone ? [a.zone] : [])),
      ...(state.sensors || []).map(s => s.zone),
    ]);
    relevant.forEach(zid => {
      const z = this.zones[zid];
      if (z) add({ id: zid, label: `${zid} ${z.name}`, type: 'ZONE', color: COLORS.ZONE, hazardClass: z.hazardClass });
    });
    relevant.forEach(zid => this.neighbours(zid).forEach(n => {
      if (relevant.has(n) && zid < n) edges.push({ from: zid, to: n, label: 'adjacent_to', color: 'rgba(68,136,255,0.35)' });
    }));

    (state.sensors || []).forEach(s => {
      const f = fc[s.id];
      const color = s.status === 'CRITICAL' ? COLORS.SENSOR_CRIT : (s.status === 'WARNING' || f?.trend === 'WORSENING') ? COLORS.SENSOR_WARN : COLORS.SENSOR_OK;
      add({ id: s.id, label: `${s.type} ${s.value}${s.unit}${f?.trend === 'WORSENING' ? ' ↑' : ''}`, type: 'SENSOR', color });
      edges.push({ from: s.id, to: s.zone, label: 'located_in' });
    });

    activePermits.forEach(p => {
      add({ id: p.id, label: `${p.id} ${p.type}`, type: 'PERMIT', color: COLORS.PERMIT });
      edges.push({ from: p.id, to: p.zone, label: 'active_in' });
      (p.workers || []).forEach(wid => {
        const w = (state.workers || []).find(x => x.id === wid);
        if (w) {
          add({ id: w.id, label: `${w.name} (${w.role})`, type: 'WORKER', color: COLORS.WORKER });
          edges.push({ from: w.id, to: p.id, label: 'assigned_to' });
        }
      });
    });

    Object.entries(state.vision || {}).forEach(([zid, v]) => {
      const cam = v.camera_id || `CV-${zid}`;
      const color = v.fire_detected || v.smoke_detected ? COLORS.SENSOR_CRIT : v.ppe_violations > 0 ? COLORS.PERMIT : COLORS.CAMERA;
      const tags = [v.fire_detected && 'FIRE', v.smoke_detected && 'SMOKE', v.ppe_violations > 0 && `${v.ppe_violations} PPE`].filter(Boolean);
      add({ id: cam, label: `${cam}: ${v.worker_count ?? 0} workers${tags.length ? ' · ' + tags.join(', ') : ''}`, type: 'CCTV', color });
      edges.push({ from: cam, to: zid, label: 'observes' });
    });

    (state.alerts || []).forEach(a => {
      add({ id: a.id, label: a.name || a.title, type: 'RISK', color: a.severity === 'CRITICAL' ? COLORS.RISK : '#ff8844' });
      (a.affectedZones || (a.zone ? [a.zone] : [])).forEach(z => edges.push({ from: a.id, to: z, label: 'risk_in', color: '#ff2244' }));
    });

    return { nodes, edges, stats: { nodes: nodes.length, edges: edges.length } };
  }

  /**
   * Traverse permit → zone (+ adjacent zones) ← sensors/cameras to find compound-risk chains.
   * Returns explainable paths used by the risk engine and shown to operators.
   */
  compoundPaths(state) {
    const paths = [];
    const fc = Object.fromEntries((state.forecasts || []).map(f => [f.sensorId, f]));
    const activePermits = (state.permits || []).filter(p => p.status === 'ACTIVE');
    for (const p of activePermits) {
      const scope = [p.zone, ...this.neighbours(p.zone)];
      for (const s of (state.sensors || [])) {
        if (!scope.includes(s.zone)) continue;
        const f = fc[s.id];
        const elevated = s.status !== 'NORMAL' || (f && f.trend === 'WORSENING') || (s.type !== 'O2' && s.value > 0.5 * s.warningThreshold);
        if (!elevated) continue;
        paths.push({
          kind: 'PERMIT_SENSOR',
          permit: p.id, permitType: p.type, zone: p.zone, sensor: s.id, sensorZone: s.zone,
          adjacent: s.zone !== p.zone,
          chain: [`${p.id} (${p.type})`, `active_in ${p.zone}`, `${s.zone === p.zone ? 'same zone' : 'adjacent ' + s.zone}`, `${s.id} ${s.type} ${s.value}${s.unit}${f?.trend === 'WORSENING' ? ' rising' : ''}${f?.etaWarningMin ? `, alarm in ~${f.etaWarningMin} min` : ''}`],
        });
      }
      const v = (state.vision || {})[p.zone];
      if (v && (v.ppe_violations > 0 || v.fire_detected || v.smoke_detected)) {
        paths.push({
          kind: 'PERMIT_VISION', permit: p.id, permitType: p.type, zone: p.zone, camera: v.camera_id,
          chain: [`${p.id} (${p.type})`, `active_in ${p.zone}`, `observed_by ${v.camera_id}`, [v.fire_detected && 'fire', v.smoke_detected && 'smoke', v.ppe_violations > 0 && `${v.ppe_violations} PPE violation(s)`].filter(Boolean).join(' + ')],
        });
      }
    }
    return paths;
  }
}

module.exports = { KnowledgeGraph, buildAdjacency, zoneGap };
