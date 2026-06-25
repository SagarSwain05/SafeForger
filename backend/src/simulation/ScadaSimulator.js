// Enhanced SCADA Simulator with realistic public-dataset baselines + Modbus register mapping
// Sources: WUSTL-IIoT, Case Western Reserve, UCI Gas Sensor Array
const { EventEmitter } = require('events');
const baselines = require('../data/scada-baselines.json');

class ScadaSimulator extends EventEmitter {
  constructor(mqttBroker) {
    super();
    this.broker = mqttBroker; // Optional: publish to MQTT
    this.equipment = {};
    this.registers = {};         // Modbus register map (address → value)
    this.scenario = 'NORMAL';
    this._initEquipment();
    this._initRegisters();
  }

  _initEquipment() {
    const eq = baselines.scada_equipment;
    Object.entries(eq).forEach(([key, cfg]) => {
      this.equipment[key] = {
        id: key,
        label: cfg.label,
        zone: cfg.zone,
        states: cfg.states,
        currentState: cfg.normal_state,
        normalState: cfg.normal_state,
        modbus_register: cfg.modbus_register,
        modbus_coil: cfg.modbus_coil,
        opc_ua_tag: cfg.opc_ua_tag,
        value: this._getBaselineValue(cfg),
        unit: this._getUnit(key),
        uptime_hours: Math.floor(Math.random() * 2000 + 500),
        last_maintenance: new Date(Date.now() - Math.random() * 30 * 24 * 3600000).toISOString(),
        fault_probability: 0.001,
      };
    });
  }

  _getBaselineValue(cfg) {
    if (cfg.rpm_baseline) return cfg.rpm_baseline;
    if (cfg.pressure_ratio_baseline) return cfg.pressure_ratio_baseline;
    if (cfg.effectiveness_baseline_pct) return cfg.effectiveness_baseline_pct;
    if (cfg.position_pct_baseline) return cfg.position_pct_baseline;
    if (cfg.pressure_baseline_bar) return cfg.pressure_baseline_bar;
    if (cfg.fan_rpm_baseline) return cfg.fan_rpm_baseline;
    if (cfg.level_pct_baseline) return cfg.level_pct_baseline;
    return 0;
  }

  _getUnit(key) {
    const units = {
      pump_P101: 'RPM', compressor_K201: 'A', heat_exchanger_E101: '%',
      valve_FCV301: '%', boiler_B101: 'bar', cooling_tower_CT01: 'RPM',
      flare_KO: '%', storage_V401: '%',
    };
    return units[key] ?? '';
  }

  _initRegisters() {
    // Modbus Holding Registers (4xxxx) — equipment states
    // Modbus Input Registers (3xxxx) — sensor readings
    // Initial values from baselines
    const gas = baselines.gas_sensor_profiles;
    const temp = baselines.temperature_profiles;
    const press = baselines.pressure_profiles;
    const vib = baselines.vibration_profiles;

    this.registers = {
      // Input Registers — sensor readings
      30001: { name: 'CH4_LEL_%', value: gas.CH4.baseline_ppm_equiv, unit: '% LEL', zone: 'Z-01', type: 'GAS' },
      30002: { name: 'H2S_ppm', value: gas.H2S.baseline_ppm, unit: 'ppm', zone: 'Z-07', type: 'GAS' },
      30003: { name: 'CO_ppm', value: gas.CO.baseline_ppm, unit: 'ppm', zone: 'Z-09', type: 'GAS' },
      30004: { name: 'O2_%', value: gas.O2.baseline_pct, unit: '%', zone: 'Z-11', type: 'GAS' },
      30005: { name: 'LEL_Composite_%', value: gas.LEL_composite.baseline_pct, unit: '% LEL', zone: 'Z-03', type: 'GAS' },
      30020: { name: 'Process_Temp_C', value: temp.process_temp.baseline_celsius, unit: '°C', zone: 'Z-01', type: 'TEMP' },
      30021: { name: 'Bearing_Temp_C', value: temp.bearing_temp.baseline_celsius, unit: '°C', zone: 'Z-07', type: 'TEMP' },
      30040: { name: 'Process_Pressure_bar', value: press.process_pressure.baseline_bar, unit: 'bar', zone: 'Z-02', type: 'PRESSURE' },
      30041: { name: 'Pump_Discharge_bar', value: press.pump_discharge.baseline_bar, unit: 'bar', zone: 'Z-07', type: 'PRESSURE' },
      30060: { name: 'Pump_Vibration_mm_s', value: vib.pump_vibration.baseline_mm_s, unit: 'mm/s', zone: 'Z-07', type: 'VIBRATION' },
      // Holding Registers — equipment control
      40001: { name: 'Pump_P101_Status', value: 2, unit: 'enum', zone: 'Z-01', type: 'EQUIPMENT' },
      40002: { name: 'Compressor_K201_Status', value: 2, unit: 'enum', zone: 'Z-09', type: 'EQUIPMENT' },
      40003: { name: 'HX_E101_Effectiveness', value: 87.4, unit: '%', zone: 'Z-08', type: 'EQUIPMENT' },
      40004: { name: 'FCV301_Position', value: 67.3, unit: '%', zone: 'Z-01', type: 'EQUIPMENT' },
      40005: { name: 'Boiler_B101_Pressure', value: 12.4, unit: 'bar', zone: 'Z-04', type: 'EQUIPMENT' },
      40006: { name: 'CoolingTower_FanRPM', value: 892, unit: 'RPM', zone: 'Z-14', type: 'EQUIPMENT' },
      40007: { name: 'Flare_KO_Level', value: 12.3, unit: '%', zone: 'Z-06', type: 'EQUIPMENT' },
      40008: { name: 'Storage_V401_Level', value: 73.2, unit: '%', zone: 'Z-03', type: 'EQUIPMENT' },
    };
  }

  _noiseGaussian(std = 0.1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  tick() {
    // Update registers with realistic drift + noise
    const gas = baselines.gas_sensor_profiles;
    const temp = baselines.temperature_profiles;
    const press = baselines.pressure_profiles;
    const vib = baselines.vibration_profiles;

    // Gas sensors
    this.registers[30001].value = Math.max(0, this.registers[30001].value + this._noiseGaussian(0.25) + (this.scenario === 'KILL_CHAIN' ? 0.6 : gas.CH4.drift_rate_per_hour / 1800));
    this.registers[30002].value = Math.max(0, this.registers[30002].value + this._noiseGaussian(0.15));
    this.registers[30003].value = Math.max(0, this.registers[30003].value + this._noiseGaussian(0.5));
    this.registers[30004].value = Math.min(25, Math.max(0, this.registers[30004].value + this._noiseGaussian(0.08) + (this.scenario === 'EMERGENCY' ? -0.08 : 0)));
    this.registers[30005].value = Math.max(0, this.registers[30005].value + this._noiseGaussian(0.2));

    // Temperature — realistic drift from process load
    this.registers[30020].value = Math.max(20, Math.min(120, this.registers[30020].value + this._noiseGaussian(0.8)));
    this.registers[30021].value = Math.max(25, Math.min(100, this.registers[30021].value + this._noiseGaussian(0.5)));

    // Pressure
    this.registers[30040].value = Math.max(0, Math.min(30, this.registers[30040].value + this._noiseGaussian(0.3)));
    this.registers[30041].value = Math.max(0, Math.min(15, this.registers[30041].value + this._noiseGaussian(0.12)));

    // Vibration — Case Western profile (slowly drifting up in degraded scenarios)
    const vibDrift = this.scenario === 'EMERGENCY' ? 0.05 : this._noiseGaussian(0.15);
    this.registers[30060].value = Math.max(0.5, Math.min(15, this.registers[30060].value + vibDrift));

    // Equipment values drift
    this.registers[40003].value = Math.max(60, Math.min(100, this.registers[40003].value + this._noiseGaussian(0.3)));
    this.registers[40004].value = Math.max(0, Math.min(100, this.registers[40004].value + this._noiseGaussian(0.5)));
    this.registers[40005].value = Math.max(8, Math.min(20, this.registers[40005].value + this._noiseGaussian(0.1)));
    this.registers[40007].value = Math.max(0, Math.min(100, this.registers[40007].value + this._noiseGaussian(0.3)));

    // Random equipment state transitions
    Object.values(this.equipment).forEach(eq => {
      if (Math.random() < eq.fault_probability && this.scenario !== 'NORMAL') {
        const faultIdx = eq.states.indexOf('DEGRADED');
        if (faultIdx !== -1) eq.currentState = 'DEGRADED';
      } else if (eq.currentState !== eq.normalState && Math.random() < 0.02) {
        eq.currentState = eq.normalState; // self-recover
      }
    });

    // Publish to MQTT
    if (this.broker) {
      // Publish sensor readings per zone
      const zoneData = {};
      Object.values(this.registers).forEach(reg => {
        if (!zoneData[reg.zone]) zoneData[reg.zone] = {};
        zoneData[reg.zone][reg.name] = { value: parseFloat(reg.value.toFixed(3)), unit: reg.unit, type: reg.type, address: reg.address };
      });
      Object.entries(zoneData).forEach(([zone, data]) => {
        this.broker.publish(`plant/${zone}/telemetry`, data);
      });
    }

    return this.getState();
  }

  getState() {
    return {
      registers: Object.entries(this.registers).map(([addr, reg]) => ({
        address: parseInt(addr),
        name: reg.name,
        value: parseFloat(reg.value.toFixed(3)),
        unit: reg.unit,
        zone: reg.zone,
        type: reg.type,
        status: this._getRegisterStatus(parseInt(addr), reg.value),
      })),
      equipment: Object.values(this.equipment).map(eq => ({
        id: eq.id,
        label: eq.label,
        zone: eq.zone,
        state: eq.currentState,
        normalState: eq.normalState,
        value: parseFloat((eq.value + this._noiseGaussian(0.5)).toFixed(1)),
        unit: eq.unit,
        uptimeHours: eq.uptime_hours,
        lastMaintenance: eq.last_maintenance,
        modbus_register: eq.modbus_register,
        opc_ua_tag: eq.opc_ua_tag,
        isNormal: eq.currentState === eq.normalState,
      })),
      scenario: this.scenario,
      timestamp: new Date().toISOString(),
    };
  }

  _getRegisterStatus(address, value) {
    const alarm = baselines.gas_sensor_profiles;
    if (address === 30001) {
      if (value >= alarm.CH4.alarm_levels.critical_lel_pct) return 'CRITICAL';
      if (value >= alarm.CH4.alarm_levels.warning_lel_pct) return 'WARNING';
    }
    if (address === 30002) {
      if (value >= alarm.H2S.alarm_levels.critical_ppm) return 'CRITICAL';
      if (value >= alarm.H2S.alarm_levels.warning_ppm) return 'WARNING';
    }
    if (address === 30003) {
      if (value >= alarm.CO.alarm_levels.critical_ppm) return 'CRITICAL';
      if (value >= alarm.CO.alarm_levels.warning_ppm) return 'WARNING';
    }
    if (address === 30004) { // O2 — inverted
      if (value < alarm.O2.alarm_levels.critical_pct) return 'CRITICAL';
      if (value < alarm.O2.alarm_levels.warning_pct) return 'WARNING';
    }
    if (address === 30060) {
      const vib = baselines.vibration_profiles.pump_vibration;
      if (value >= vib.critical_mm_s) return 'CRITICAL';
      if (value >= vib.warning_mm_s) return 'WARNING';
    }
    return 'NORMAL';
  }

  setScenario(scenario) {
    this.scenario = scenario;
  }

  start(intervalMs = 3000) {
    this._interval = setInterval(() => {
      const state = this.tick();
      this.emit('scada:update', state);
    }, intervalMs);
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
  }
}

module.exports = ScadaSimulator;
