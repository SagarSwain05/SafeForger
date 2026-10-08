// Persistence for users and custom sites.
// MongoDB when MONGO_URI is set; otherwise a JSON file (DATA_DIR) — fine for local runs, but
// ephemeral on free PaaS instances, which is reported by /api/system/status.
const fs = require('fs');
const path = require('path');

const matches = (doc, filter) => Object.entries(filter).every(([k, v]) =>
  (v && typeof v === 'object' && '$in' in v) ? v.$in.includes(doc[k]) : doc[k] === v);

class FileStore {
  constructor(dir) {
    this.kind = 'file';
    this.durable = false;
    this.file = path.join(dir, 'safeforge-db.json');
    this.data = { users: [], sites: [] };
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (err) {
      console.warn('[Store] could not read data file:', err.message);
    }
    this._timer = null;
  }
  async connect() { return this; }
  _save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      fs.promises.writeFile(this.file, JSON.stringify(this.data)).catch(err => console.warn('[Store] write failed:', err.message));
    }, 200);
  }
  _c(name) { return (this.data[name] = this.data[name] || []); }
  async find(coll, filter = {}) { return this._c(coll).filter(d => matches(d, filter)).map(d => ({ ...d })); }
  async findOne(coll, filter) { const d = this._c(coll).find(x => matches(x, filter)); return d ? { ...d } : null; }
  async insertOne(coll, doc) { this._c(coll).push({ ...doc }); this._save(); return doc; }
  async updateOne(coll, filter, patch) {
    const d = this._c(coll).find(x => matches(x, filter));
    if (!d) return null;
    Object.assign(d, patch);
    this._save();
    return { ...d };
  }
  async deleteOne(coll, filter) {
    const list = this._c(coll);
    const i = list.findIndex(x => matches(x, filter));
    if (i >= 0) { list.splice(i, 1); this._save(); }
    return i >= 0;
  }
  async close() { clearTimeout(this._timer); }
}

class MongoStore {
  constructor(uri, dbName) {
    this.kind = 'mongodb';
    this.durable = true;
    this.uri = uri;
    this.dbName = dbName;
  }
  async connect() {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 8000 });
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await this.db.collection('users').createIndex({ email: 1 }, { unique: true });
    await this.db.collection('sites').createIndex({ id: 1 }, { unique: true });
    return this;
  }
  _strip(d) { if (!d) return null; const { _id, ...rest } = d; return rest; }
  async find(coll, filter = {}) { return (await this.db.collection(coll).find(filter).toArray()).map(d => this._strip(d)); }
  async findOne(coll, filter) { return this._strip(await this.db.collection(coll).findOne(filter)); }
  async insertOne(coll, doc) { await this.db.collection(coll).insertOne({ ...doc }); return doc; }
  async updateOne(coll, filter, patch) {
    const r = await this.db.collection(coll).findOneAndUpdate(filter, { $set: patch }, { returnDocument: 'after' });
    return this._strip(r?.value !== undefined ? r.value : r);
  }
  async deleteOne(coll, filter) { return (await this.db.collection(coll).deleteOne(filter)).deletedCount > 0; }
  async close() { await this.client?.close(); }
}

async function createStore({ mongoUri, mongoDb, dataDir }) {
  if (mongoUri) {
    try {
      const s = await new MongoStore(mongoUri, mongoDb).connect();
      console.log('[Store] MongoDB connected');
      return s;
    } catch (err) {
      console.error('[Store] MongoDB unavailable, falling back to file store:', err.message);
    }
  }
  return new FileStore(dataDir).connect();
}

module.exports = { createStore, FileStore };
