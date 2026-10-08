// Browser edge vision — wraps the ONNX Runtime Web worker (public/vision/worker.js),
// applies k-of-n temporal confirmation and builds the detection payload the backend ingests.
// Mirrors cv-service/engine.py + publisher.py so both edges speak the same contract.

export const ORT_VERSION = '1.30.0';   // self-hosted under /ort (synced from node_modules at build)

export type PPEState = 'ok' | 'missing' | 'unknown';
export interface Worker_ {
  id: string; bbox: number[]; confidence: number; ppe: Record<string, PPEState>;
  missing: string[]; compliant: boolean; inferred?: boolean; pending?: boolean; frames?: number;
}
export interface Hazard { type: 'fire' | 'smoke'; bbox: number[]; confidence: number; verified_by?: string }
export interface VisionResult {
  frame: { w: number; h: number }; inference_ms: number; required_ppe: string[];
  workers: Worker_[]; hazards: Hazard[]; context: { type: string; bbox: number[]; confidence: number }[];
  worker_count: number; compliant_workers: number; ppe_violations: number;
  fire_detected: boolean; smoke_detected: boolean; fire_confidence: number; smoke_confidence: number;
}
export interface VisionEvent { type: 'FIRE' | 'SMOKE' | 'PPE_VIOLATION'; confidence: number; missing?: string[]; count?: number }
export interface Manifest {
  ppe_items: Record<string, { present: string; absent: string; label: string }>;
  temporal: { window: number; fire: number; smoke: number; ppe: number };
  default_required_ppe: string[];
  models: Record<string, { file: string; arch: string; source: string; license: string; labels: string[] }>;
}

export class VisionEngine {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (r: VisionResult) => void; reject: (e: Error) => void }>();
  private seq = 0;
  provider: 'webgpu' | 'wasm' | null = null;
  threads = 1;
  manifest: Manifest | null = null;

  init(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.worker) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = new Worker('/vision/worker.js');
      this.worker = w;
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.loaded, m.total);
        else if (m.type === 'ready') { this.provider = m.provider; this.threads = m.threads || 1; this.manifest = m.manifest; resolve(); }
        else if (m.type === 'result') { this.pending.get(m.id)?.resolve(m.result); this.pending.delete(m.id); }
        else if (m.type === 'error') {
          if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)!.reject(new Error(m.message)); this.pending.delete(m.id); }
          else reject(new Error(m.message));
        }
      };
      w.onerror = (e) => reject(new Error(e.message || 'Vision worker failed to start'));
      w.postMessage({ type: 'init', modelsBase: '/models' });
    });
  }

  async detect(source: CanvasImageSource, required: string[]): Promise<VisionResult> {
    if (!this.worker) throw new Error('Vision engine not initialised');
    const bitmap = await createImageBitmap(source as ImageBitmapSource);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'detect', id, bitmap, required }, [bitmap]);
    });
  }

  dispose() { this.worker?.terminate(); this.worker = null; this.pending.clear(); }
}

/** k-of-n debounce per event type (mirror of engine.TemporalConfirmer). */
export class TemporalConfirmer {
  private hist: Record<string, boolean[]> = { FIRE: [], SMOKE: [], PPE_VIOLATION: [] };
  constructor(private cfg: Manifest['temporal']) {}

  update(r: VisionResult, singleFrame = false): VisionEvent[] {
    const need: Record<string, number> = { FIRE: this.cfg.fire, SMOKE: this.cfg.smoke, PPE_VIOLATION: this.cfg.ppe };
    const flags: Record<string, [boolean, number]> = {
      FIRE: [r.fire_detected, r.fire_confidence],
      SMOKE: [r.smoke_detected, r.smoke_confidence],
      PPE_VIOLATION: [r.ppe_violations > 0, Math.max(0, ...r.workers.filter(w => !w.compliant).map(w => w.confidence))],
    };
    const out: VisionEvent[] = [];
    for (const [type, [hit, conf]] of Object.entries(flags)) {
      const h = this.hist[type];
      h.push(hit);
      if (h.length > this.cfg.window) h.shift();
      if (hit && (singleFrame || h.filter(Boolean).length >= need[type])) {
        const ev: VisionEvent = { type: type as VisionEvent['type'], confidence: Math.round(conf * 1000) / 1000 };
        if (type === 'PPE_VIOLATION') {
          ev.missing = [...new Set(r.workers.flatMap(w => w.missing))].sort();
          ev.count = r.ppe_violations;
        }
        out.push(ev);
      }
    }
    return out;
  }

  reset() { this.hist = { FIRE: [], SMOKE: [], PPE_VIOLATION: [] }; }
}

export function buildPayload(cameraId: string, zone: string, r: VisionResult, events: VisionEvent[], fps: number, evidence?: string | null) {
  return {
    camera_id: cameraId, zone, source: 'browser', timestamp: new Date().toISOString(),
    fps: Math.round(fps * 10) / 10, inference_ms: r.inference_ms, frame: r.frame, required_ppe: r.required_ppe,
    worker_count: r.worker_count, compliant_workers: r.compliant_workers, ppe_violations: r.ppe_violations,
    fire_detected: r.fire_detected, smoke_detected: r.smoke_detected,
    fire_confidence: r.fire_confidence, smoke_confidence: r.smoke_confidence,
    workers: r.workers.map(w => ({ id: w.id, bbox: w.bbox, confidence: w.confidence, ppe: w.ppe, missing: w.missing, compliant: w.compliant })),
    hazards: r.hazards, events, evidence: evidence || null,
  };
}

/** Draw detection overlays scaled from frame pixels onto a display canvas. */
export function drawOverlay(ctx: CanvasRenderingContext2D, r: VisionResult, sx: number, sy: number, labels: Record<string, string>) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  for (const w of r.workers) {
    const [x1, y1, x2, y2] = w.bbox.map((v, i) => v * (i % 2 ? sy : sx));
    const color = !w.compliant ? '#ef4444' : w.pending ? '#f59e0b' : '#22c55e';
    ctx.strokeStyle = color;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    // Label: missing required items first, then confirmed ones — keeps tags short and readable
    const req = r.required_ppe;
    const missing = req.filter(k => w.ppe[k] === 'missing').map(k => '✗' + (labels[k] || k));
    const ok = req.filter(k => w.ppe[k] === 'ok').map(k => '✓' + (labels[k] || k));
    const text = `${w.id} ${[...missing, ...ok].join(' ') || (w.pending ? 'checking…' : 'worker')}`;
    const tw = ctx.measureText(text).width + 8;
    ctx.fillStyle = color;
    ctx.fillRect(x1, Math.max(0, y1 - 18), tw, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x1 + 4, Math.max(13, y1 - 5));
  }
  for (const h of r.hazards) {
    const [x1, y1, x2, y2] = h.bbox.map((v, i) => v * (i % 2 ? sy : sx));
    const color = h.type === 'fire' ? '#f97316' : '#a3a3a3';
    ctx.strokeStyle = color;
    ctx.setLineDash(h.type === 'smoke' ? [6, 4] : []);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    const text = `${h.type.toUpperCase()} ${(h.confidence * 100).toFixed(0)}%`;
    ctx.fillStyle = color;
    ctx.fillRect(x1, y1, ctx.measureText(text).width + 8, 18);
    ctx.fillStyle = '#111';
    ctx.fillText(text, x1 + 4, y1 + 13);
  }
  ctx.restore();
}

// ── Multi-frame worker tracking ─────────────────────────────────────────────
// Live video flickers: a helmet seen in one frame and missed in the next would make a worker
// blink between compliant and violating. The tracker gives each worker a stable ID across
// frames (IoU / centroid matching), eases the box for display, and votes PPE state over the
// last N observations — an item is "missing" only after it was seen missing in ≥3 recent frames.

interface Track {
  id: string; bbox: number[]; shown: number[]; confidence: number; hits: number; misses: number;
  history: Record<string, PPEState[]>;
}

const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
};

export class WorkerTracker {
  private tracks: Track[] = [];
  private seq = 0;
  constructor(private window = 8, private missingVotes = 3, private okVotes = 2, private maxMisses = 6) {}

  reset() { this.tracks = []; this.seq = 0; }

  update(r: VisionResult): VisionResult {
    const dets = r.workers;
    const pairs: [number, number, number][] = [];
    this.tracks.forEach((t, ti) => dets.forEach((d, di) => {
      const o = iou(t.bbox, d.bbox);
      const [tx, ty] = [(t.bbox[0] + t.bbox[2]) / 2, (t.bbox[1] + t.bbox[3]) / 2];
      const [dx, dy] = [(d.bbox[0] + d.bbox[2]) / 2, (d.bbox[1] + d.bbox[3]) / 2];
      const diag = Math.hypot(t.bbox[2] - t.bbox[0], t.bbox[3] - t.bbox[1]);
      const near = Math.hypot(tx - dx, ty - dy) < 0.45 * diag;
      if (o >= 0.25 || near) pairs.push([o + (near ? 0.1 : 0), ti, di]);
    }));
    pairs.sort((a, b) => b[0] - a[0]);
    const usedT = new Set<number>(), usedD = new Set<number>();
    const matched: [Track, Worker_][] = [];
    for (const [, ti, di] of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti); usedD.add(di);
      matched.push([this.tracks[ti], dets[di]]);
    }
    for (const [t, d] of matched) {
      t.bbox = d.bbox;
      t.shown = t.shown.map((v, i) => Math.round(v * 0.45 + d.bbox[i] * 0.55));
      t.confidence = d.confidence; t.hits++; t.misses = 0;
      this.observe(t, d);
    }
    this.tracks.forEach((t, i) => { if (!usedT.has(i)) t.misses++; });
    dets.forEach((d, i) => {
      if (usedD.has(i)) return;
      const t: Track = { id: `T${++this.seq}`, bbox: d.bbox, shown: [...d.bbox], confidence: d.confidence, hits: 1, misses: 0, history: {} };
      this.observe(t, d);
      this.tracks.push(t);
    });
    this.tracks = this.tracks.filter(t => t.misses <= this.maxMisses);

    // Report tracks seen in the last two frames, with voted PPE state
    const workers: Worker_[] = this.tracks.filter(t => t.misses <= 1).map(t => {
      const ppe: Record<string, PPEState> = {};
      for (const [item, h] of Object.entries(t.history)) {
        const miss = h.filter(s => s === 'missing').length, ok = h.filter(s => s === 'ok').length;
        ppe[item] = miss >= this.missingVotes && miss >= ok ? 'missing' : ok >= this.okVotes ? 'ok' : 'unknown';
      }
      const missing = r.required_ppe.filter(k => ppe[k] === 'missing');
      const pending = r.required_ppe.some(k => (t.history[k] || []).slice(-3).includes('missing')) && !missing.length;
      return { id: t.id, bbox: t.shown, confidence: t.confidence, ppe, missing, compliant: missing.length === 0, pending, frames: t.hits } as Worker_;
    });
    const violators = workers.filter(w => !w.compliant).length;
    return { ...r, workers, worker_count: workers.length, ppe_violations: violators, compliant_workers: workers.length - violators };
  }

  private observe(t: Track, d: Worker_) {
    for (const [item, state] of Object.entries(d.ppe)) {
      const h = (t.history[item] = t.history[item] || []);
      h.push(state);
      if (h.length > this.window) h.shift();
    }
  }
}
