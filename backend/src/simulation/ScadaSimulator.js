// SCADA simulator (simulated / demo sites only) — the site's own sector equipment list with
// mean-reverting values, occasional degradation and recovery, exposed as Modbus-style holding
// registers. Live sites receive equipment states from their SCADA gateway instead.
const { EventEmitter } = require('events');
const { rng } = require('../sites/profile');

const FAULT_STATES = { RUNNING: 'DEGRADED', NORMAL: 'DEGRADED', OPEN: 'STUCK', ENERGISED: 'DEGRADED', IDLE: 'IDLE', STANDBY: 'STANDBY' };

class ScadaSimulator extends EventEmitter {
  constructor(equipment = [], seed = 'scada') {
    super();
    const r = rng(seed);
    this.scenario = 'NORMAL';
    this.equipment = equipment.map((e, i) => ({
      ...e, address: 40001 + i, value: e.baseline, state: e.normalState,
      uptimeHours: Math.floor(300 + r() * 4000),
      lastMaintenance: new Date(Date.now() - r() * 45 * 86400000).toISOString(),
      faultProbability: 0.0008 + r() * 0.0025,
    }));
  }

  _gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  tick() {
    const stress = this.scenario === 'EMERGENCY' ? 6 : this.scenario === 'KILL_CHAIN' ? 2 : 1;
    for (const e of this.equipment) {
      if (e.state === 'IDLE' || e.state === 'STANDBY') { e.value = 0; continue; }
      const degraded = e.state !== e.normalState;
      const goal = degraded ? e.baseline * 0.82 : e.baseline;
      e.value = Math.max(0, e.value + 0.2 * (goal - e.value) + Math.abs(e.baseline) * 0.006 * this._gauss());
      if (!degraded && Math.random() < e.faultProbability * stress) e.state = FAULT_STATES[e.normalState] || 'DEGRADED';
      else if (degraded && Math.random() < 0.015) e.state = e.normalState;
    }
    return this.getState();
  }

  getState() {
    const equipment = this.equipment.map(e => ({
      id: e.id, label: e.label, zone: e.zone, state: e.state, normalState: e.normalState,
      value: +e.value.toFixed(e.baseline >= 100 ? 0 : 1), unit: e.unit, uptimeHours: e.uptimeHours,
      lastMaintenance: e.lastMaintenance, modbus_register: e.address, isNormal: e.state === e.normalState,
    }));
    return {
      connected: true, source: 'simulated',
      equipment,
      registers: equipment.map(e => ({ address: e.modbus_register, name: e.label, value: e.value, unit: e.unit, zone: e.zone, type: 'EQUIPMENT', status: e.isNormal ? 'NORMAL' : 'WARNING' })),
      scenario: this.scenario, timestamp: new Date().toISOString(),
    };
  }

  setScenario(s) { this.scenario = s; }
  start(ms = 3000) { this._interval = setInterval(() => this.emit('scada:update', this.tick()), ms); }
  stop() { if (this._interval) clearInterval(this._interval); }
}

module.exports = ScadaSimulator;
