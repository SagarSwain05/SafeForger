// Permit-to-Work State Manager
const { v4: uuidv4 } = require('uuid');

const PERMIT_TYPES = {
  HOT_WORK: { label: 'Hot Work', icon: '🔥', color: '#ff4444', risk: 9 },
  COLD_WORK: { label: 'Cold Work', icon: '🔧', color: '#4488ff', risk: 4 },
  CONFINED_SPACE: { label: 'Confined Space Entry', icon: '🕳️', color: '#ff8844', risk: 8 },
  ELECTRICAL_ISOLATION: { label: 'Electrical Isolation', icon: '⚡', color: '#ffff44', risk: 6 },
  HEIGHT_WORK: { label: 'Work at Height', icon: '🏗️', color: '#44ff88', risk: 5 },
  RADIATION: { label: 'Radiography Work', icon: '☢️', color: '#ff44ff', risk: 7 },
};

// Pre-seeded active permits for demo
let permits = [
  {
    id: 'PTW-2024-001',
    type: 'HOT_WORK',
    title: 'Welding on Heat Exchanger E-101',
    zone: 'Z-01',
    zoneName: 'Crude Distillation Unit',
    requestedBy: 'Suresh Reddy',
    approvedBy: 'Deepika Patel',
    startTime: new Date(Date.now() - 2 * 3600000).toISOString(),
    endTime: new Date(Date.now() + 4 * 3600000).toISOString(),
    status: 'ACTIVE',
    workers: ['W-003', 'W-006'],
    gasTestRequired: true,
    gasTestResult: 'PASSED',
    aiValidated: true,
    aiWarnings: [],
    riskScore: 42,
    description: 'Repair weld on shell side of E-101. Nitrogen purge completed. Fire extinguisher standby.'
  },
  {
    id: 'PTW-2024-002',
    type: 'CONFINED_SPACE',
    title: 'Inspection of Vessel V-301 (CS-01)',
    zone: 'Z-11',
    zoneName: 'Confined Space CS-01',
    requestedBy: 'Rajesh Iyer',
    approvedBy: 'Deepika Patel',
    startTime: new Date(Date.now() - 1 * 3600000).toISOString(),
    endTime: new Date(Date.now() + 2 * 3600000).toISOString(),
    status: 'ACTIVE',
    workers: ['W-010', 'W-009'],
    gasTestRequired: true,
    gasTestResult: 'PASSED',
    aiValidated: true,
    aiWarnings: ['O2 levels trending downward - re-test in 30 min'],
    riskScore: 58,
    description: 'Internal inspection of V-301. Mechanical isolation confirmed. Attendant stationed at entry.'
  },
  {
    id: 'PTW-2024-003',
    type: 'ELECTRICAL_ISOLATION',
    title: 'Electrical Isolation P-201 Motor',
    zone: 'Z-07',
    zoneName: 'Pump Station A',
    requestedBy: 'Venkat Rao',
    approvedBy: 'Mohan Singh',
    startTime: new Date(Date.now() - 30 * 60000).toISOString(),
    endTime: new Date(Date.now() + 5 * 3600000).toISOString(),
    status: 'ACTIVE',
    workers: ['W-006', 'W-011'],
    gasTestRequired: false,
    gasTestResult: 'N/A',
    aiValidated: true,
    aiWarnings: [],
    riskScore: 28,
    description: 'LOTO on pump P-201 for mechanical seal replacement. LOTO tag applied.'
  }
];

function getPermits(filter = {}) {
  let result = [...permits];
  if (filter.status) result = result.filter(p => p.status === filter.status);
  if (filter.zone) result = result.filter(p => p.zone === filter.zone);
  return result.map(p => ({
    ...p,
    ...PERMIT_TYPES[p.type],
    typeKey: p.type,
    durationHours: ((new Date(p.endTime) - new Date(p.startTime)) / 3600000).toFixed(1),
    elapsedMinutes: Math.floor((Date.now() - new Date(p.startTime)) / 60000)
  }));
}

function getPermitById(id) {
  return permits.find(p => p.id === id);
}

function createPermit(data) {
  const newPermit = {
    id: `PTW-2024-${String(permits.length + 1).padStart(3, '0')}`,
    ...data,
    status: 'PENDING',
    aiValidated: false,
    aiWarnings: [],
    riskScore: 0,
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + (data.durationHours || 4) * 3600000).toISOString(),
  };
  permits.push(newPermit);
  return newPermit;
}

function updatePermitStatus(id, status) {
  const permit = permits.find(p => p.id === id);
  if (permit) {
    permit.status = status;
    if (status === 'CLOSED') permit.closeTime = new Date().toISOString();
  }
  return permit;
}

function getActivePermitsByZone() {
  const byZone = {};
  permits.filter(p => p.status === 'ACTIVE').forEach(p => {
    if (!byZone[p.zone]) byZone[p.zone] = [];
    byZone[p.zone].push(p);
  });
  return byZone;
}

function detectSimops() {
  const active = permits.filter(p => p.status === 'ACTIVE');
  const conflicts = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (a.type === 'HOT_WORK' && (b.type === 'ELECTRICAL_ISOLATION' || b.type === 'CONFINED_SPACE')) {
        conflicts.push({ permitA: a.id, permitB: b.id, severity: 'HIGH', reason: `${PERMIT_TYPES[a.type].label} + ${PERMIT_TYPES[b.type].label} simultaneous operation` });
      }
    }
  }
  return conflicts;
}

module.exports = { getPermits, getPermitById, createPermit, updatePermitStatus, getActivePermitsByZone, detectSimops, PERMIT_TYPES };
