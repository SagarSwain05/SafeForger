// IoT Sensor Simulator — Realistic physics-based simulation with anomaly injection
const { EventEmitter } = require('events');
const plantLayout = require('../data/plant-layout.json');

class SensorSimulator extends EventEmitter {
  constructor() {
    super();
    this.sensors = {};
    this.scenario = 'NORMAL'; // NORMAL | COMPOUND_RISK | EMERGENCY
    this.scenarioStep = 0;
    this._initializeSensors();
  }

  _initializeSensors() {
    const sensorConfigs = {
      'CH4': { baseline: 2, unit: '% LEL', min: 0, max: 100, warningThreshold: 10, criticalThreshold: 20 },
      'H2S': { baseline: 1.5, unit: 'ppm', min: 0, max: 100, warningThreshold: 5, criticalThreshold: 10 },
      'CO':  { baseline: 5, unit: 'ppm', min: 0, max: 200, warningThreshold: 25, criticalThreshold: 50 },
      'O2':  { baseline: 20.9, unit: '%', min: 0, max: 25, warningThreshold: 19.5, criticalThreshold: 16, invertAlarm: true },
      'TEMP': { baseline: 45, unit: '°C', min: 20, max: 120, warningThreshold: 70, criticalThreshold: 90 },
      'PRESSURE': { baseline: 8.5, unit: 'bar', min: 0, max: 30, warningThreshold: 15, criticalThreshold: 20 },
    };

    plantLayout.sensors.forEach(sensor => {
      const config = sensorConfigs[sensor.type];
      this.sensors[sensor.id] = {
        ...sensor,
        ...config,
        value: config.baseline + (Math.random() - 0.5) * 0.5,
        trend: 0,
        status: 'NORMAL',
        lastUpdated: Date.now(),
        history: []
      };
    });
  }

  _gaussianNoise(mean = 0, std = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  _updateSensorValue(sensor) {
    const noise = this._gaussianNoise(0, 0.3);
    const drift = sensor.trend * 0.8;
    
    let newValue = sensor.value + drift + noise;
    
    // Scenario-based overrides
    if (this.scenario === 'KILL_CHAIN') {
      if (sensor.type === 'CH4' && sensor.zone === 'Z-01') {
        // Slowly rising CH4 — below single threshold but compound risk
        const targetValue = 12 + this.scenarioStep * 0.5;
        newValue = sensor.value + (targetValue - sensor.value) * 0.1 + noise * 0.2;
      }
      if (sensor.type === 'H2S' && sensor.zone === 'Z-07') {
        const targetValue = 3 + this.scenarioStep * 0.3;
        newValue = sensor.value + (targetValue - sensor.value) * 0.1 + noise * 0.1;
      }
    } else if (this.scenario === 'EMERGENCY') {
      if (sensor.type === 'CH4') {
        newValue = Math.min(sensor.value * 1.05, sensor.criticalThreshold * 1.2);
      }
      if (sensor.type === 'O2' && sensor.zone === 'Z-11') {
        newValue = Math.max(sensor.value * 0.98, 14);
      }
    }
    
    // Clamp to physical limits
    newValue = Math.max(sensor.min, Math.min(sensor.max, newValue));
    
    // Determine status
    let status = 'NORMAL';
    if (sensor.invertAlarm) {
      if (newValue < sensor.criticalThreshold) status = 'CRITICAL';
      else if (newValue < sensor.warningThreshold) status = 'WARNING';
    } else {
      if (newValue >= sensor.criticalThreshold) status = 'CRITICAL';
      else if (newValue >= sensor.warningThreshold) status = 'WARNING';
    }
    
    sensor.value = newValue;
    sensor.status = status;
    sensor.lastUpdated = Date.now();
    sensor.trend = (sensor.trend * 0.9) + (noise * 0.1);
    
    // Keep short history
    sensor.history.push({ t: Date.now(), v: parseFloat(newValue.toFixed(2)) });
    if (sensor.history.length > 60) sensor.history.shift();
    
    return {
      id: sensor.id,
      zone: sensor.zone,
      type: sensor.type,
      value: parseFloat(newValue.toFixed(2)),
      unit: sensor.unit,
      status,
      warningThreshold: sensor.warningThreshold,
      criticalThreshold: sensor.criticalThreshold,
      history: sensor.history.slice(-20),
      lastUpdated: sensor.lastUpdated
    };
  }

  getAllReadings() {
    return Object.values(this.sensors).map(s => this._updateSensorValue(s));
  }

  setScenario(scenario) {
    this.scenario = scenario;
    this.scenarioStep = 0;
    console.log(`[SensorSimulator] Scenario set to: ${scenario}`);
  }

  tick() {
    this.scenarioStep++;
    const readings = this.getAllReadings();
    this.emit('readings', readings);
    return readings;
  }

  start(intervalMs = 2000) {
    this._interval = setInterval(() => this.tick(), intervalMs);
    console.log('[SensorSimulator] Started at', intervalMs, 'ms interval');
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
  }
}

module.exports = SensorSimulator;
