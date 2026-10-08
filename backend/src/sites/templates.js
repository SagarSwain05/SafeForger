// Industry sector templates → plant digital-twin layouts.
//
// Every template shares the same 15-zone / 11-sensor / 6-camera geometry (so maps, edge-agent
// homography, SCADA register maps and the risk rules work identically everywhere) and differs
// in zone names, hazard classes, required PPE, camera and sensor labels, and permit titles.
// Z-01 is always the zone where hot work meets a flammable atmosphere (the kill-chain zone);
// Z-11/Z-12 are always confined spaces; Z-15 is always the emergency assembly area.
const base = require('../data/plant-layout.json');

const P = {                       // PPE shorthands
  core: ['helmet', 'vest', 'boots'],
  hv: ['helmet', 'vest'],
  cs: ['helmet', 'vest', 'boots', 'gloves'],
  none: [],
};
const COLOR = { CRITICAL: '#ff0000', HIGH: '#ff4444', MEDIUM: '#ff8844', LOW: '#44ff88', SAFE: '#4488ff' };

// [name, hazardClass, area type, required PPE]
const SECTORS = {
  refinery: {
    label: 'Oil & gas refinery',
    zones: [
      ['Crude Distillation Unit', 'HIGH', 'ATEX-Zone1', P.core], ['Hydrocracker Unit', 'HIGH', 'ATEX-Zone1', P.core],
      ['Storage Tank Farm', 'CRITICAL', 'ATEX-Zone0', P.core], ['Utility Block', 'LOW', 'Non-Hazardous', P.hv],
      ['Control Room', 'SAFE', 'Safe', P.none], ['Flare Stack Area', 'MEDIUM', 'ATEX-Zone2', P.core],
      ['Pump Station A', 'HIGH', 'ATEX-Zone1', P.core], ['Heat Exchanger Bay', 'MEDIUM', 'ATEX-Zone2', P.core],
      ['Compressor Hall', 'HIGH', 'ATEX-Zone1', P.core], ['Maintenance Workshop', 'LOW', 'Non-Hazardous', P.hv],
      ['Confined Space CS-01', 'CRITICAL', 'Confined-Space', P.cs], ['Confined Space CS-02', 'CRITICAL', 'Confined-Space', P.cs],
      ['Loading Bay', 'MEDIUM', 'ATEX-Zone2', P.core], ['Cooling Tower', 'LOW', 'Non-Hazardous', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['CDU Main Gate', 'Tank Farm Perimeter', 'Pump Station Entry', 'Confined Space CS-01', 'Loading Bay', 'Control Room Entry'],
    hotWork: 'Welding on heat exchanger E-101 shell',
  },
  steel: {
    label: 'Integrated steel plant',
    zones: [
      ['Coke Oven Battery', 'HIGH', 'Gas hazard', P.core], ['By-product Plant', 'HIGH', 'Gas hazard', P.core],
      ['Blast Furnace Cast House', 'CRITICAL', 'Molten metal', P.core], ['Raw Material Handling', 'LOW', 'Dust', P.hv],
      ['Central Control Room', 'SAFE', 'Safe', P.none], ['Sinter Plant', 'MEDIUM', 'Dust / heat', P.core],
      ['BOF Converter Shop', 'HIGH', 'Molten metal', P.core], ['Continuous Casting', 'MEDIUM', 'Heat', P.core],
      ['Hot Strip Mill', 'HIGH', 'Moving machinery', P.core], ['Roll Shop', 'LOW', 'Workshop', P.hv],
      ['Gas Holder Inspection', 'CRITICAL', 'Confined-Space', P.cs], ['Ladle Relining Pit', 'CRITICAL', 'Confined-Space', P.cs],
      ['Slag Yard', 'MEDIUM', 'Heat / vehicles', P.core], ['Water Treatment', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Coke Oven Top', 'Cast House Floor', 'Converter Shop Bay', 'Gas Holder Manway', 'Slag Yard Gate', 'Control Room Entry'],
    hotWork: 'Gas cutting on coke-oven door frame',
  },
  power: {
    label: 'Thermal power station',
    zones: [
      ['Fuel Oil Pump House', 'HIGH', 'ATEX-Zone1', P.core], ['Boiler House', 'HIGH', 'Heat / pressure', P.core],
      ['Coal Handling Plant', 'CRITICAL', 'Dust explosion', P.core], ['Switchyard', 'MEDIUM', 'Electrical', P.hv],
      ['Unit Control Room', 'SAFE', 'Safe', P.none], ['Ash Handling', 'MEDIUM', 'Dust', P.core],
      ['Turbine Hall', 'HIGH', 'Rotating machinery', P.core], ['Feed Water Heaters', 'MEDIUM', 'Pressure', P.core],
      ['Hydrogen Plant', 'HIGH', 'ATEX-Zone1', P.core], ['Mechanical Workshop', 'LOW', 'Workshop', P.hv],
      ['Boiler Drum (internal)', 'CRITICAL', 'Confined-Space', P.cs], ['Coal Bunker', 'CRITICAL', 'Confined-Space', P.cs],
      ['Wagon Tippler', 'MEDIUM', 'Vehicles', P.core], ['Cooling Tower', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Fuel Oil Pump House', 'Coal Conveyor Junction', 'Turbine Floor', 'Boiler Drum Manhole', 'Wagon Tippler', 'Control Room Entry'],
    hotWork: 'Welding on fuel-oil header support',
  },
  chemical: {
    label: 'Chemical / petrochemical plant',
    zones: [
      ['Reactor Section', 'HIGH', 'ATEX-Zone1', P.core], ['Solvent Recovery', 'HIGH', 'ATEX-Zone1', P.core],
      ['Bulk Chemical Storage', 'CRITICAL', 'ATEX-Zone0', P.core], ['Utilities', 'LOW', 'Non-Hazardous', P.hv],
      ['DCS Control Room', 'SAFE', 'Safe', P.none], ['Effluent Treatment', 'MEDIUM', 'Toxic', P.core],
      ['Transfer Pump Area', 'HIGH', 'ATEX-Zone1', P.core], ['Distillation Columns', 'MEDIUM', 'ATEX-Zone2', P.core],
      ['Compressor House', 'HIGH', 'ATEX-Zone1', P.core], ['Maintenance Shop', 'LOW', 'Workshop', P.hv],
      ['Reactor Vessel R-201', 'CRITICAL', 'Confined-Space', P.cs], ['Storage Tank Interior', 'CRITICAL', 'Confined-Space', P.cs],
      ['Tanker Loading Gantry', 'MEDIUM', 'ATEX-Zone2', P.core], ['Cooling Tower', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Reactor Platform', 'Bulk Storage Dyke', 'Transfer Pumps', 'Vessel R-201 Manway', 'Loading Gantry', 'Control Room Entry'],
    hotWork: 'Welding on reactor feed line flange',
  },
  cement: {
    label: 'Cement plant',
    zones: [
      ['Coal Mill', 'HIGH', 'Dust / gas', P.core], ['Pre-heater Tower', 'HIGH', 'Heat', P.core],
      ['Alternative Fuel Storage', 'CRITICAL', 'Flammable', P.core], ['Limestone Crusher', 'MEDIUM', 'Dust', P.hv],
      ['Central Control Room', 'SAFE', 'Safe', P.none], ['Rotary Kiln', 'MEDIUM', 'Heat', P.core],
      ['Clinker Cooler', 'HIGH', 'Heat', P.core], ['Raw Mill', 'MEDIUM', 'Dust', P.core],
      ['Cement Mill', 'HIGH', 'Rotating machinery', P.core], ['Workshop', 'LOW', 'Workshop', P.hv],
      ['Cyclone Cleaning', 'CRITICAL', 'Confined-Space', P.cs], ['Cement Silo', 'CRITICAL', 'Confined-Space', P.cs],
      ['Packing & Dispatch', 'MEDIUM', 'Vehicles', P.core], ['Water Reservoir', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Coal Mill Floor', 'Fuel Storage Shed', 'Clinker Cooler', 'Silo Hatch', 'Packing Plant', 'Control Room Entry'],
    hotWork: 'Welding on coal-mill duct',
  },
  automotive: {
    label: 'Automotive manufacturing',
    zones: [
      ['Paint Shop', 'HIGH', 'Solvent vapour', P.core], ['Paint Mixing Room', 'HIGH', 'ATEX-Zone1', P.core],
      ['Fuel & Solvent Store', 'CRITICAL', 'Flammable', P.core], ['Press Shop', 'MEDIUM', 'Machinery', P.hv],
      ['Plant Control Room', 'SAFE', 'Safe', P.none], ['Body-in-White Welding', 'MEDIUM', 'Hot work', P.core],
      ['Engine Assembly', 'HIGH', 'Machinery', P.core], ['Final Assembly Line', 'MEDIUM', 'Machinery', P.hv],
      ['Battery Pack Line', 'HIGH', 'Electrical / fire', P.core], ['Tool Room', 'LOW', 'Workshop', P.hv],
      ['Paint Sludge Pit', 'CRITICAL', 'Confined-Space', P.cs], ['ED Tank', 'CRITICAL', 'Confined-Space', P.cs],
      ['Logistics Dock', 'MEDIUM', 'Vehicles / forklifts', P.core], ['Utility Block', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Paint Shop Booth 2', 'Solvent Store', 'Engine Line', 'Sludge Pit Hatch', 'Logistics Dock', 'Control Room Entry'],
    hotWork: 'Welding repair on paint-booth conveyor',
  },
  mining: {
    label: 'Mining (opencast / underground)',
    zones: [
      ['Underground Development Face', 'HIGH', 'Gassy seam', P.core], ['Main Haulage Roadway', 'HIGH', 'Gas / vehicles', P.core],
      ['Explosives Magazine', 'CRITICAL', 'Explosives', P.core], ['Workshop & Stores', 'LOW', 'Workshop', P.hv],
      ['Mine Control Room', 'SAFE', 'Safe', P.none], ['Coal Handling Plant', 'MEDIUM', 'Dust', P.core],
      ['Shovel-Dumper Bench', 'HIGH', 'Heavy vehicles', P.core], ['Conveyor Transfer', 'MEDIUM', 'Machinery', P.core],
      ['Ventilation Fan House', 'HIGH', 'Rotating machinery', P.core], ['Lamp Room', 'LOW', 'Utility', P.hv],
      ['Sump & Pump Chamber', 'CRITICAL', 'Confined-Space', P.cs], ['Old Workings Inspection', 'CRITICAL', 'Confined-Space', P.cs],
      ['Railway Siding', 'MEDIUM', 'Vehicles', P.core], ['Overburden Dump', 'LOW', 'Vehicles', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Development Face', 'Magazine Gate', 'Shovel Bench', 'Pump Chamber', 'Railway Siding', 'Control Room Entry'],
    hotWork: 'Welding on conveyor structure near the face',
  },
  pharma: {
    label: 'Pharmaceutical / API manufacturing',
    zones: [
      ['Solvent Reaction Block', 'HIGH', 'ATEX-Zone1', P.core], ['Solvent Recovery Plant', 'HIGH', 'ATEX-Zone1', P.core],
      ['Solvent Tank Farm', 'CRITICAL', 'ATEX-Zone0', P.core], ['Warehouse', 'LOW', 'Storage', P.hv],
      ['QC & Control Room', 'SAFE', 'Safe', P.none], ['Drying & Milling', 'MEDIUM', 'Dust', P.core],
      ['Centrifuge Area', 'HIGH', 'ATEX-Zone1', P.core], ['Granulation', 'MEDIUM', 'Dust', P.core],
      ['Hydrogenation Unit', 'HIGH', 'ATEX-Zone1', P.core], ['Engineering Workshop', 'LOW', 'Workshop', P.hv],
      ['Reactor Vessel Entry', 'CRITICAL', 'Confined-Space', P.cs], ['Effluent Pit', 'CRITICAL', 'Confined-Space', P.cs],
      ['Drum Filling', 'MEDIUM', 'ATEX-Zone2', P.core], ['Boiler House', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Reaction Block', 'Solvent Tank Farm', 'Centrifuge Room', 'Reactor Manway', 'Drum Filling', 'Control Room Entry'],
    hotWork: 'Welding on solvent transfer line',
  },
  logistics: {
    label: 'Port / warehousing & logistics',
    zones: [
      ['Fuel Bunkering Station', 'HIGH', 'ATEX-Zone1', P.core], ['Liquid Cargo Berth', 'HIGH', 'ATEX-Zone1', P.core],
      ['Hazardous Cargo Yard', 'CRITICAL', 'Dangerous goods', P.core], ['Container Stack', 'MEDIUM', 'Vehicles / cranes', P.hv],
      ['Operations Control Centre', 'SAFE', 'Safe', P.none], ['Bulk Conveyor', 'MEDIUM', 'Dust', P.core],
      ['Quay Crane Area', 'HIGH', 'Cranes', P.core], ['Warehouse A', 'MEDIUM', 'Forklifts', P.hv],
      ['Reefer Yard', 'HIGH', 'Electrical', P.core], ['Equipment Workshop', 'LOW', 'Workshop', P.hv],
      ['Ship Hold Entry', 'CRITICAL', 'Confined-Space', P.cs], ['Tank Container Cleaning', 'CRITICAL', 'Confined-Space', P.cs],
      ['Truck Gate', 'MEDIUM', 'Vehicles', P.core], ['Admin Block', 'LOW', 'Office', P.none],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Bunkering Station', 'Hazardous Cargo Yard', 'Quay Crane 3', 'Ship Hold Hatch', 'Truck Gate', 'Control Centre Entry'],
    hotWork: 'Welding on bunkering pipeline support',
  },
  manufacturing: {
    label: 'General manufacturing',
    zones: [
      ['Paint & Coating Shop', 'HIGH', 'Solvent vapour', P.core], ['Fuel / LPG Yard', 'HIGH', 'ATEX-Zone1', P.core],
      ['Raw Material Store', 'MEDIUM', 'Storage / forklifts', P.hv], ['Machine Shop', 'MEDIUM', 'Machinery', P.hv],
      ['Production Control Room', 'SAFE', 'Safe', P.none], ['Welding & Fabrication Bay', 'MEDIUM', 'Hot work', P.core],
      ['Assembly Line 1', 'MEDIUM', 'Machinery', P.hv], ['Assembly Line 2', 'MEDIUM', 'Machinery', P.hv],
      ['Boiler & Compressor House', 'HIGH', 'Pressure', P.core], ['Maintenance Workshop', 'LOW', 'Workshop', P.hv],
      ['Effluent Treatment Pit', 'CRITICAL', 'Confined-Space', P.cs], ['Storage Tank Interior', 'CRITICAL', 'Confined-Space', P.cs],
      ['Dispatch & Loading Dock', 'MEDIUM', 'Vehicles / forklifts', P.core], ['Utility Block', 'LOW', 'Utility', P.hv],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Paint Shop', 'Fuel / LPG Yard', 'Assembly Line 1', 'Effluent Pit Hatch', 'Loading Dock', 'Control Room Entry'],
    hotWork: 'Welding repair on a paint-shop duct',
  },
  construction: {
    label: 'Construction / infrastructure site',
    zones: [
      ['Basement Excavation', 'HIGH', 'Gas / collapse', P.core], ['Tower Crane Zone', 'HIGH', 'Lifting', P.core],
      ['Fuel & Gas Cylinder Store', 'CRITICAL', 'Flammable', P.core], ['Rebar Yard', 'MEDIUM', 'Material handling', P.core],
      ['Site Office', 'SAFE', 'Safe', P.none], ['Batching Plant', 'MEDIUM', 'Machinery', P.core],
      ['Scaffolding — Block A', 'HIGH', 'Work at height', P.core], ['Formwork Deck', 'MEDIUM', 'Work at height', P.core],
      ['Tunnel Heading', 'HIGH', 'Underground', P.core], ['Fabrication Shed', 'LOW', 'Workshop', P.hv],
      ['Manhole / Sewer Line', 'CRITICAL', 'Confined-Space', P.cs], ['Water Tank Interior', 'CRITICAL', 'Confined-Space', P.cs],
      ['Material Gate', 'MEDIUM', 'Vehicles', P.core], ['Labour Camp', 'LOW', 'Welfare', P.none],
      ['Emergency Assembly', 'SAFE', 'Safe', P.none],
    ],
    cameras: ['Excavation Edge', 'Cylinder Store', 'Scaffold Block A', 'Manhole MH-4', 'Material Gate', 'Site Office Entry'],
    hotWork: 'Gas cutting of sheet piles in the excavation',
  },
};

const SECTOR_LIST = Object.entries(SECTORS).map(([id, s]) => ({ id, label: s.label }));

/**
 * Build a layout for a sector, applying optional user overrides:
 *   overrides.zones[i] = { name?, hazardClass?, requiredPPE? }
 *   overrides.cameras = [{ id?, label, zone, sourceType, url }] (replaces default cameras)
 */
function buildLayout(sectorId, plantName, overrides = {}) {
  const s = SECTORS[sectorId] || SECTORS.refinery;
  const zones = base.zones.map((z, i) => {
    const [name, hazardClass, type, requiredPPE] = s.zones[i];
    const o = (overrides.zones || [])[i] || {};
    const hc = o.hazardClass || hazardClass;
    return { ...z, name: String(o.name || name).slice(0, 60), hazardClass: hc, type, color: COLOR[hc], requiredPPE: Array.isArray(o.requiredPPE) ? o.requiredPPE : requiredPPE };
  });
  const defaultCams = base.cameras.map((c, i) => ({ ...c, label: s.cameras[i], sourceType: 'browser', url: null }));
  let cameras = defaultCams;
  if (Array.isArray(overrides.cameras) && overrides.cameras.length) {
    cameras = overrides.cameras.slice(0, 16).map((c, i) => {
      const zone = zones.find(z => z.id === c.zone) || zones[0];
      const preset = base.cameras[i];
      return {
        id: c.id || `CAM-${String(i + 1).padStart(2, '0')}`,
        label: String(c.label || `Camera ${i + 1}`).slice(0, 60),
        zone: zone.id,
        x: preset && preset.zone === zone.id ? preset.x : zone.x + 12 + (i % 3) * 20,
        y: preset && preset.zone === zone.id ? preset.y : zone.y + 14,
        sourceType: ['browser', 'video_url', 'rtsp', 'webcam'].includes(c.sourceType) ? c.sourceType : 'browser',
        url: c.url ? String(c.url).slice(0, 500) : null,
      };
    });
  }
  return {
    plant: { name: plantName, width: base.plant.width, height: base.plant.height, sector: sectorId, sectorLabel: s.label },
    zones,
    sensors: base.sensors.map(x => ({ ...x })),
    cameras,
    permitPPE: base.permitPPE,
    hotWorkTitle: s.hotWork,
  };
}

module.exports = { SECTORS, SECTOR_LIST, buildLayout };
