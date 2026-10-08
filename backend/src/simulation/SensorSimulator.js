// IoT Sensor Simulator — mean-reverting (Ornstein–Uhlenbeck) noise around realistic baselines,
// with scripted scenario drifts for the demo. Swap for real Modbus/OPC-UA readings in production:
// everything downstream only consumes the reading objects emitted here.
const { EventEmitter } = require('events');
const defaultLayout = require('../data/plant-layout.json');

const SENSOR_TYPES = {
  CH4:      { baseline: 2.0,  noise: 0.12, unit: '% LEL', min: 0, max: 100, warningThreshold: 10, criticalThreshold: 20 },
  H2S:      { baseline: 1.5,  noise: 0.06, unit: 'ppm',   min: 0, max: 100, warningThreshold: 5,  criticalThreshold: 10 },
  CO:       { baseline: 5.0,  noise: 0.35, unit: 'ppm',   min: 0, max: 200, warningThreshold: 25, criticalThreshold: 50 },
  O2:       { baseline: 20.9, noise: 0.03, unit: '%',     min: 0, max: 25,  warningThreshold: 19.5, criticalThreshold: 16, invertAlarm: true },
  TEMP:     { baseline: 45,   noise: 0.35, unit: '°C',    min: 20, max: 120, warningThreshold: 70, criticalThreshold: 90 },
  PRESSURE: { baseline: 8.5,  noise: 0.07, unit: 'bar',   min: 0, max: 30,  warningThreshold: 15, criticalThreshold: 20 },
};

const REVERSION = 0.15; // pull toward the target each tick

// Scenario targets: sensor-id → target value (approached smoothly)
const SCENARIOS = {
  NORMAL: {},
  // Kill chain: CH4 at the CDU climbs to ~75% of its warning level — every individual
  // sensor stays NORMAL, but combined with hot work it is a fatal combination.
  KILL_CHAIN: { 'S-GAS-01': 7.6, 'S-GAS-02': 3.2 },
  // Full emergency: gas release at the CDU + O2 depletion in the confined space
  EMERGENCY: { 'S-GAS-01': 24, 'S-GAS-02': 14, 'S-GAS-06': 17.2, 'S-TEMP-01': 78 },
};
const SCENARIO_RATE = { KILL_CHAIN: 0.06, EMERGENCY: 0.12 };

class SensorSimulator extends EventEmitter {
  constructor(layout = defaultLayout) {
    super();
    this.sensors = {};
    this.scenario = 'NORMAL';
    this.scenarioStep = 0;
    this.readings = [];
    layout.sensors.forEach(s => {
      const cfg = SENSOR_TYPES[s.type];
      this.sensors[s.id] = { ...s, ...cfg, value: cfg.baseline + (Math.random() - 0.5) * cfg.noise, status: 'NORMAL', history: [] };
    });
    // Seed a minute of history so trends and forecasts work immediately after start-up
    const now = Date.now();
    for (let i = 30; i > 0; i--) this._step(now - i * 2000);
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
    const targets = SCENARIOS[this.scenario] || {};
    Object.values(this.sensors).forEach(s => {
      const target = targets[s.id];
      const k = target !== undefined ? (SCENARIO_RATE[this.scenario] || REVERSION) : REVERSION;
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
      id: s.id, zone: s.zone, type: s.type, x: s.x, y: s.y,
      value: +s.value.toFixed(2), unit: s.unit, status: s.status,
      baseline: s.baseline,
      warningThreshold: s.warningThreshold, criticalThreshold: s.criticalThreshold,
      history: s.history.slice(-30), lastUpdated: Date.now(),
    }));
  }

  /** Latest readings (no side effects). */
  getAllReadings() { return this.readings; }

  setScenario(scenario) {
    if (!SCENARIOS[scenario]) throw new Error(`Unknown scenario ${scenario}`);
    this.scenario = scenario;
    this.scenarioStep = 0;
    console.log(`[SensorSimulator] Scenario → ${scenario}`);
  }

  tick() {
    this.scenarioStep++;
    this._step();
    this.readings = this._snapshot();
    this.emit('readings', this.readings);
    return this.readings;
  }

  start(intervalMs = 2000) {
    this._interval = setInterval(() => this.tick(), intervalMs);
  }

  stop() { if (this._interval) clearInterval(this._interval); }
}

module.exports = SensorSimulator;
module.exports.SCENARIOS = SCENARIOS;
