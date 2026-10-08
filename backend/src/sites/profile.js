// Site profiles — what makes every plant distinct.
//
// Simulated sites (sandbox plants + real-facility twins, demo account only) get a deterministic
// profile seeded from the site id and sector: their own map geometry, sector-specific sensor plan
// and baselines, SCADA equipment, workforce, permits and an "active situation" (a developing
// hazard that drives that site's own alerts and point of action). The same site always produces
// the same profile, and no two sites look alike.
//
// Live sites (real accounts) use the same layout/sensor plan for configuration only — every
// value then comes from real inputs.
const base = require('../data/plant-layout.json');

// ── Deterministic randomness ─────────────────────────────────────────────────
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seedStr) {
  let a = hashString(seedStr);
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, lo, hi) => lo + r() * (hi - lo);

// ── Sensor types ─────────────────────────────────────────────────────────────
const SENSOR_TYPES = {
  CH4:      { unit: '% LEL', min: 0, max: 100, warningThreshold: 10, criticalThreshold: 20, noise: 0.12, base: [1.2, 2.8] },
  H2S:      { unit: 'ppm',   min: 0, max: 100, warningThreshold: 5,  criticalThreshold: 10, noise: 0.06, base: [0.6, 1.8] },
  CO:       { unit: 'ppm',   min: 0, max: 200, warningThreshold: 25, criticalThreshold: 50, noise: 0.35, base: [3, 9] },
  O2:       { unit: '%',     min: 0, max: 25,  warningThreshold: 19.5, criticalThreshold: 16, invertAlarm: true, noise: 0.03, base: [20.7, 20.95] },
  TEMP:     { unit: '°C',    min: 0, max: 200, warningThreshold: 70, criticalThreshold: 90, noise: 0.35, base: [32, 55] },
  PRESSURE: { unit: 'bar',   min: 0, max: 40,  warningThreshold: 15, criticalThreshold: 20, noise: 0.07, base: [5, 10] },
};

// Sector sensor plans: [zone, type, label]. The first entry is always the Z-01 flammable-gas
// sensor (S-GAS-01) used by the kill-chain demo.
const SENSOR_PLANS = {
  refinery: [['Z-01', 'CH4', 'Hydrocarbon LEL'], ['Z-02', 'CH4', 'Hydrocarbon LEL'], ['Z-03', 'H2S', 'Tank vent H₂S'], ['Z-07', 'H2S', 'Pump seal H₂S'], ['Z-09', 'CO', 'Compressor CO'], ['Z-11', 'O2', 'Vessel O₂'], ['Z-12', 'O2', 'Vessel O₂'], ['Z-01', 'TEMP', 'Column overhead'], ['Z-08', 'TEMP', 'Exchanger outlet'], ['Z-02', 'PRESSURE', 'Reactor pressure'], ['Z-09', 'PRESSURE', 'Discharge pressure']],
  steel: [['Z-01', 'CH4', 'Coke-oven gas LEL'], ['Z-02', 'CO', 'By-product CO'], ['Z-03', 'CO', 'Cast-house CO'], ['Z-03', 'TEMP', 'Tap-hole temperature'], ['Z-07', 'CO', 'Converter CO'], ['Z-02', 'H2S', 'Gas cleaning H₂S'], ['Z-11', 'O2', 'Gas-holder O₂'], ['Z-12', 'O2', 'Ladle pit O₂'], ['Z-08', 'TEMP', 'Caster mould'], ['Z-09', 'PRESSURE', 'Hydraulic pressure'], ['Z-13', 'TEMP', 'Slag yard']],
  power: [['Z-01', 'CH4', 'Fuel-oil vapour LEL'], ['Z-02', 'TEMP', 'Boiler furnace exit'], ['Z-02', 'PRESSURE', 'Drum pressure'], ['Z-03', 'CO', 'Coal conveyor CO'], ['Z-06', 'CO', 'Ash handling CO'], ['Z-07', 'TEMP', 'Turbine bearing'], ['Z-08', 'PRESSURE', 'Feed-water pressure'], ['Z-09', 'CH4', 'Hydrogen LEL'], ['Z-11', 'O2', 'Drum O₂'], ['Z-12', 'O2', 'Bunker O₂'], ['Z-13', 'TEMP', 'Tippler motor']],
  chemical: [['Z-01', 'CH4', 'Solvent LEL'], ['Z-02', 'CH4', 'Recovery LEL'], ['Z-03', 'H2S', 'Storage H₂S'], ['Z-06', 'H2S', 'Effluent H₂S'], ['Z-07', 'CO', 'Pump area CO'], ['Z-11', 'O2', 'Reactor O₂'], ['Z-12', 'O2', 'Tank O₂'], ['Z-01', 'TEMP', 'Reactor jacket'], ['Z-08', 'TEMP', 'Column reboiler'], ['Z-01', 'PRESSURE', 'Reactor pressure'], ['Z-09', 'PRESSURE', 'Compressor discharge']],
  cement: [['Z-01', 'CH4', 'Coal-mill gas LEL'], ['Z-01', 'CO', 'Coal-mill CO'], ['Z-03', 'CH4', 'Fuel store LEL'], ['Z-02', 'TEMP', 'Pre-heater cyclone'], ['Z-06', 'TEMP', 'Kiln shell'], ['Z-07', 'TEMP', 'Cooler grate'], ['Z-09', 'CO', 'Mill CO'], ['Z-11', 'O2', 'Cyclone O₂'], ['Z-12', 'O2', 'Silo O₂'], ['Z-02', 'PRESSURE', 'ID-fan draught'], ['Z-09', 'PRESSURE', 'Mill hydraulics']],
  automotive: [['Z-01', 'CH4', 'Paint solvent LEL'], ['Z-02', 'CH4', 'Mixing room LEL'], ['Z-03', 'CH4', 'Solvent store LEL'], ['Z-06', 'CO', 'Weld fume CO'], ['Z-07', 'TEMP', 'Engine test cell'], ['Z-09', 'TEMP', 'Battery pack line'], ['Z-11', 'O2', 'Sludge pit O₂'], ['Z-12', 'O2', 'ED tank O₂'], ['Z-01', 'TEMP', 'Paint oven'], ['Z-04', 'PRESSURE', 'Press hydraulics'], ['Z-13', 'CO', 'Dock forklift CO']],
  mining: [['Z-01', 'CH4', 'Face methane'], ['Z-02', 'CH4', 'Return airway methane'], ['Z-02', 'CO', 'Roadway CO'], ['Z-03', 'TEMP', 'Magazine temperature'], ['Z-06', 'CO', 'Coal handling CO'], ['Z-07', 'CO', 'Bench exhaust CO'], ['Z-09', 'PRESSURE', 'Fan pressure'], ['Z-11', 'O2', 'Sump O₂'], ['Z-12', 'O2', 'Old workings O₂'], ['Z-08', 'TEMP', 'Conveyor drive'], ['Z-11', 'H2S', 'Sump H₂S']],
  pharma: [['Z-01', 'CH4', 'Solvent LEL'], ['Z-02', 'CH4', 'Recovery LEL'], ['Z-03', 'CH4', 'Tank farm LEL'], ['Z-07', 'CH4', 'Centrifuge LEL'], ['Z-09', 'PRESSURE', 'Hydrogenator pressure'], ['Z-09', 'TEMP', 'Hydrogenator temperature'], ['Z-11', 'O2', 'Reactor O₂'], ['Z-12', 'H2S', 'Effluent H₂S'], ['Z-12', 'O2', 'Effluent pit O₂'], ['Z-06', 'TEMP', 'Dryer'], ['Z-14', 'PRESSURE', 'Boiler pressure']],
  logistics: [['Z-01', 'CH4', 'Bunker vapour LEL'], ['Z-02', 'CH4', 'Berth vapour LEL'], ['Z-03', 'H2S', 'Dangerous goods H₂S'], ['Z-06', 'CO', 'Conveyor CO'], ['Z-07', 'CO', 'Crane engine CO'], ['Z-08', 'CO', 'Warehouse forklift CO'], ['Z-09', 'TEMP', 'Reefer rack'], ['Z-11', 'O2', 'Ship hold O₂'], ['Z-12', 'O2', 'Tank container O₂'], ['Z-13', 'CO', 'Truck gate CO'], ['Z-01', 'PRESSURE', 'Bunker line pressure']],
  manufacturing: [['Z-01', 'CH4', 'Solvent vapour LEL'], ['Z-02', 'CH4', 'LPG yard LEL'], ['Z-06', 'CO', 'Welding fume CO'], ['Z-09', 'PRESSURE', 'Air receiver pressure'], ['Z-09', 'TEMP', 'Boiler flue'], ['Z-11', 'O2', 'ETP pit O₂'], ['Z-11', 'H2S', 'ETP pit H₂S'], ['Z-12', 'O2', 'Tank O₂'], ['Z-04', 'TEMP', 'Machine shop'], ['Z-13', 'CO', 'Dock forklift CO'], ['Z-01', 'TEMP', 'Curing oven']],
  construction: [['Z-01', 'CH4', 'Excavation gas LEL'], ['Z-01', 'CO', 'Excavation CO'], ['Z-03', 'CH4', 'Cylinder store LEL'], ['Z-06', 'CO', 'Batching plant CO'], ['Z-09', 'CH4', 'Tunnel methane'], ['Z-09', 'CO', 'Tunnel CO'], ['Z-11', 'O2', 'Manhole O₂'], ['Z-11', 'H2S', 'Sewer H₂S'], ['Z-12', 'O2', 'Tank O₂'], ['Z-10', 'TEMP', 'Fabrication shed'], ['Z-13', 'CO', 'Gate exhaust CO']],
};

// SCADA / plant equipment per sector: [label, zone, unit, baseline, normalState]
const EQUIPMENT = {
  refinery: [['Crude charge pump P-101', 'Z-01', 'RPM', 1480, 'RUNNING'], ['Recycle compressor K-201', 'Z-09', 'A', 182, 'RUNNING'], ['Heat exchanger E-101', 'Z-08', '% eff.', 87, 'NORMAL'], ['Flow valve FCV-301', 'Z-01', '% open', 67, 'OPEN'], ['Steam boiler B-101', 'Z-04', 'bar', 12.4, 'NORMAL'], ['Cooling tower fan CT-01', 'Z-14', 'RPM', 890, 'RUNNING'], ['Flare KO drum', 'Z-06', '% level', 12, 'NORMAL'], ['Storage tank T-401', 'Z-03', '% level', 73, 'NORMAL']],
  steel: [['Coke oven pusher', 'Z-01', 'ovens/h', 6.2, 'RUNNING'], ['Blast furnace hot-blast stove', 'Z-03', '°C', 1150, 'RUNNING'], ['BOF converter tilt drive', 'Z-07', 'A', 410, 'RUNNING'], ['Caster mould oscillator', 'Z-08', 'cpm', 150, 'RUNNING'], ['Hot strip mill F1 stand', 'Z-09', 'MW', 7.8, 'RUNNING'], ['Gas holder', 'Z-11', '% fill', 64, 'NORMAL'], ['Sinter strand', 'Z-06', 'm/min', 3.1, 'RUNNING'], ['Cooling water pump', 'Z-14', 'm³/h', 2400, 'RUNNING']],
  power: [['Boiler feed pump BFP-A', 'Z-02', 'RPM', 5400, 'RUNNING'], ['Steam turbine', 'Z-07', 'MW', 492, 'RUNNING'], ['Coal mill C', 'Z-03', 't/h', 58, 'RUNNING'], ['ID fan A', 'Z-02', 'A', 610, 'RUNNING'], ['Generator H₂ cooling', 'Z-09', 'bar', 4.1, 'NORMAL'], ['ESP field 3', 'Z-06', 'kV', 62, 'ENERGISED'], ['Cooling water pump', 'Z-14', 'm³/h', 18000, 'RUNNING'], ['Wagon tippler', 'Z-13', 'tips/h', 18, 'RUNNING']],
  chemical: [['Reactor R-201 agitator', 'Z-01', 'RPM', 120, 'RUNNING'], ['Solvent recovery column', 'Z-02', '°C', 78, 'NORMAL'], ['Transfer pump P-310', 'Z-07', 'm³/h', 42, 'RUNNING'], ['Process compressor', 'Z-09', 'A', 210, 'RUNNING'], ['Bulk tank T-12', 'Z-03', '% level', 58, 'NORMAL'], ['Scrubber', 'Z-06', 'pH', 8.1, 'NORMAL'], ['Chiller', 'Z-04', '°C', 7, 'RUNNING'], ['Loading arm LA-2', 'Z-13', 'm³/h', 0, 'IDLE']],
  cement: [['Rotary kiln drive', 'Z-06', 'rpm', 3.6, 'RUNNING'], ['Coal mill', 'Z-01', 't/h', 21, 'RUNNING'], ['Pre-heater ID fan', 'Z-02', 'RPM', 880, 'RUNNING'], ['Clinker cooler grate', 'Z-07', 'strokes/min', 14, 'RUNNING'], ['Cement mill', 'Z-09', 't/h', 185, 'RUNNING'], ['Raw mill', 'Z-08', 't/h', 310, 'RUNNING'], ['Packer', 'Z-13', 'bags/h', 2400, 'RUNNING'], ['AF feeding system', 'Z-03', 't/h', 4.5, 'RUNNING']],
  automotive: [['Paint booth air supply', 'Z-01', 'm³/h', 92000, 'RUNNING'], ['Paint oven', 'Z-01', '°C', 165, 'RUNNING'], ['Press line 2', 'Z-04', 'strokes/min', 12, 'RUNNING'], ['Body shop robots', 'Z-06', '% avail.', 97, 'RUNNING'], ['Engine assembly line', 'Z-07', 'JPH', 54, 'RUNNING'], ['Battery formation', 'Z-09', 'kWh', 310, 'RUNNING'], ['ED tank circulation', 'Z-12', 'm³/h', 140, 'RUNNING'], ['Compressed air', 'Z-14', 'bar', 7.2, 'NORMAL']],
  mining: [['Main ventilation fan', 'Z-09', 'm³/s', 210, 'RUNNING'], ['Continuous miner', 'Z-01', 'A', 340, 'RUNNING'], ['Trunk conveyor', 'Z-08', 't/h', 2200, 'RUNNING'], ['Dewatering pump', 'Z-11', 'm³/h', 180, 'RUNNING'], ['Shovel S-12', 'Z-07', 'cycles/h', 95, 'RUNNING'], ['Coal handling crusher', 'Z-06', 't/h', 1500, 'RUNNING'], ['Winder', 'Z-02', 'm/s', 8, 'RUNNING'], ['Rapid loading system', 'Z-13', 't/h', 4000, 'IDLE']],
  pharma: [['Reactor R-05 agitator', 'Z-01', 'RPM', 90, 'RUNNING'], ['Solvent recovery', 'Z-02', '°C', 64, 'NORMAL'], ['Centrifuge C-2', 'Z-07', 'RPM', 1200, 'RUNNING'], ['Hydrogenator H-1', 'Z-09', 'bar', 6, 'NORMAL'], ['Fluid-bed dryer', 'Z-06', '°C', 55, 'RUNNING'], ['Nitrogen generator', 'Z-04', '% purity', 99.5, 'NORMAL'], ['Boiler', 'Z-14', 'bar', 10.5, 'NORMAL'], ['Effluent pump', 'Z-12', 'm³/h', 12, 'RUNNING']],
  logistics: [['Quay crane QC-3', 'Z-07', 'moves/h', 28, 'RUNNING'], ['Bunker pump', 'Z-01', 'm³/h', 450, 'RUNNING'], ['Berth loading arm', 'Z-02', 'm³/h', 900, 'IDLE'], ['Bulk conveyor', 'Z-06', 't/h', 3000, 'RUNNING'], ['Reefer power', 'Z-09', 'kW', 820, 'NORMAL'], ['Warehouse sprinkler', 'Z-08', 'bar', 8, 'NORMAL'], ['Gate OCR system', 'Z-13', 'trucks/h', 64, 'RUNNING'], ['Fire water pump', 'Z-04', 'bar', 9, 'STANDBY']],
  manufacturing: [['Paint booth extraction', 'Z-01', 'm³/h', 42000, 'RUNNING'], ['Air compressor', 'Z-09', 'bar', 7.5, 'RUNNING'], ['Boiler', 'Z-09', 'bar', 10, 'NORMAL'], ['CNC cell', 'Z-04', '% util.', 82, 'RUNNING'], ['Assembly conveyor 1', 'Z-07', 'm/min', 6, 'RUNNING'], ['Assembly conveyor 2', 'Z-08', 'm/min', 6, 'RUNNING'], ['ETP blower', 'Z-11', 'm³/h', 900, 'RUNNING'], ['DG set', 'Z-14', 'kW', 0, 'STANDBY']],
  construction: [['Tower crane TC-1', 'Z-02', 't', 6.5, 'RUNNING'], ['Dewatering pump', 'Z-01', 'm³/h', 120, 'RUNNING'], ['Batching plant', 'Z-06', 'm³/h', 60, 'RUNNING'], ['Tunnel ventilation fan', 'Z-09', 'm³/s', 45, 'RUNNING'], ['Site generator', 'Z-04', 'kW', 320, 'RUNNING'], ['Hoist', 'Z-07', 'm/s', 1.2, 'RUNNING'], ['Concrete pump', 'Z-08', 'm³/h', 70, 'IDLE'], ['Welding sets', 'Z-10', 'kW', 45, 'RUNNING']],
};

// Developing hazards — one per simulated site. They produce warnings / HIGH compound risks
// (never an automatic emergency at baseline) so each site has its own point of action.
const SITUATIONS = [
  { id: 'co_buildup', type: 'CO', factor: 1.1, title: 'CO build-up', action: 'Ventilate and find the CO source before the next shift enters' },
  { id: 'h2s_pocket', type: 'H2S', factor: 1.08, title: 'H₂S pocket forming', action: 'Restrict entry, issue personal H₂S monitors and check drains / seals' },
  { id: 'hot_equipment', type: 'TEMP', factor: 1.08, title: 'Equipment running hot', action: 'Reduce load and inspect cooling / lubrication before it trips' },
  { id: 'pressure_creep', type: 'PRESSURE', factor: 1.04, title: 'Pressure creeping toward limit', action: 'Check relief valves and reduce throughput' },
  { id: 'gas_drift', type: 'CH4', factor: 0.68, title: 'Flammable gas drifting upward', action: 'Increase gas-test frequency and hold any new hot-work permits nearby', skipKillChainSensor: true },
  // Placed away from Z-11 (which carries the seeded entry permit) so it is a watch item, not an emergency
  { id: 'o2_low', type: 'O2', factor: 19.35, absolute: true, avoidZones: ['Z-11'], title: 'Oxygen trending low in a confined space', action: 'Do not issue entry permits; re-test and force-ventilate before anyone enters' },
];

const FIRST = ['Rajan', 'Priya', 'Suresh', 'Amit', 'Deepika', 'Venkat', 'Kavitha', 'Mohan', 'Lakshmi', 'Rajesh', 'Sundar', 'Anitha', 'Arjun', 'Meena', 'Farhan', 'Gurpreet', 'Sneha', 'Ravi', 'Pooja', 'Imran', 'Harish', 'Nandini', 'Joseph', 'Kiran', 'Anil', 'Divya', 'Sanjay', 'Fatima', 'Manoj', 'Bhavna', 'Tenzin', 'Ritu', 'Vikram', 'Asha', 'Prakash', 'Shalini'];
const LAST = ['Kumar', 'Nair', 'Reddy', 'Sharma', 'Patel', 'Rao', 'Menon', 'Singh', 'Das', 'Iyer', 'Pillai', 'Krishnan', 'Verma', 'Gupta', 'Khan', 'Bose', 'Joshi', 'Mishra', 'Naidu', 'Chatterjee', 'Hegde', 'Thomas', 'Kaur', 'Yadav', 'Banerjee', 'Shetty'];
const KEY_ROLES = ['Shift Supervisor', 'Safety Officer', 'Fire & Safety', 'Process Engineer', 'Instrument Tech', 'Maintenance Lead'];
const OTHER_ROLES = ['Operator', 'Operator', 'Operator', 'Maintenance Tech', 'Maintenance Tech', 'Electrician', 'Rigger', 'Fitter', 'Crane Operator', 'Contractor'];

// ── Builders ─────────────────────────────────────────────────────────────────

/** Jitter every zone inside its own grid cell so each site has its own map. */
function buildGeometry(r) {
  return base.zones.map(z => {
    // Stay inside the zone's own grid cell (≥ 13 units between neighbours) — never overlap
    const w = Math.round(z.w * between(r, 0.8, 1.0));
    const h = Math.round(z.h * between(r, 0.8, 1.0));
    const x = Math.round(z.x + between(r, -0.05, 0.06) * z.w);
    const y = Math.round(z.y + between(r, -0.05, 0.06) * z.h);
    return { id: z.id, x: Math.max(20, x), y: Math.max(20, y), w, h };
  });
}

function placeIn(zone, r, i) {
  return { x: Math.round(zone.x + zone.w * between(r, 0.18, 0.82)), y: Math.round(zone.y + zone.h * between(r, 0.25, 0.85) - (i % 2) * 6) };
}

/** Sensor plan for a sector, positioned inside the (possibly jittered) zones. */
function buildSensors(sector, zones, seed) {
  const r = rng(`${seed}:sensors`);
  const plan = SENSOR_PLANS[sector] || SENSOR_PLANS.refinery;
  const counters = {};
  return plan.map(([zoneId, type, label], i) => {
    const prefix = type === 'TEMP' ? 'TEMP' : type === 'PRESSURE' ? 'PRESS' : 'GAS';
    counters[prefix] = (counters[prefix] || 0) + 1;
    const zone = zones.find(z => z.id === zoneId) || zones[0];
    return { id: `S-${prefix}-${String(counters[prefix]).padStart(2, '0')}`, zone: zoneId, type, label, ...placeIn(zone, r, i) };
  });
}

function cameraPositions(zones, cameras) {
  const perZone = {};
  return cameras.map(c => {
    const z = zones.find(x => x.id === c.zone) || zones[0];
    const k = (perZone[z.id] = (perZone[z.id] || 0) + 1) - 1;
    return { ...c, x: Math.min(z.x + z.w - 8, z.x + 14 + k * 22), y: z.y + 12 };
  });
}

function buildRoster(r, siteId) {
  const n = 10 + Math.floor(r() * 13);
  const used = new Set();
  const roles = [...KEY_ROLES, ...Array.from({ length: n - KEY_ROLES.length }, () => pick(r, OTHER_ROLES))];
  return roles.map((role, i) => {
    let name;
    do { name = `${pick(r, FIRST)} ${pick(r, LAST)}`; } while (used.has(name));
    used.add(name);
    return { id: `W-${String(i + 1).padStart(3, '0')}`, name, role, shift: pick(r, ['A', 'B', 'C']), badge: `${siteId.slice(0, 3).toUpperCase()}-${1000 + i}` };
  });
}

/** Simulation profile: sensor baselines, the site's active situation, extra permits. */
function buildSimProfile(site, sensors, zones, roster) {
  const r = rng(`${site.id}:sim`);
  const sensorBaselines = Object.fromEntries(sensors.map(s => {
    const t = SENSOR_TYPES[s.type];
    return [s.id, +between(r, t.base[0], t.base[1]).toFixed(2)];
  }));
  const eligible = (sit, s) => s.type === sit.type && !(sit.skipKillChainSensor && s.id === 'S-GAS-01') && !(sit.avoidZones || []).includes(s.zone);
  const candidates = SITUATIONS.filter(sit => sensors.some(s => eligible(sit, s)));
  const sit = site.id === 'demo-refinery' ? null : pick(r, candidates);   // the kill-chain sandbox starts calm
  let situation = null;
  const targets = {};
  if (sit) {
    const options = sensors.filter(s => eligible(sit, s));
    const s = pick(r, options);
    const t = SENSOR_TYPES[s.type];
    const target = sit.absolute ? sit.factor : +(t.warningThreshold * sit.factor).toFixed(2);
    targets[s.id] = target;
    const zone = zones.find(z => z.id === s.zone);
    situation = { id: sit.id, title: `${sit.title} — ${zone?.name || s.zone}`, sensorId: s.id, sensorLabel: s.label, zone: s.zone, zoneName: zone?.name, target, unit: t.unit, action: sit.action };
  }
  // Extra permits besides the standard seeds: varied work types in varied zones
  const types = ['COLD_WORK', 'HEIGHT_WORK', 'ELECTRICAL_ISOLATION', 'COLD_WORK', 'RADIATION'];
  const extraPermits = Array.from({ length: Math.floor(r() * 3) }, () => {
    const zone = pick(r, zones.filter(z => !['Z-01', 'Z-05', 'Z-11', 'Z-12', 'Z-15'].includes(z.id)));
    return { type: pick(r, types), zone: zone.id, requestedBy: pick(r, roster).name, approvedBy: roster.find(w => w.role === 'Shift Supervisor').name };
  });
  return { sensorBaselines, targets, situation, extraPermits, workDrift: between(r, 0.004, 0.012) };
}

/**
 * Full layout for a site. `sector` template supplies names/PPE; geometry, sensors and
 * equipment are profile-specific. `cameras` / `sensorsOverride` let live sites configure their own.
 */
function buildSiteLayout(site, templateLayout) {
  const r = rng(`${site.id}:geometry`);
  const geo = buildGeometry(r);
  const zones = templateLayout.zones.map((z, i) => ({ ...z, ...geo[i] }));
  const sensors = Array.isArray(site.sensorsConfig) && site.sensorsConfig.length
    ? site.sensorsConfig.map((s, i) => ({ ...s, ...placeIn(zones.find(z => z.id === s.zone) || zones[0], rng(`${site.id}:s${i}`), i) }))
    : buildSensors(site.sector, zones, site.id);
  return {
    ...templateLayout,
    zones,
    sensors,
    cameras: cameraPositions(zones, templateLayout.cameras),
    equipment: (EQUIPMENT[site.sector] || EQUIPMENT.refinery).map(([label, zone, unit, baseline, normalState], i) => ({ id: `EQ-${String(i + 1).padStart(2, '0')}`, label, zone, unit, baseline, normalState })),
  };
}

function buildRuntimeProfile(site) {
  const r = rng(`${site.id}:people`);
  const roster = buildRoster(r, site.id);
  const sim = site.mode === 'live' ? null : buildSimProfile(site, site.layout.sensors, site.layout.zones, roster);
  return { roster, sim };
}

module.exports = { SENSOR_TYPES, SENSOR_PLANS, EQUIPMENT, buildSiteLayout, buildRuntimeProfile, rng, hashString };
