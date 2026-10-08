// IoT Sensor Simulator (simulated / demo sites only) — mean-reverting (Ornstein–Uhlenbeck) noise
// around each site's own baselines, the site's "active situation" (a developing hazard), and
// scripted scenario drifts for the demo. Live sites never use this: their readings come from
// real telemetry (see LiveTelemetry).
const { EventEmitter } = require('events');
const defaultLayout = require('../data/plant-layout.json');
const { SENSOR_TYPES } = require('../sites/profile');

const REVERSION = 0.15;
const SCENARIO_RATE = { KILL_CHAIN: 0.06, EMERGENCY: 0.12 };
const SITUATION_RATE = 0.02;   // situations develop slowly

/** Scenario targets derived from the site's sensor plan (no hard-coded sensor ids). */
function scenarioTargets(scenario, sensors) {
  const t = {};
  if (scenario === 'KILL_CHAIN') {
    // Flammable gas in Z-01 climbs to ~75% of its alarm — individually NORMAL, fatal with hot work
    const gas = sensors.find(s => s.zone === 'Z-01' && s.type === 'CH4');
    if (gas) t[gas.id] = 7.6;
    sensors.filter(s => s.zone === 'Z-02' && s.type === 'CH4').forEach(s => { t[s.id] = 3.2; });
  }
  if (scenario === 'EMERGENCY') {
    sensors.filter(s => s.type === 'CH4' && ['Z-01', 'Z-02'].includes(s.zone)).forEach(s => { t[s.id] = 24; });
    const o2 = sensors.find(s => s.type === 'O2' && s.zone === 'Z-11');
    if (o2) t[o2.id] = 17.2;
    const temp = sensors.find(s => s.type === 'TEMP' && ['Z-01', 'Z-02', 'Z-03'].includes(s.zone));
    if (temp) t[temp.id] = SENSOR_TYPES.TEMP.warningThreshold + 8;
  }
  return t;
}

class SensorSimulator extends EventEmitter {
  /**
   * @param layout  site layout (sensors with id/zone/type/label/x/y)
   * @param sim     simulation profile { sensorBaselines, targets (active situation) }
   */
  constructor(layout = defaultLayout, sim = null) {
    super();
    this.sensors = {};
    this.scenario = 'NORMAL';
    this.scenarioStep = 0;
    this.readings = [];
    this.situationTargets = sim?.targets || {};
    layout.sensors.forEach(s => {
      const cfg = SENSOR_TYPES[s.type];
      const baseline = sim?.sensorBaselines?.[s.id] ?? (cfg.base[0] + cfg.base[1]) / 2;
      // A site's active situation is already established when the plant is opened
      const sitTarget = this.situationTargets[s.id];
      const start = sitTarget !== undefined ? baseline + 0.85 * (sitTarget - baseline) : baseline;
      this.sensors[s.id] = { ...s, ...cfg, baseline, value: start + (Math.random() - 0.5) * cfg.noise, status: 'NORMAL', history: [] };
    });
    this.targets = { ...this.situationTargets };
    // Seed ~3 minutes of history so trends, forecasts and the active situation show up immediately
    const now = Date.now();
    for (let i = 90; i > 0; i--) this._step(now - i * 2000);
    this.readings = this._snapshot();
  }

  _gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  _status(s, v) {
    if (s.invertAlarm) return v < s.criticalThreshold ? 'CRITICAL' : v < s.warningThreshold ? 'WARNING' : 'NORMAL';
    return v >= s.criticalThreshold ? 'CRITICAL' : v >= s.warningThreshold ? 'WARNING' : 'NORMAL';
  }

  _step(t = Date.now()) {
    Object.values(this.sensors).forEach(s => {
      const target = this.targets[s.id];
      const situationOnly = s.id in this.situationTargets && this.targets[s.id] === this.situationTargets[s.id];
      const k = target === undefined ? REVERSION : situationOnly ? SITUATION_RATE : (SCENARIO_RATE[this.scenario] || REVERSION);
      const goal = target !== undefined ? target : s.baseline;
      let v = s.value + k * (goal - s.value) + s.noise * this._gauss();
      v = Math.max(s.min, Math.min(s.max, v));
      s.value = v;
      s.status = this._status(s, v);
      s.history.push({ t, v: +v.toFixed(2) });
      if (s.history.length > 90) s.history.shift();
    });
  }

  _snapshot() {
    return Object.values(this.sensors).map(s => ({
      id: s.id, zone: s.zone, type: s.type, label: s.label, x: s.x, y: s.y,
      value: +s.value.toFixed(2), unit: s.unit, status: s.status, online: true, source: 'simulated',
      baseline: s.baseline,
      warningThreshold: s.warningThreshold, criticalThreshold: s.criticalThreshold,
      history: s.history.slice(-30), lastUpdated: Date.now(),
    }));
  }

  /** Latest readings (no side effects). */
  getAllReadings() { return this.readings; }

  setScenario(scenario) {
    if (!['NORMAL', 'KILL_CHAIN', 'EMERGENCY'].includes(scenario)) throw new Error(`Unknown scenario ${scenario}`);
    this.scenario = scenario;
    this.scenarioStep = 0;
    this.targets = { ...this.situationTargets, ...scenarioTargets(scenario, Object.values(this.sensors)) };
  }

  tick() {
    this.scenarioStep++;
    this._step();
    this.readings = this._snapshot();
    this.emit('readings', this.readings);
    return this.readings;
  }

  start(intervalMs = 2000) { this._interval = setInterval(() => this.tick(), intervalMs); }
  stop() { if (this._interval) clearInterval(this._interval); }
}

module.exports = SensorSimulator;
module.exports.scenarioTargets = scenarioTargets;
