// Permit-to-Work State Manager
const plantLayout = require('./plant-layout.json');
const { buildAdjacency } = require('../services/KnowledgeGraph');

const PERMIT_TYPES = {
  HOT_WORK: { label: 'Hot Work', icon: '🔥', color: '#ff4444', risk: 9 },
  COLD_WORK: { label: 'Cold Work', icon: '🔧', color: '#4488ff', risk: 4 },
  CONFINED_SPACE: { label: 'Confined Space Entry', icon: '🕳️', color: '#ff8844', risk: 8 },
  ELECTRICAL_ISOLATION: { label: 'Electrical Isolation', icon: '⚡', color: '#ffff44', risk: 6 },
  HEIGHT_WORK: { label: 'Work at Height', icon: '🏗️', color: '#44ff88', risk: 5 },
  RADIATION: { label: 'Radiography Work', icon: '☢️', color: '#ff44ff', risk: 7 },
};

// Permit types that must not run simultaneously in the same or adjacent zones
const SIMOPS_CONFLICTS = [
  ['HOT_WORK', 'CONFINED_SPACE'],
  ['HOT_WORK', 'ELECTRICAL_ISOLATION'],
  ['HOT_WORK', 'RADIATION'],
  ['HOT_WORK', 'HOT_WORK'],
  ['CONFINED_SPACE', 'RADIATION'],
];

const zonesById = Object.fromEntries(plantLayout.zones.map(z => [z.id, z]));
const adjacency = buildAdjacency(plantLayout.zones);
const isNear = (a, b) => a === b || adjacency[a]?.has(b);

let seq = 3;
const nextId = () => `PTW-${new Date().getFullYear()}-${String(++seq).padStart(3, '0')}`;

function seedPermits() {
  const now = Date.now();
  return [
    {
      id: `PTW-${new Date().getFullYear()}-001`,
      type: 'HOT_WORK',
      title: 'Welding on Heat Exchanger E-101 shell',
      zone: 'Z-01', zoneName: zonesById['Z-01'].name,
      requestedBy: 'Suresh Reddy', approvedBy: null,
      startTime: new Date(now).toISOString(),
      endTime: new Date(now + 4 * 3600000).toISOString(),
      status: 'PENDING',
      workers: ['W-003', 'W-006'],
      gasTestRequired: true, gasTestResult: 'PENDING',
      aiValidated: false, aiWarnings: [], riskScore: 0,
      description: 'Repair weld on shell side of E-101. Paper permit raised at shift start; awaiting approval.',
    },
    {
      id: `PTW-${new Date().getFullYear()}-002`,
      type: 'CONFINED_SPACE',
      title: 'Inspection of Vessel V-301 (CS-01)',
      zone: 'Z-11', zoneName: zonesById['Z-11'].name,
      requestedBy: 'Rajesh Iyer', approvedBy: 'Deepika Patel',
      startTime: new Date(now - 1 * 3600000).toISOString(),
      endTime: new Date(now + 2 * 3600000).toISOString(),
      status: 'ACTIVE',
      workers: ['W-010', 'W-009'],
      gasTestRequired: true, gasTestResult: 'PASSED',
      aiValidated: true, aiWarnings: ['Continuous O2 monitoring mandatory during entry'], riskScore: 30,
      description: 'Internal inspection of V-301. Mechanical isolation confirmed. Attendant stationed at entry.',
    },
    {
      id: `PTW-${new Date().getFullYear()}-003`,
      type: 'ELECTRICAL_ISOLATION',
      title: 'Electrical isolation — P-201 motor',
      zone: 'Z-07', zoneName: zonesById['Z-07'].name,
      requestedBy: 'Venkat Rao', approvedBy: 'Mohan Singh',
      startTime: new Date(now - 30 * 60000).toISOString(),
      endTime: new Date(now + 5 * 3600000).toISOString(),
      status: 'ACTIVE',
      workers: ['W-006', 'W-011'],
      gasTestRequired: false, gasTestResult: 'N/A',
      aiValidated: true, aiWarnings: [], riskScore: 20,
      description: 'LOTO on pump P-201 for mechanical seal replacement. LOTO tag applied.',
    },
  ];
}

let permits = seedPermits();

function decorate(p) {
  return {
    ...p,
    ...PERMIT_TYPES[p.type],
    typeKey: p.type,
    durationHours: ((new Date(p.endTime) - new Date(p.startTime)) / 3600000).toFixed(1),
    elapsedMinutes: Math.max(0, Math.floor((Date.now() - new Date(p.startTime)) / 60000)),
  };
}

function getPermits(filter = {}) {
  return permits
    .filter(p => (!filter.status || p.status === filter.status) && (!filter.zone || p.zone === filter.zone))
    .map(decorate);
}

function getPermitById(id) {
  const p = permits.find(x => x.id === id);
  return p ? decorate(p) : null;
}

function createPermit(data) {
  if (!PERMIT_TYPES[data.type]) throw new Error(`Unknown permit type ${data.type}`);
  if (!zonesById[data.zone]) throw new Error(`Unknown zone ${data.zone}`);
  const hours = Math.min(24, Math.max(0.5, Number(data.durationHours) || 4));
  const p = {
    id: nextId(),
    type: data.type,
    title: String(data.title || `${PERMIT_TYPES[data.type].label} in ${zonesById[data.zone].name}`).slice(0, 120),
    zone: data.zone,
    zoneName: zonesById[data.zone].name,
    requestedBy: String(data.requestedBy || 'Unknown').slice(0, 60),
    approvedBy: null,
    description: String(data.description || '').slice(0, 500),
    workers: Array.isArray(data.workers) ? data.workers.slice(0, 20) : [],
    gasTestRequired: ['HOT_WORK', 'CONFINED_SPACE'].includes(data.type),
    gasTestResult: 'PENDING',
    status: 'PENDING',
    aiValidated: !!data.aiValidated,
    aiWarnings: data.aiWarnings || [],
    riskScore: data.riskScore || 0,
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + hours * 3600000).toISOString(),
  };
  permits.push(p);
  return decorate(p);
}

const VALID_STATUS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'REJECTED'];

function updatePermitStatus(id, status, by = null) {
  const permit = permits.find(p => p.id === id);
  if (!permit || !VALID_STATUS.includes(status)) return null;
  permit.status = status;
  if (status === 'ACTIVE') {
    permit.approvedBy = permit.approvedBy || by || 'Shift Supervisor';
    permit.startTime = new Date().toISOString();
    if (permit.gasTestResult === 'PENDING') permit.gasTestResult = 'PASSED';
  }
  if (status === 'CLOSED') permit.closeTime = new Date().toISOString();
  if (status === 'SUSPENDED') permit.suspendedAt = new Date().toISOString();
  return decorate(permit);
}

function getActivePermitsByZone() {
  const byZone = {};
  permits.filter(p => p.status === 'ACTIVE').forEach(p => {
    (byZone[p.zone] = byZone[p.zone] || []).push(p);
  });
  return byZone;
}

/** Conflicting permit types active in the same or adjacent zones. */
function detectSimops(candidate = null) {
  const active = permits.filter(p => p.status === 'ACTIVE');
  const pool = candidate ? [...active, candidate] : active;
  const conflicts = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      if (candidate && a !== candidate && b !== candidate) continue;
      const clash = SIMOPS_CONFLICTS.some(([x, y]) => (a.type === x && b.type === y) || (a.type === y && b.type === x));
      if (clash && isNear(a.zone, b.zone)) {
        conflicts.push({
          permitA: a.id || 'NEW', permitB: b.id || 'NEW', zones: [a.zone, b.zone], severity: 'HIGH',
          reason: `${PERMIT_TYPES[a.type].label} (${a.zone}) + ${PERMIT_TYPES[b.type].label} (${b.zone}) ${a.zone === b.zone ? 'in the same zone' : 'in adjacent zones'}`,
        });
      }
    }
  }
  return conflicts;
}

function resetPermits() {
  permits = seedPermits();
  seq = 3;
}

module.exports = { getPermits, getPermitById, createPermit, updatePermitStatus, getActivePermitsByZone, detectSimops, resetPermits, PERMIT_TYPES, isNear };
