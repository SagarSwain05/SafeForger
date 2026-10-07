// Browser edge vision — wraps the ONNX Runtime Web worker (public/vision/worker.js),
// applies k-of-n temporal confirmation and builds the detection payload the backend ingests.
// Mirrors cv-service/engine.py + publisher.py so both edges speak the same contract.

export const ORT_VERSION = '1.30.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

export type PPEState = 'ok' | 'missing' | 'unknown';
export interface Worker_ {
  id: string; bbox: number[]; confidence: number; ppe: Record<string, PPEState>;
  missing: string[]; compliant: boolean; inferred?: boolean;
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
  manifest: Manifest | null = null;

  init(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.worker) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = new Worker('/vision/worker.js');
      this.worker = w;
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.loaded, m.total);
        else if (m.type === 'ready') { this.provider = m.provider; this.manifest = m.manifest; resolve(); }
        else if (m.type === 'result') { this.pending.get(m.id)?.resolve(m.result); this.pending.delete(m.id); }
        else if (m.type === 'error') {
          if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)!.reject(new Error(m.message)); this.pending.delete(m.id); }
          else reject(new Error(m.message));
        }
      };
      w.onerror = (e) => reject(new Error(e.message || 'Vision worker failed to start'));
      w.postMessage({ type: 'init', ortUrl: `${ORT_BASE}ort.webgpu.min.js`, wasmPaths: ORT_BASE, modelsBase: '/models' });
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
    const color = w.compliant ? '#22c55e' : '#ef4444';
    ctx.strokeStyle = color;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    // Label: missing required items first, then confirmed ones — keeps tags short and readable
    const req = r.required_ppe;
    const missing = req.filter(k => w.ppe[k] === 'missing').map(k => '✗' + (labels[k] || k));
    const ok = req.filter(k => w.ppe[k] === 'ok').map(k => '✓' + (labels[k] || k));
    const text = `${w.id} ${[...missing, ...ok].join(' ') || 'worker'}`;
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
