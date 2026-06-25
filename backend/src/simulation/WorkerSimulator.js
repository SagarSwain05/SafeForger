// Worker Location Simulator — Brownian motion on plant floor
const { EventEmitter } = require('events');
const plantLayout = require('../data/plant-layout.json');

const WORKERS = [
  { id: 'W-001', name: 'Rajan Kumar', role: 'Operator', shift: 'A', badge: 'B-001' },
  { id: 'W-002', name: 'Priya Nair', role: 'Safety Officer', shift: 'A', badge: 'B-002' },
  { id: 'W-003', name: 'Suresh Reddy', role: 'Maintenance Tech', shift: 'A', badge: 'B-003' },
  { id: 'W-004', name: 'Amit Sharma', role: 'Operator', shift: 'A', badge: 'B-004' },
  { id: 'W-005', name: 'Deepika Patel', role: 'Shift Supervisor', shift: 'A', badge: 'B-005' },
  { id: 'W-006', name: 'Venkat Rao', role: 'Maintenance Tech', shift: 'A', badge: 'B-006' },
  { id: 'W-007', name: 'Kavitha Menon', role: 'Operator', shift: 'B', badge: 'B-007' },
  { id: 'W-008', name: 'Mohan Singh', role: 'Fire & Safety', shift: 'A', badge: 'B-008' },
  { id: 'W-009', name: 'Lakshmi Das', role: 'Operator', shift: 'A', badge: 'B-009' },
  { id: 'W-010', name: 'Rajesh Iyer', role: 'Instrument Tech', shift: 'A', badge: 'B-010' },
  { id: 'W-011', name: 'Sundar Pillai', role: 'Maintenance Lead', shift: 'A', badge: 'B-011' },
  { id: 'W-012', name: 'Anitha Krishnan', role: 'Process Engineer', shift: 'A', badge: 'B-012' },
];

class WorkerSimulator extends EventEmitter {
  constructor() {
    super();
    this.workers = {};
    this.zones = plantLayout.zones;
    this._initializeWorkers();
  }

  _initializeWorkers() {
    WORKERS.forEach(worker => {
      const zone = this.zones[Math.floor(Math.random() * this.zones.length)];
      this.workers[worker.id] = {
        ...worker,
        zoneId: zone.id,
        zoneName: zone.name,
        x: zone.x + Math.random() * zone.w,
        y: zone.y + Math.random() * zone.h,
        targetZone: null,
        movingTo: null,
        ppeStatus: 'COMPLIANT',
        lastUpdated: Date.now()
      };
    });
  }

  _getZoneById(id) {
    return this.zones.find(z => z.id === id);
  }

  _clampToZone(x, y, zone) {
    return {
      x: Math.max(zone.x + 5, Math.min(zone.x + zone.w - 5, x)),
      y: Math.max(zone.y + 5, Math.min(zone.y + zone.h - 5, y))
    };
  }

  _updateWorker(worker) {
    const zone = this._getZoneById(worker.zoneId);
    if (!zone) return worker;

    // Random walk within zone
    const dx = (Math.random() - 0.5) * 8;
    const dy = (Math.random() - 0.5) * 8;
    
    const newPos = this._clampToZone(worker.x + dx, worker.y + dy, zone);
    worker.x = newPos.x;
    worker.y = newPos.y;
    
    // Occasionally move to new zone (5% chance)
    if (Math.random() < 0.05) {
      const newZone = this.zones[Math.floor(Math.random() * this.zones.length)];
      worker.zoneId = newZone.id;
      worker.zoneName = newZone.name;
      worker.x = newZone.x + Math.random() * newZone.w;
      worker.y = newZone.y + Math.random() * newZone.h;
    }
    
    worker.lastUpdated = Date.now();
    return worker;
  }

  getAllWorkers() {
    return Object.values(this.workers).map(w => {
      this._updateWorker(w);
      return {
        id: w.id,
        name: w.name,
        role: w.role,
        shift: w.shift,
        badge: w.badge,
        zoneId: w.zoneId,
        zoneName: w.zoneName,
        x: parseFloat(w.x.toFixed(1)),
        y: parseFloat(w.y.toFixed(1)),
        ppeStatus: w.ppeStatus,
        lastUpdated: w.lastUpdated
      };
    });
  }

  setWorkersInZone(zoneId, workerIds) {
    workerIds.forEach(id => {
      if (this.workers[id]) {
        const zone = this._getZoneById(zoneId);
        if (zone) {
          this.workers[id].zoneId = zoneId;
          this.workers[id].zoneName = zone.name;
          this.workers[id].x = zone.x + Math.random() * zone.w;
          this.workers[id].y = zone.y + Math.random() * zone.h;
        }
      }
    });
  }

  getWorkersInZone(zoneId) {
    return Object.values(this.workers).filter(w => w.zoneId === zoneId);
  }

  start(intervalMs = 1500) {
    this._interval = setInterval(() => {
      const workers = this.getAllWorkers();
      this.emit('locations', workers);
    }, intervalMs);
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
  }
}

module.exports = { WorkerSimulator, WORKERS };
