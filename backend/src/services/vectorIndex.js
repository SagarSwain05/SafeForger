// Lightweight vector index — TF-IDF vectors + cosine similarity over the incident and
// regulation corpus. Runs in-process (no external vector DB to provision), deterministic,
// and fast enough for thousands of documents. Swap for embeddings + ChromaDB/Pinecone at scale.

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the to was were will with this these those which who what when where how why not no can may shall should must any all into near than then there their them they been being do does did done our we you your i if so such per via'.split(' '));

const SYNONYMS = {
  helmet: 'hardhat', 'hard-hat': 'hardhat', hat: 'hardhat', vests: 'vest', 'hi-vis': 'vest', hivis: 'vest',
  boots: 'footwear', shoes: 'footwear', glove: 'gloves', goggle: 'goggles', flames: 'fire', flame: 'fire', blaze: 'fire',
  welding: 'hotwork', 'hot-work': 'hotwork', spark: 'sparks', methane: 'ch4', lel: 'ch4', oxygen: 'o2',
  simops: 'simultaneous', 'confined-space': 'confined', handover: 'shift',
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/hot[\s_-]work/g, 'hotwork')
    .replace(/confined[\s_-]space/g, 'confined')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => SYNONYMS[w] || w)
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(stem);
}

class VectorIndex {
  constructor(docs, textOf) {
    this.docs = docs;
    const tokenized = docs.map(d => tokenize(textOf(d)));
    const df = new Map();
    tokenized.forEach(toks => new Set(toks).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const N = docs.length;
    this.idf = new Map([...df].map(([t, n]) => [t, Math.log((N + 1) / (n + 1)) + 1]));
    this.vectors = tokenized.map(toks => this._vector(toks));
  }

  _vector(tokens) {
    const tf = new Map();
    tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
    const v = new Map();
    let norm = 0;
    tf.forEach((n, t) => {
      const w = (1 + Math.log(n)) * (this.idf.get(t) || 0);
      if (w > 0) { v.set(t, w); norm += w * w; }
    });
    norm = Math.sqrt(norm) || 1;
    v.forEach((w, t) => v.set(t, w / norm));
    return v;
  }

  search(query, k = 5, minScore = 0.05) {
    const q = this._vector(tokenize(query));
    if (q.size === 0) return [];
    return this.vectors
      .map((v, i) => {
        let dot = 0;
        q.forEach((w, t) => { dot += w * (v.get(t) || 0); });
        return { doc: this.docs[i], score: +dot.toFixed(4) };
      })
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

module.exports = { VectorIndex, tokenize };
