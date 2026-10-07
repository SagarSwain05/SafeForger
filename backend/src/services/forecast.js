// Temporal forecasting — least-squares trend on each sensor's recent history to estimate
// how long until it crosses its warning / critical threshold (the "lead time" a single
// threshold alarm never gives you).

function linearFit(points) {
  const n = points.length;
  if (n < 4) return null;
  const t0 = points[0].t;
  const xs = points.map(p => (p.t - t0) / 60000);   // minutes
  const ys = points.map(p => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;                            // units per minute
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, r2 };
}

/**
 * @param {object} s sensor reading with history [{t, v}], warningThreshold, criticalThreshold, type
 * @returns forecast or null if not enough data
 */
function forecastSensor(s, window = 10) {
  const hist = (s.history || []).slice(-window);
  const fit = linearFit(hist);
  if (!fit) return null;
  const inverted = s.type === 'O2';                   // O2 is dangerous when it falls
  const towardDanger = inverted ? -fit.slope : fit.slope;
  // A trend only counts when it is consistent (r²) and large relative to the sensor's
  // normal operating band (baseline → warning); this filters out mean-reverting noise.
  const span = Math.max(...hist.map(p => p.v)) - Math.min(...hist.map(p => p.v));
  const band = Math.abs(s.warningThreshold - (s.baseline ?? hist[0].v)) || 1;
  const meaningful = fit.r2 > 0.6 && span > 0.12 * band && Math.abs(fit.slope) * 10 > 0.05 * band;

  const eta = (threshold) => {
    const gap = inverted ? s.value - threshold : threshold - s.value;
    if (gap <= 0) return 0;
    if (!meaningful || towardDanger <= 0) return null;
    return +(gap / towardDanger).toFixed(1);
  };

  return {
    sensorId: s.id,
    zone: s.zone,
    type: s.type,
    value: s.value,
    unit: s.unit,
    slopePerMin: +fit.slope.toFixed(3),
    r2: +fit.r2.toFixed(2),
    trend: !meaningful ? 'STABLE' : towardDanger > 0 ? 'WORSENING' : 'IMPROVING',
    pctOfWarning: inverted ? null : +((s.value / s.warningThreshold) * 100).toFixed(0),
    etaWarningMin: eta(s.warningThreshold),
    etaCriticalMin: eta(s.criticalThreshold),
  };
}

function forecastAll(readings) {
  return readings.map(r => forecastSensor(r)).filter(Boolean);
}

module.exports = { forecastSensor, forecastAll, linearFit };
