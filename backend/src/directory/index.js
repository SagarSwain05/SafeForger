// All-India plant directory — used at sign-up so supervisors and managers can find their plant
// and be linked to it. Base data: Wikidata (CC0) + OpenStreetMap (ODbL), built by
// backend/scripts/build_plant_directory.py. Plants users add (when theirs isn't listed) are stored
// in the database and become searchable immediately, marked as user-added.
const crypto = require('crypto');

let base = { plants: [], count: 0, attribution: '' };
try { base = require('../data/plant-directory.json'); } catch { /* directory not built yet */ }

const SECTORS = {
  refinery: 'Oil & gas refinery', steel: 'Steel & metals', power: 'Power generation', chemical: 'Chemical / petrochemical',
  cement: 'Cement', automotive: 'Automotive', mining: 'Mining', pharma: 'Pharmaceutical', logistics: 'Ports & logistics',
  construction: 'Construction', manufacturing: 'General manufacturing',
};

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function indexEntry(p) {
  return { ...p, _name: norm(p.name), _hay: norm(`${p.name} ${p.operator} ${p.district} ${p.state} ${p.type} ${p.sectorLabel}`) };
}

class PlantDirectory {
  constructor(store) {
    this.store = store;
    // Curated flagship facilities (also used as demo twins) — guaranteed to be findable
    const { PRESETS } = require('../sites/presets');
    const curated = PRESETS.filter(p => !p.company.includes('sandbox')).map(p => ({
      id: `in-cu-${p.id}`, name: p.name, operator: p.company, sector: p.sector, sectorLabel: SECTORS[p.sector] || p.sector,
      type: 'Major facility', district: p.city, state: p.state, country: 'India', lat: null, lng: null, source: 'curated', estate: false,
    }));
    this.plants = [...curated, ...base.plants].map(indexEntry);
    this.byId = new Map(this.plants.map(p => [p.id, p]));
    this.attribution = base.attribution;
  }

  /** Load plants users have added (persisted). */
  async load() {
    const added = await this.store.find('plants', {});
    for (const p of added) this._add(indexEntry(p));
    return this;
  }

  _add(p) {
    if (this.byId.has(p.id)) return;
    this.plants.push(p);
    this.byId.set(p.id, p);
  }

  get(id) {
    const p = this.byId.get(id);
    if (!p) return null;
    const { _name, _hay, ...rest } = p;
    return rest;
  }

  meta() {
    const bySector = {}, byState = {};
    for (const p of this.plants) {
      bySector[p.sector] = (bySector[p.sector] || 0) + 1;
      if (p.state) byState[p.state] = (byState[p.state] || 0) + 1;
    }
    return { total: this.plants.length, sectors: Object.entries(SECTORS).map(([id, label]) => ({ id, label, count: bySector[id] || 0 })), states: STATES.map(s => ({ name: s, count: byState[s] || 0 })), attribution: this.attribution };
  }

  /** Ranked search: every query word must match; name/prefix matches rank first, estates last. */
  search({ q = '', state = '', sector = '', limit = 25 } = {}) {
    const words = norm(q).split(' ').filter(Boolean);
    const out = [];
    for (const p of this.plants) {
      if (state && p.state !== state) continue;
      if (sector && p.sector !== sector) continue;
      let score = 0;
      if (words.length) {
        let ok = true;
        for (const w of words) {
          if (p._name.startsWith(w)) score += 6;
          else if (p._name.includes(` ${w}`)) score += 4;
          else if (p._name.includes(w)) score += 2;
          else if (p._hay.includes(w)) score += 1;
          else { ok = false; break; }
        }
        if (!ok) continue;
        if (p._name === words.join(' ')) score += 10;
      }
      if (p.source === 'wikidata' || p.source === 'curated') score += 1.5;
      if (p.estate) score -= 1;
      if (p.source === 'user') score += 0.5;
      out.push([score, p]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return { total: out.length, results: out.slice(0, Math.min(50, limit)).map(([, p]) => this.get(p.id)) };
  }

  /** Add a plant that isn't listed (from sign-up or onboarding). */
  async add(input, user) {
    const name = String(input.name || '').trim().slice(0, 120);
    const state = STATES.includes(input.state) ? input.state : null;
    const sector = SECTORS[input.sector] ? input.sector : null;
    if (name.length < 3) throw Object.assign(new Error('Plant name is required'), { status: 400 });
    if (!state) throw Object.assign(new Error('Choose the state the plant is in'), { status: 400 });
    if (!sector) throw Object.assign(new Error('Choose the industry sector'), { status: 400 });
    // Re-use an existing entry with the same name in the same state instead of duplicating it
    const dup = this.plants.find(p => p._name === norm(name) && p.state === state);
    if (dup) return this.get(dup.id);
    const p = {
      id: `in-us-${crypto.randomBytes(5).toString('hex')}`, name, operator: String(input.organization || input.operator || '').trim().slice(0, 100),
      sector, sectorLabel: SECTORS[sector], type: 'Added by a user', district: String(input.district || input.city || '').trim().slice(0, 60),
      state, country: 'India', lat: null, lng: null, source: 'user', estate: false, addedBy: user?.email || null, createdAt: new Date().toISOString(),
    };
    await this.store.insertOne('plants', p);
    this._add(indexEntry(p));
    return this.get(p.id);
  }
}

module.exports = { PlantDirectory, DIRECTORY_SECTORS: SECTORS, INDIAN_STATES: STATES };
