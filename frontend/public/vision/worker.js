/* SafeForge browser vision worker — PPE compliance + fire/smoke detection with ONNX Runtime Web.
 * Mirrors cv-service/engine.py step for step so the browser edge and the Python edge emit
 * identical detection payloads. Runs off the UI thread; WebGPU when available, else WASM.
 *
 * Messages in:  {type:'init', ortUrl, wasmPaths, modelsBase}
 *               {type:'detect', id, bitmap, required}
 * Messages out: {type:'progress', loaded, total, file} · {type:'ready', provider, manifest}
 *               {type:'result', id, result} · {type:'error', id?, message}
 */
'use strict';

// Load ONNX Runtime synchronously at start-up (importScripts inside async handlers is
// rejected by Chromium). The version must match ORT_VERSION in src/lib/vision.ts.
const ORT_BASE = '/ort/';   // self-hosted (same origin) so threaded WASM can spawn its workers
let ortLoadError = null;
try { importScripts(ORT_BASE + 'ort.webgpu.min.js'); } catch (e) { ortLoadError = e; }

let rt = null;   // ONNX Runtime namespace (the bundle defines the global `ort`)
let manifest = null;
const sessions = {};
let provider = 'wasm';
let thr = null;
let ppeThresholds = {};
let fireThresholds = {};
let size = 640;
const canvas = { box: null, ctx: null, sample: null, sctx: null };

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function fetchWithProgress(url, file, totals) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  totals.total += total;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    totals.loaded += buf.byteLength;
    post({ type: 'progress', loaded: totals.loaded, total: totals.total, file });
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    totals.loaded += value.length;
    post({ type: 'progress', loaded: totals.loaded, total: totals.total, file });
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

async function init({ wasmPaths, modelsBase }) {
  if (ortLoadError || !self.ort) throw new Error(`Could not load ONNX Runtime Web from the CDN (${ortLoadError?.message || 'unknown error'}). Check the network connection.`);
  rt = self.ort;
  rt.env.wasm.wasmPaths = wasmPaths || ORT_BASE;
  // Multi-threaded WASM needs cross-origin isolation (COOP/COEP headers set in next.config)
  const cores = (self.navigator && navigator.hardwareConcurrency) || 2;
  rt.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, cores - 1)) : 1;
  rt.env.logLevel = 'error';

  manifest = await (await fetch(`${modelsBase}/manifest.json`)).json();
  size = manifest.input_size || 640;
  thr = manifest.thresholds;
  const items = manifest.ppe_items;
  ppeThresholds = { [manifest.person_label]: thr.worker };
  Object.values(items).forEach(v => { ppeThresholds[v.present] = thr.ppe; ppeThresholds[v.absent] = thr.violation; });
  (manifest.context_labels || []).forEach(l => { ppeThresholds[l] = thr.context; });
  Object.assign(ppeThresholds, manifest.class_thresholds || {});
  fireThresholds = { fire: thr.fire_low ?? thr.fire, smoke: thr.smoke };

  let gpuOk = false;
  try { gpuOk = !!(self.navigator && navigator.gpu && await navigator.gpu.requestAdapter()); } catch { gpuOk = false; }

  const totals = { loaded: 0, total: 0 };
  const buffers = {};
  await Promise.all(Object.entries(manifest.models).map(async ([key, spec]) => {
    buffers[key] = await fetchWithProgress(`${modelsBase}/${spec.file}`, spec.file, totals);
  }));

  const create = (buf, eps) => rt.InferenceSession.create(buf, { executionProviders: eps, graphOptimizationLevel: 'all' });
  provider = 'wasm';
  if (gpuOk) {
    try {
      for (const [key, buf] of Object.entries(buffers)) sessions[key] = await create(buf, ['webgpu']);
      provider = 'webgpu';
    } catch {
      provider = 'wasm';   // any WebGPU failure → run every model on WASM
    }
  }
  if (provider === 'wasm') {
    for (const [key, buf] of Object.entries(buffers)) sessions[key] = await create(buf, ['wasm']);
  }

  canvas.box = new OffscreenCanvas(size, size);
  canvas.ctx = canvas.box.getContext('2d', { willReadFrequently: true });
  canvas.sample = new OffscreenCanvas(8, 8);
  canvas.sctx = canvas.sample.getContext('2d', { willReadFrequently: true });

  // Warm-up run so the first real frame is fast
  await runAll(new Float32Array(3 * size * size));
  post({ type: 'ready', provider, manifest, threads: rt.env.wasm.numThreads });
}

// ── Pre-processing ─────────────────────────────────────────────────────────
function letterbox(bitmap) {
  const w = bitmap.width, h = bitmap.height;
  const scale = Math.min(size / w, size / h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  const padX = Math.round((size - nw) / 2 - 0.1), padY = Math.round((size - nh) / 2 - 0.1);
  const ctx = canvas.ctx;
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, padX, padY, nw, nh);
  const px = ctx.getImageData(0, 0, size, size).data;
  const area = size * size;
  const t = new Float32Array(3 * area);
  for (let i = 0, j = 0; i < area; i++, j += 4) {
    t[i] = px[j] / 255;
    t[i + area] = px[j + 1] / 255;
    t[i + 2 * area] = px[j + 2] / 255;
  }
  return { tensor: t, scale, padX, padY, w, h };
}

async function runAll(data) {
  const out = {};
  for (const [key, sess] of Object.entries(sessions)) {
    const input = new rt.Tensor('float32', data, [1, 3, size, size]);
    const res = await sess.run({ [sess.inputNames[0]]: input });
    const o = res[sess.outputNames[0]];
    out[key] = { data: o.data, dims: o.dims };
  }
  return out;
}

// ── Post-processing (same maths as engine.py) ──────────────────────────────
function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
}

function nms(dets, iouThr) {
  const keep = [];
  dets.sort((a, b) => b.confidence - a.confidence);
  for (const d of dets) if (keep.every(k => k.label !== d.label || iou(k.bbox, d.bbox) < iouThr)) keep.push(d);
  return keep;
}

function decode({ data, dims }, labels, thresholds, defThr, lb) {
  const nc = dims[1] - 4, n = dims[2];
  const minThr = Math.min(defThr, ...Object.values(thresholds));
  const dets = [];
  for (let i = 0; i < n; i++) {
    let best = 0, cls = 0;
    for (let c = 0; c < nc; c++) {
      const v = data[(4 + c) * n + i];
      if (v > best) { best = v; cls = c; }
    }
    if (best < minThr) continue;
    const label = labels[cls];
    if (best < (thresholds[label] ?? defThr)) continue;
    const cx = data[i], cy = data[n + i], bw = data[2 * n + i], bh = data[3 * n + i];
    const x1 = (cx - bw / 2 - lb.padX) / lb.scale, y1 = (cy - bh / 2 - lb.padY) / lb.scale;
    const x2 = (cx + bw / 2 - lb.padX) / lb.scale, y2 = (cy + bh / 2 - lb.padY) / lb.scale;
    dets.push({
      label, confidence: Math.round(best * 1000) / 1000,
      bbox: [Math.max(0, Math.round(x1)), Math.max(0, Math.round(y1)), Math.min(lb.w, Math.round(x2)), Math.min(lb.h, Math.round(y2))],
    });
  }
  return nms(dets, thr.iou);
}

function containment(item, person, margin = 0.12) {
  const pw = person[2] - person[0], ph = person[3] - person[1];
  const ex = [person[0] - pw * margin, person[1] - ph * margin, person[2] + pw * margin, person[3] + ph * margin];
  const ix = Math.max(0, Math.min(item[2], ex[2]) - Math.max(item[0], ex[0]));
  const iy = Math.max(0, Math.min(item[3], ex[3]) - Math.max(item[1], ex[1]));
  return (ix * iy) / Math.max(1, (item[2] - item[0]) * (item[3] - item[1]));
}

function flameColorRatio(bitmap, bbox) {
  const [x1, y1, x2, y2] = bbox;
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
  const s = Math.min(1, 96 / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * s)), h = Math.max(1, Math.round(bh * s));
  canvas.sample.width = w; canvas.sample.height = h;
  canvas.sctx.drawImage(bitmap, x1, y1, bw, bh, 0, 0, w, h);
  const px = canvas.sctx.getImageData(0, 0, w, h).data;
  let hit = 0;
  for (let j = 0; j < px.length; j += 4) {
    const r = px[j], g = px[j + 1], b = px[j + 2];
    if (r > 190 && g > 100 && b < 140 && r > g && g > b) hit++;
  }
  return hit / (w * h);
}

function associate(dets, required) {
  const items = manifest.ppe_items;
  const presentTo = {}, absentTo = {};
  Object.entries(items).forEach(([k, v]) => { presentTo[v.present] = k; absentTo[v.absent] = k; });
  const blank = () => Object.fromEntries(Object.keys(items).map(k => [k, 'unknown']));
  const people = dets.filter(d => d.label === manifest.person_label).map((w, i) => ({
    id: `W${String(i + 1).padStart(2, '0')}`, bbox: w.bbox, confidence: w.confidence, ppe: blank(), _s: {},
  }));
  for (const d of dets) {
    const isAbsent = d.label in absentTo, isPresent = d.label in presentTo;
    if (!isAbsent && !isPresent) continue;
    let best = null, bestScore = 0.5;
    for (const p of people) {
      const c = containment(d.bbox, p.bbox);
      if (c > bestScore) { best = p; bestScore = c; }
    }
    if (!best) {
      if (!isAbsent) continue;
      const [x1, y1, x2, y2] = d.bbox, w = x2 - x1, h = y2 - y1;
      best = { id: `W${String(people.length + 1).padStart(2, '0')}`, bbox: [Math.round(x1 - w * 0.6), Math.round(y1 - h * 0.2), Math.round(x2 + w * 0.6), Math.round(y2 + h * 3.5)], confidence: d.confidence, ppe: blank(), _s: {}, inferred: true };
      people.push(best);
    }
    const item = isAbsent ? absentTo[d.label] : presentTo[d.label];
    if (d.confidence >= (best._s[item] || 0)) { best.ppe[item] = isAbsent ? 'missing' : 'ok'; best._s[item] = d.confidence; }
  }
  for (const p of people) {
    delete p._s;
    p.missing = required.filter(k => p.ppe[k] === 'missing');
    p.compliant = p.missing.length === 0;
  }
  return people;
}

async function detect(bitmap, requiredIn) {
  const t0 = performance.now();
  const lb = letterbox(bitmap);
  const raw = await runAll(lb.tensor);
  const ppeRaw = decode(raw.ppe, manifest.models.ppe.labels, ppeThresholds, thr.ppe, lb);
  let hz = decode(raw.fire, manifest.models.fire.labels, fireThresholds, thr.fire, lb);

  const vests = ppeRaw.filter(d => d.label === manifest.ppe_items.vest.present).map(d => d.bbox);
  hz = hz.filter(d => !(d.label === 'fire' && vests.some(v => containment(d.bbox, v, 0.05) > 0.4)));
  hz = hz.filter(d => {
    if (d.label !== 'fire' || d.confidence >= thr.fire) return true;
    const ratio = flameColorRatio(bitmap, d.bbox);
    d.verified_by = 'flame_color'; d.color_ratio = Math.round(ratio * 1000) / 1000;
    return ratio >= (thr.fire_color_ratio ?? 0.25);
  });

  const required = (requiredIn && requiredIn.length ? requiredIn : manifest.default_required_ppe);
  const workers = associate(ppeRaw, required);
  const fire = hz.filter(d => d.label === 'fire'), smoke = hz.filter(d => d.label === 'smoke');
  const violators = workers.filter(p => !p.compliant);
  bitmap.close();
  return {
    frame: { w: lb.w, h: lb.h },
    inference_ms: Math.round((performance.now() - t0) * 10) / 10,
    required_ppe: required,
    workers,
    hazards: hz.map(d => ({ type: d.label, bbox: d.bbox, confidence: d.confidence, verified_by: d.verified_by })),
    context: ppeRaw.filter(d => (manifest.context_labels || []).includes(d.label)).map(d => ({ type: d.label, bbox: d.bbox, confidence: d.confidence })),
    worker_count: workers.length,
    compliant_workers: workers.length - violators.length,
    ppe_violations: violators.length,
    fire_detected: fire.length > 0,
    smoke_detected: smoke.length > 0,
    fire_confidence: fire.reduce((m, d) => Math.max(m, d.confidence), 0),
    smoke_confidence: smoke.reduce((m, d) => Math.max(m, d.confidence), 0),
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init(msg);
    else if (msg.type === 'detect') post({ type: 'result', id: msg.id, result: await detect(msg.bitmap, msg.required) });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: (err && err.message) || String(err) });
  }
};
