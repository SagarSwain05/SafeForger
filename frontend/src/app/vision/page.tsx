'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, useSocket } from '@/lib/socket';
import { VisionEngine, TemporalConfirmer, buildPayload, drawOverlay, type VisionResult, type VisionEvent } from '@/lib/vision';

const SAMPLES = [
  { file: 'no_ppe_street.jpg', label: 'No PPE — workers at a pump station entry', kind: 'image', camera: 'CAM-03' },
  { file: 'ppe_mixed_site.jpg', label: 'Mixed compliance — construction deck', kind: 'image', camera: 'CAM-05' },
  { file: 'ppe_compliant_crew.jpg', label: 'Compliant crew — helmets & hi-vis', kind: 'image', camera: 'CAM-01' },
  { file: 'fire_outdoor.webm', label: 'Fire & smoke — recorded footage (video)', kind: 'video', camera: 'CAM-02' },
  { file: 'smoke_warehouse.jpg', label: 'Smoke plume — warehouse', kind: 'image', camera: 'CAM-02' },
  { file: 'fire_flame.jpg', label: 'Open flames — close range', kind: 'image', camera: 'CAM-01' },
] as const;

const CAMERAS = [
  { id: 'CAM-01', label: 'CDU Main Gate', zone: 'Z-01' },
  { id: 'CAM-02', label: 'Tank Farm Perimeter', zone: 'Z-03' },
  { id: 'CAM-03', label: 'Pump Station Entry', zone: 'Z-07' },
  { id: 'CAM-04', label: 'Confined Space CS-01', zone: 'Z-11' },
  { id: 'CAM-05', label: 'Loading Bay', zone: 'Z-13' },
  { id: 'CAM-06', label: 'Control Room Entry', zone: 'Z-05' },
];

const EVENT_STYLE: Record<string, { color: string; icon: string; label: string }> = {
  FIRE: { color: '#f97316', icon: '🔥', label: 'Fire' },
  SMOKE: { color: '#a3a3a3', icon: '💨', label: 'Smoke' },
  PPE_VIOLATION: { color: '#ef4444', icon: '⛑️', label: 'PPE violation' },
};

type Source = { kind: 'image' | 'video' | 'webcam'; url?: string; name: string };
type LogItem = { at: string; type: string; text: string; sent: boolean };

export default function VisionPage() {
  const { permits, connected } = useSocket();
  const engineRef = useRef<VisionEngine | null>(null);
  const confirmerRef = useRef<TemporalConfirmer | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resultRef = useRef<VisionResult | null>(null);
  const runningRef = useRef(false);
  const lastPublishRef = useRef(0);
  const lastEvidenceRef = useRef<Record<string, number>>({});
  const fpsRef = useRef({ n: 0, t0: 0 });

  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [engineError, setEngineError] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [cameraId, setCameraId] = useState('CAM-01');
  const [result, setResult] = useState<VisionResult | null>(null);
  const [events, setEvents] = useState<VisionEvent[]>([]);
  const [fps, setFps] = useState(0);
  const [requirements, setRequirements] = useState<Record<string, any>>({});
  const [log, setLog] = useState<LogItem[]>([]);
  const [sent, setSent] = useState({ ok: 0, failed: 0, lastError: '' });
  const [streamToBackend, setStreamToBackend] = useState(true);

  const camera = CAMERAS.find(c => c.id === cameraId)!;
  const req = requirements[camera.zone];
  const required: string[] = req?.items ?? ['helmet', 'vest'];
  const labels: Record<string, string> = Object.fromEntries(Object.entries(engineRef.current?.manifest?.ppe_items ?? {}).map(([k, v]) => [k, v.label]));

  // The inference loop is long-lived; it reads the latest settings through refs
  const live = useRef({ cameraId, zone: camera.zone, required, stream: true, labels });
  live.current = { cameraId, zone: camera.zone, required, stream: streamToBackend, labels };

  // ── Engine ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const eng = new VisionEngine();
    engineRef.current = eng;
    setEngineState('loading');
    eng.init((loaded, total) => setProgress(total ? Math.min(99, Math.round((loaded / total) * 100)) : 0))
      .then(() => {
        setEngineState('ready');
        setProvider(eng.provider);
        confirmerRef.current = new TemporalConfirmer(eng.manifest!.temporal);
      })
      .catch(err => { setEngineState('error'); setEngineError(err.message); });
    return () => { runningRef.current = false; eng.dispose(); streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // Effective PPE requirements (zone baseline + active permits) from the backend
  useEffect(() => {
    api('/vision/requirements').then(setRequirements).catch(() => {});
  }, [permits]);

  // ── Rendering loop: draw media + latest overlay ───────────────────────────
  const media = (): HTMLVideoElement | HTMLImageElement | null => {
    if (!source) return null;
    return source.kind === 'image' ? imgRef.current : videoRef.current;
  };

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current, m = media();
      if (c && m) {
        const w = m instanceof HTMLVideoElement ? m.videoWidth : m.naturalWidth;
        const h = m instanceof HTMLVideoElement ? m.videoHeight : m.naturalHeight;
        if (w && h) {
          const cw = c.clientWidth || 800;
          const ch = Math.round(cw * (h / w));
          if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
          const ctx = c.getContext('2d')!;
          ctx.drawImage(m, 0, 0, cw, ch);
          const r = resultRef.current;
          if (r) drawOverlay(ctx, r, cw / r.frame.w, ch / r.frame.h, Object.fromEntries(Object.entries(engineRef.current?.manifest?.ppe_items ?? {}).map(([k, v]) => [k, v.label])));
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Publishing to the command center ──────────────────────────────────────
  const evidenceFrame = (): string | null => {
    const c = canvasRef.current;
    if (!c || !c.width) return null;
    const s = Math.min(1, 640 / Math.max(c.width, c.height));
    const t = document.createElement('canvas');
    t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
    t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.72);
  };

  const publish = useCallback(async (r: VisionResult, evs: VisionEvent[], curFps: number, force = false) => {
    const { cameraId: cam, zone, stream } = live.current;
    if (!stream) return;
    const now = Date.now();
    const fresh = evs.filter(e => now - (lastEvidenceRef.current[e.type] || 0) > 15000);
    if (!force && !fresh.length && now - lastPublishRef.current < 1000) return;
    lastPublishRef.current = now;
    let evidence: string | null = null;
    if (fresh.length) {
      evidence = evidenceFrame();
      fresh.forEach(e => { lastEvidenceRef.current[e.type] = now; });
    }
    try {
      await api('/vision/detections', { method: 'POST', json: buildPayload(cam, zone, r, evs, curFps, evidence), timeoutMs: 15000 });
      setSent(s => ({ ...s, ok: s.ok + 1, lastError: '' }));
      if (fresh.length) {
        setLog(l => [...fresh.map(e => ({ at: new Date().toLocaleTimeString(), type: e.type, text: describe(e), sent: true })), ...l].slice(0, 30));
      }
    } catch (err: any) {
      setSent(s => ({ ...s, failed: s.failed + 1, lastError: err.message }));
      if (fresh.length) setLog(l => [...fresh.map(e => ({ at: new Date().toLocaleTimeString(), type: e.type, text: describe(e), sent: false })), ...l].slice(0, 30));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function describe(e: VisionEvent) {
    const lb = live.current.labels;
    if (e.type === 'PPE_VIOLATION') return `${e.count} worker(s) missing ${(e.missing || []).map(m => lb[m] || m).join(', ')}`;
    return `${EVENT_STYLE[e.type].label} detected (${Math.round(e.confidence * 100)}%)`;
  }

  // ── Inference loop ────────────────────────────────────────────────────────
  const analyseOnce = useCallback(async (singleFrame: boolean) => {
    const eng = engineRef.current, m = media();
    if (!eng?.manifest || !m) return null;
    const r = await eng.detect(m, live.current.required);
    resultRef.current = r;
    setResult(r);
    const evs = confirmerRef.current!.update(r, singleFrame);
    setEvents(evs);
    const f = fpsRef.current;
    f.n++;
    const elapsed = (performance.now() - f.t0) / 1000;
    const curFps = singleFrame ? 0 : f.n / Math.max(0.001, elapsed);
    if (!singleFrame) setFps(curFps);
    publish(r, evs, curFps, singleFrame);
    return r;
  }, [source, publish]); // eslint-disable-line react-hooks/exhaustive-deps

  const runLoop = useCallback(async () => {
    runningRef.current = true;
    fpsRef.current = { n: 0, t0: performance.now() };
    while (runningRef.current) {
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try { await analyseOnce(false); } catch (err: any) { setEngineError(err.message); }
      }
      await new Promise(r => setTimeout(r, 30));
    }
  }, [analyseOnce]);

  const stop = () => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    videoRef.current?.pause();
  };

  const startSource = async (s: Source, cam?: string) => {
    stop();
    confirmerRef.current?.reset();
    resultRef.current = null;
    setResult(null); setEvents([]); setFps(0);
    lastEvidenceRef.current = {};
    if (cam) setCameraId(cam);
    setSource(s);
  };

  // React to a newly selected source once its element is mounted
  useEffect(() => {
    if (!source || engineState !== 'ready') return;
    let cancelled = false;
    (async () => {
      if (source.kind === 'image') {
        const img = imgRef.current!;
        if (!img.complete || !img.naturalWidth) await new Promise(r => { img.onload = r; img.onerror = r; });
        if (!cancelled) await analyseOnce(true);
      } else {
        const v = videoRef.current!;
        if (source.kind === 'webcam') {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, facingMode: 'environment' }, audio: false });
          streamRef.current = stream;
          v.srcObject = stream;
        } else {
          v.srcObject = null;
          v.src = source.url!;
        }
        await v.play().catch(() => {});
        if (!cancelled) runLoop();
      }
    })().catch(err => setEngineError(err.message));
    return () => { cancelled = true; runningRef.current = false; };
  }, [source, engineState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-evaluate a still image when the camera (zone rules) changes
  useEffect(() => {
    if (source?.kind !== 'image' || engineState !== 'ready' || !resultRef.current || !imgRef.current?.naturalWidth) return;
    confirmerRef.current?.reset();
    lastEvidenceRef.current = {};
    analyseOnce(true).catch(err => setEngineError(err.message));
  }, [cameraId, requirements]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    startSource({ kind: file.type.startsWith('video') ? 'video' : 'image', url, name: file.name });
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  const violators = result?.workers.filter(w => !w.compliant) ?? [];
  const tile = (label: string, value: string | number, color: string, sub?: string) => (
    <div className="glass-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#4a6080' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>VISION AI</h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>
            Real-time PPE compliance (helmet · hi-vis vest · footwear · gloves) and fire / smoke detection — runs on this device, alerts the command center
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="tag-chip" style={{ color: engineState === 'ready' ? '#22c55e' : engineState === 'error' ? '#ef4444' : '#ffb300' }}>
            {engineState === 'ready' ? `● Models ready · ${provider === 'webgpu' ? 'WebGPU' : 'WASM'}` : engineState === 'error' ? '● Model load failed' : `◌ Loading models ${progress}%`}
          </span>
          <span className="tag-chip" style={{ color: connected ? '#22c55e' : '#ef4444' }}>{connected ? '● Command center linked' : '● Command center offline'}</span>
        </div>
      </div>

      {engineState === 'loading' && (
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 14 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: '#00b0ff', borderRadius: 2, transition: 'width .3s' }} />
        </div>
      )}
      {engineError && <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12 }}>⚠ {engineError}</div>}

      <div className="vision-grid">
        {/* Stage */}
        <div>
          <div className="glass-card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select aria-label="Sample footage" value="" onChange={e => { const s = SAMPLES.find(x => x.file === e.target.value); if (s) startSource({ kind: s.kind, url: `/samples/${s.file}`, name: s.label }, s.camera); }}
                disabled={engineState !== 'ready'} style={selectStyle}>
                <option value="">▶ Sample footage…</option>
                {SAMPLES.map(s => <option key={s.file} value={s.file}>{s.label}</option>)}
              </select>
              <label style={{ ...btnStyle, opacity: engineState === 'ready' ? 1 : 0.5 }}>
                ⬆ Upload image / video
                <input type="file" accept="image/*,video/*" hidden disabled={engineState !== 'ready'} onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
              </label>
              <button style={btnStyle} disabled={engineState !== 'ready'} onClick={() => startSource({ kind: 'webcam', name: 'Live webcam' })}>📷 Live webcam</button>
              {source && source.kind !== 'image' && <button style={{ ...btnStyle, color: '#fca5a5' }} onClick={stop}>■ Stop</button>}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
                <span style={{ fontSize: 11, color: '#8ba0c4' }}>Camera</span>
                <select aria-label="Camera" value={cameraId} onChange={e => setCameraId(e.target.value)} style={{ ...selectStyle, minWidth: 0, flex: 1 }}>
                  {CAMERAS.map(c => <option key={c.id} value={c.id}>{c.id} · {c.label} ({c.zone})</option>)}
                </select>
              </div>
            </div>

            <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', minHeight: 360 }}>
              <canvas ref={canvasRef} style={{ width: '100%', display: source ? 'block' : 'none' }} />
              {!source && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#8ba0c4', textAlign: 'center', padding: 24 }}>
                  <div style={{ fontSize: 40 }}>🎥</div>
                  <div style={{ fontSize: 14, color: '#e8f0ff' }}>Choose sample footage, upload a CCTV clip / photo, or start your webcam</div>
                  <div style={{ fontSize: 12 }}>Detections are confirmed over several frames, then sent to the command center with the camera&apos;s zone, the evidence frame and the regulation breached.</div>
                </div>
              )}
              {source && (
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={overlayChip}>{camera.id} · {camera.label} · {camera.zone}</span>
                  <span style={overlayChip}>{source.name}</span>
                  {result && <span style={overlayChip}>{result.inference_ms.toFixed(0)} ms{fps ? ` · ${fps.toFixed(1)} fps` : ''}</span>}
                </div>
              )}
              {events.some(e => e.type === 'FIRE') && <div className="emergency-mode" style={{ position: 'absolute', inset: 0, border: '3px solid #f97316', pointerEvents: 'none' }} />}
              {/* hidden media elements */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={source?.kind === 'image' ? source.url : undefined} alt="" style={{ display: 'none' }} crossOrigin="anonymous" />
              <video ref={videoRef} style={{ display: 'none' }} muted playsInline loop crossOrigin="anonymous" />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 12, color: '#8ba0c4' }}>
              <span>Required PPE in {camera.zone}:</span>
              {required.length ? required.map(i => (
                <span key={i} className="tag-chip" style={req?.permitDriven?.includes(i) ? { color: '#ffb300', borderColor: 'rgba(255,179,0,0.4)' } : undefined}>
                  {labels[i] || i}{req?.permitDriven?.includes(i) ? ' · permit' : ''}
                </span>
              )) : <span className="tag-chip">None (safe zone)</span>}
              <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={streamToBackend} onChange={e => setStreamToBackend(e.target.checked)} /> Stream to command center
              </label>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 14, marginTop: 14, fontSize: 12, color: '#8ba0c4', lineHeight: 1.6 }}>
            <strong style={{ color: '#e8f0ff' }}>How it works.</strong> Two YOLOv8 models run in a Web Worker via ONNX Runtime ({provider === 'webgpu' ? 'WebGPU' : 'WebAssembly'}):
            a 19-class PPE model (hard hat, vest, boots, gloves, goggles, mask and their <em>absence</em>) and a fire/smoke model trained on D-Fire.
            PPE items are matched to each worker; a worker is flagged only when a <em>required</em> item is detected as missing. Fire needs 2 of 5 frames, smoke and PPE 3 of 5,
            so a single noisy frame never raises an alarm. The same engine runs on the Python edge agent for RTSP cameras.
          </div>
        </div>

        {/* Side panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {tile('Workers', result?.worker_count ?? '—', '#448aff')}
            {tile('PPE violations', result ? result.ppe_violations : '—', violators.length ? '#ef4444' : '#22c55e',
              result?.worker_count ? `${Math.round((result.compliant_workers / result.worker_count) * 100)}% compliant` : undefined)}
            {tile('Fire', result ? (result.fire_detected ? 'YES' : 'no') : '—', result?.fire_detected ? '#f97316' : '#22c55e', result?.fire_detected ? `${Math.round(result.fire_confidence * 100)}% conf.` : undefined)}
            {tile('Smoke', result ? (result.smoke_detected ? 'YES' : 'no') : '—', result?.smoke_detected ? '#a3a3a3' : '#22c55e', result?.smoke_detected ? `${Math.round(result.smoke_confidence * 100)}% conf.` : undefined)}
          </div>

          <div className="glass-card" style={{ padding: 14 }}>
            <div style={panelTitle}>Confirmed events</div>
            {events.length === 0 && <div style={{ fontSize: 12, color: '#4a6080' }}>No confirmed hazards in the current frame window.</div>}
            {events.map(e => (
              <div key={e.type} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, marginBottom: 6, background: `${EVENT_STYLE[e.type].color}18`, border: `1px solid ${EVENT_STYLE[e.type].color}55` }}>
                <span>{EVENT_STYLE[e.type].icon}</span>
                <span style={{ fontSize: 12, color: '#e8f0ff', fontWeight: 600 }}>{describe(e)}</span>
              </div>
            ))}
          </div>

          <div className="glass-card" style={{ padding: 14 }}>
            <div style={panelTitle}>Workers in view</div>
            {!result?.workers.length && <div style={{ fontSize: 12, color: '#4a6080' }}>No workers detected.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {result?.workers.map(w => (
                <div key={w.id} style={{ padding: 8, borderRadius: 6, background: w.compliant ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.09)', border: `1px solid ${w.compliant ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: w.compliant ? '#86efac' : '#fca5a5' }}>
                    <span>{w.id}{w.inferred ? ' (partial)' : ''}</span><span>{w.compliant ? 'Compliant' : `Missing: ${w.missing.map(m => labels[m] || m).join(', ')}`}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {Object.entries(w.ppe).filter(([, s]) => s !== 'unknown').map(([k, s]) => (
                      <span key={k} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: s === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.18)', color: s === 'ok' ? '#86efac' : '#fca5a5' }}>
                        {s === 'ok' ? '✓' : '✗'} {labels[k] || k}{required.includes(k) ? '' : ' (opt.)'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ ...panelTitle, display: 'flex', justifyContent: 'space-between' }}>
              <span>Sent to command center</span>
              <Link href="/alerts" style={{ color: '#00b0ff', textDecoration: 'none', textTransform: 'none', letterSpacing: 0 }}>Open alerts →</Link>
            </div>
            <div style={{ fontSize: 11, color: '#4a6080', marginBottom: 8 }}>
              {sent.ok} payloads delivered{sent.failed ? ` · ${sent.failed} failed${sent.lastError ? ` (${sent.lastError})` : ''}` : ''}
            </div>
            {log.length === 0 && <div style={{ fontSize: 12, color: '#4a6080' }}>Alerts raised from this feed appear here.</div>}
            {log.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(56,100,200,0.1)' }}>
                <span style={{ color: '#4a6080', fontFamily: 'JetBrains Mono, monospace' }}>{l.at}</span>
                <span>{EVENT_STYLE[l.type]?.icon}</span>
                <span style={{ color: '#c7d2fe', flex: 1 }}>{l.text}</span>
                <span style={{ color: l.sent ? '#22c55e' : '#ef4444' }}>{l.sent ? '✓ alerted' : '✗ offline'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  background: 'rgba(0,176,255,0.1)', border: '1px solid rgba(0,176,255,0.3)', color: '#7dd3fc',
};
const selectStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'rgba(10,18,40,0.9)', color: '#e8f0ff',
  border: '1px solid rgba(56,100,200,0.3)', maxWidth: '100%',
};
const overlayChip: React.CSSProperties = {
  fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.65)', color: '#e8f0ff', fontFamily: 'JetBrains Mono, monospace',
};
const panelTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 };
