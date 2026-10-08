'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, useSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';
import { VisionEngine, TemporalConfirmer, WorkerTracker, buildPayload, drawOverlay, type VisionResult, type VisionEvent } from '@/lib/vision';

const SAMPLES = [
  { file: 'no_ppe_street.jpg', label: 'No PPE — workers at an entry gate', kind: 'image' },
  { file: 'ppe_mixed_site.jpg', label: 'Mixed compliance — construction deck', kind: 'image' },
  { file: 'ppe_compliant_crew.jpg', label: 'Compliant crew — helmets & hi-vis', kind: 'image' },
  { file: 'fire_outdoor.webm', label: 'Fire & smoke — recorded footage (video)', kind: 'video' },
  { file: 'smoke_warehouse.jpg', label: 'Smoke plume — warehouse', kind: 'image' },
  { file: 'fire_flame.jpg', label: 'Open flames — close range', kind: 'image' },
] as const;

const EVENT_STYLE: Record<string, { color: string; icon: string; label: string }> = {
  FIRE: { color: '#f97316', icon: '🔥', label: 'Fire' },
  SMOKE: { color: '#a3a3a3', icon: '💨', label: 'Smoke' },
  PPE_VIOLATION: { color: '#ef4444', icon: '⛑️', label: 'PPE violation' },
};

type FeedKey = 'main' | 'pip';
type Source = { kind: 'image' | 'video' | 'webcam'; url?: string; name: string };
type LogItem = { at: string; feed: FeedKey; cam: string; type: string; text: string; sent: boolean };
interface Feed {
  key: FeedKey; source: Source | null; cameraId: string;
  tracker: WorkerTracker; confirmer: TemporalConfirmer | null;
  result: VisionResult | null; lastPublish: number; lastEvidence: Record<string, number>;
  fps: { n: number; t0: number }; stream: MediaStream | null;
}
const newFeed = (key: FeedKey, cameraId: string): Feed => ({ key, source: null, cameraId, tracker: new WorkerTracker(), confirmer: null, result: null, lastPublish: 0, lastEvidence: {}, fps: { n: 0, t0: 0 }, stream: null });

export default function VisionPage() {
  const { permits, connected } = useSocket();
  const { site } = useAuth();
  const cameras: { id: string; label: string; zone: string; sourceType: string; url: string | null }[] = site?.layout.cameras ?? [];
  const zoneName = (z: string) => site?.layout.zones.find((x: any) => x.id === z)?.name ?? z;

  const engineRef = useRef<VisionEngine | null>(null);
  const feeds = useRef<Record<FeedKey, Feed>>({ main: newFeed('main', cameras[0]?.id || 'CAM-01'), pip: newFeed('pip', cameras[cameras.length - 1]?.id || 'CAM-06') });
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef(false);

  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [engineError, setEngineError] = useState('');
  const [provider, setProvider] = useState('');
  const [mainSource, setMainSource] = useState<Source | null>(null);
  const [mainCam, setMainCam] = useState(feeds.current.main.cameraId);
  const [pipOn, setPipOn] = useState(false);
  const [pipCam, setPipCam] = useState(feeds.current.pip.cameraId);
  const [results, setResults] = useState<Record<FeedKey, VisionResult | null>>({ main: null, pip: null });
  const [events, setEvents] = useState<Record<FeedKey, VisionEvent[]>>({ main: [], pip: [] });
  const [fps, setFps] = useState<Record<FeedKey, number>>({ main: 0, pip: 0 });
  const [requirements, setRequirements] = useState<Record<string, any>>({});
  const [log, setLog] = useState<LogItem[]>([]);
  const [sent, setSent] = useState({ ok: 0, failed: 0, lastError: '' });
  const [stream, setStream] = useState(true);

  const labels = (): Record<string, string> => Object.fromEntries(Object.entries(engineRef.current?.manifest?.ppe_items ?? {}).map(([k, v]) => [k, v.label]));
  const camOf = (id: string) => cameras.find(c => c.id === id);
  const reqRef = useRef(requirements); reqRef.current = requirements;
  const streamRef = useRef(stream); streamRef.current = stream;
  const requiredFor = (camId: string): string[] => reqRef.current[camOf(camId)?.zone || '']?.items ?? ['helmet', 'vest'];

  // ── Engine ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const eng = new VisionEngine();
    engineRef.current = eng;
    eng.init((l, t) => setProgress(t ? Math.min(99, Math.round((l / t) * 100)) : 0))
      .then(() => {
        setEngineState('ready');
        setProvider(eng.provider === 'webgpu' ? 'WebGPU' : `WASM × ${eng.threads} thread${eng.threads > 1 ? 's' : ''}`);
        Object.values(feeds.current).forEach(f => { f.confirmer = new TemporalConfirmer(eng.manifest!.temporal); });
      })
      .catch(err => { setEngineState('error'); setEngineError(err.message); });
    return () => {
      loopRef.current = false;
      eng.dispose();
      Object.values(feeds.current).forEach(f => f.stream?.getTracks().forEach(t => t.stop()));
    };
  }, []);

  useEffect(() => { api('/vision/requirements').then(setRequirements).catch(() => {}); }, [permits]);

  // ── Drawing ─────────────────────────────────────────────────────────────
  const mediaFor = (key: FeedKey): HTMLVideoElement | HTMLImageElement | null => {
    if (key === 'pip') return pipVideoRef.current;
    const s = feeds.current.main.source;
    if (!s) return null;
    return s.kind === 'image' ? imgRef.current : videoRef.current;
  };

  useEffect(() => {
    let raf = 0;
    const paint = (key: FeedKey, c: HTMLCanvasElement | null) => {
      const m = mediaFor(key);
      if (!c || !m) return;
      const w = m instanceof HTMLVideoElement ? m.videoWidth : m.naturalWidth;
      const h = m instanceof HTMLVideoElement ? m.videoHeight : m.naturalHeight;
      if (!w || !h) return;
      const cw = c.clientWidth || 640;
      const ch = Math.round(cw * (h / w));
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const ctx = c.getContext('2d')!;
      ctx.drawImage(m, 0, 0, cw, ch);
      const r = feeds.current[key].result;
      if (r) drawOverlay(ctx, r, cw / r.frame.w, ch / r.frame.h, labels());
    };
    const draw = () => {
      paint('main', canvasRef.current);
      if (feeds.current.pip.source) paint('pip', pipCanvasRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Publishing ──────────────────────────────────────────────────────────
  const evidenceFrom = (c: HTMLCanvasElement | null) => {
    if (!c || !c.width) return null;
    const s = Math.min(1, 640 / Math.max(c.width, c.height));
    const t = document.createElement('canvas');
    t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
    t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.72);
  };

  const describe = (e: VisionEvent) => e.type === 'PPE_VIOLATION'
    ? `${e.count} worker(s) missing ${(e.missing || []).map(m => labels()[m] || m).join(', ')}`
    : `${EVENT_STYLE[e.type].label} detected (${Math.round(e.confidence * 100)}%)`;

  const publish = async (f: Feed, r: VisionResult, evs: VisionEvent[], curFps: number, force: boolean) => {
    if (!streamRef.current) return;
    const cam = camOf(f.cameraId);
    if (!cam) return;
    const now = Date.now();
    const fresh = evs.filter(e => now - (f.lastEvidence[e.type] || 0) > 15000);
    if (!force && !fresh.length && now - f.lastPublish < 1000) return;
    f.lastPublish = now;
    let evidence: string | null = null;
    if (fresh.length) {
      evidence = evidenceFrom(f.key === 'main' ? canvasRef.current : pipCanvasRef.current);
      fresh.forEach(e => { f.lastEvidence[e.type] = now; });
    }
    let ok = true;
    try {
      await api('/vision/detections', { method: 'POST', json: { ...buildPayload(cam.id, cam.zone, r, evs, curFps, evidence), source: f.key === 'pip' ? 'browser-webcam' : 'browser' }, timeoutMs: 15000 });
      setSent(s => ({ ...s, ok: s.ok + 1, lastError: '' }));
    } catch (err: any) {
      ok = false;
      setSent(s => ({ ...s, failed: s.failed + 1, lastError: err.message }));
    }
    if (fresh.length) setLog(l => [...fresh.map(e => ({ at: new Date().toLocaleTimeString(), feed: f.key, cam: cam.id, type: e.type, text: describe(e), sent: ok })), ...l].slice(0, 40));
  };

  // ── Inference ───────────────────────────────────────────────────────────
  const analyse = useCallback(async (key: FeedKey, single: boolean) => {
    const eng = engineRef.current, f = feeds.current[key], m = mediaFor(key);
    if (!eng?.manifest || !m || !f.confirmer) return;
    const raw = await eng.detect(m, requiredFor(f.cameraId));
    const r = single ? raw : f.tracker.update(raw);
    f.result = r;
    const evs = f.confirmer.update(r, single);
    f.fps.n++;
    const curFps = single ? 0 : f.fps.n / Math.max(0.001, (performance.now() - f.fps.t0) / 1000);
    setResults(x => ({ ...x, [key]: r }));
    setEvents(x => ({ ...x, [key]: evs }));
    if (!single) setFps(x => ({ ...x, [key]: curFps }));
    publish(f, r, evs, curFps, single);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureLoop = useCallback(() => {
    if (loopRef.current) return;
    loopRef.current = true;
    (async () => {
      let turn = 0;
      while (loopRef.current) {
        const live = (['main', 'pip'] as FeedKey[]).filter(k => {
          const f = feeds.current[k], m = mediaFor(k);
          return f.source && f.source.kind !== 'image' && m instanceof HTMLVideoElement && m.readyState >= 2;
        });
        if (!live.length) { await new Promise(r => setTimeout(r, 200)); if (!Object.values(feeds.current).some(f => f.source && f.source.kind !== 'image')) loopRef.current = false; continue; }
        const key = live[turn++ % live.length];
        try { await analyse(key, false); } catch (err: any) { setEngineError(err.message); }
        await new Promise(r => setTimeout(r, 15));
      }
    })();
  }, [analyse]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetFeed = (f: Feed) => {
    f.tracker.reset(); f.confirmer?.reset(); f.result = null; f.lastEvidence = {}; f.fps = { n: 0, t0: performance.now() };
    setResults(x => ({ ...x, [f.key]: null })); setEvents(x => ({ ...x, [f.key]: [] })); setFps(x => ({ ...x, [f.key]: 0 }));
  };

  const webcamStream = async () => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });

  // Main stage source
  const startMain = async (s: Source | null, camId?: string) => {
    const f = feeds.current.main;
    f.stream?.getTracks().forEach(t => t.stop()); f.stream = null;
    videoRef.current?.pause();
    if (camId) { f.cameraId = camId; setMainCam(camId); }
    resetFeed(f);
    f.source = s;
    setMainSource(s);
    if (!s || engineState !== 'ready') return;
    try {
      if (s.kind === 'image') {
        const img = imgRef.current!;
        img.src = s.url!;
        await img.decode().catch(() => new Promise(r => { img.onload = r; }));
        await analyse('main', true);
      } else {
        const v = videoRef.current!;
        if (s.kind === 'webcam') { f.stream = await webcamStream(); v.srcObject = f.stream; } else { v.srcObject = null; v.src = s.url!; }
        await v.play().catch(() => {});
        ensureLoop();
      }
    } catch (err: any) { setEngineError(err.name === 'NotAllowedError' ? 'Camera permission was denied — allow camera access in the browser.' : err.message); }
  };

  // Corner webcam
  const togglePip = async (on: boolean) => {
    const f = feeds.current.pip;
    if (!on) {
      f.stream?.getTracks().forEach(t => t.stop()); f.stream = null; f.source = null;
      resetFeed(f); setPipOn(false); return;
    }
    try {
      resetFeed(f);
      f.stream = await webcamStream();
      const v = pipVideoRef.current!;
      v.srcObject = f.stream;
      await v.play().catch(() => {});
      f.source = { kind: 'webcam', name: 'Corner webcam' };
      setPipOn(true);
      ensureLoop();
    } catch (err: any) { setEngineError(err.name === 'NotAllowedError' ? 'Camera permission was denied — allow camera access in the browser.' : err.message); }
  };

  const swap = async () => {
    // Move the webcam to the main stage and free the corner
    await togglePip(false);
    await startMain({ kind: 'webcam', name: 'Live webcam' }, pipCam);
  };

  const changeCam = (key: FeedKey, id: string) => {
    const f = feeds.current[key];
    f.cameraId = id;
    f.tracker.reset(); f.confirmer?.reset(); f.lastEvidence = {};
    if (key === 'main') {
      setMainCam(id);
      const c = camOf(id);
      if (c?.sourceType === 'video_url' && c.url) startMain({ kind: 'video', url: c.url, name: `${c.label} stream` });
      else if (c?.sourceType === 'webcam') startMain({ kind: 'webcam', name: `${c.label} (webcam)` });
      else if (f.source?.kind === 'image') analyse('main', true).catch(() => {});
    } else setPipCam(id);
  };

  // Deep link: /vision?camera=CAM-03 selects that camera and starts its own source
  useEffect(() => {
    if (engineState !== 'ready') return;
    const id = new URLSearchParams(window.location.search).get('camera');
    if (id && camOf(id)) changeCam('main', id);
  }, [engineState]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUpload = (file: File) => startMain({ kind: file.type.startsWith('video') ? 'video' : 'image', url: URL.createObjectURL(file), name: file.name });

  // ── UI ──────────────────────────────────────────────────────────────────
  const r = results.main;
  const mainCamera = camOf(mainCam);
  const req = requirements[mainCamera?.zone || ''];
  const required = req?.items ?? [];
  const lb = labels();
  const tile = (label: string, value: string | number, color: string, sub?: string) => (
    <div className="glass-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
  const camSelect = (key: FeedKey, value: string) => (
    <select aria-label={key === 'main' ? 'Main camera' : 'Corner camera'} value={value} onChange={e => changeCam(key, e.target.value)} style={{ ...selectStyle, minWidth: 0, flex: 1 }}>
      {cameras.map(c => <option key={c.id} value={c.id}>{c.id} · {c.label} ({c.zone})</option>)}
    </select>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 1 }}>VISION AI</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>PPE compliance (helmet · vest · footwear · gloves) and fire / smoke detection on {site?.name} — runs on this device, alerts the command center</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="tag-chip" style={{ color: engineState === 'ready' ? 'var(--c-green)' : engineState === 'error' ? 'var(--c-red)' : 'var(--c-amber)' }}>
            {engineState === 'ready' ? `● Models ready · ${provider}` : engineState === 'error' ? '● Model load failed' : `◌ Loading models ${progress}%`}
          </span>
          <span className="tag-chip" style={{ color: connected ? 'var(--c-green)' : 'var(--c-red)' }}>{connected ? '● Command center linked' : '● Command center offline'}</span>
        </div>
      </div>

      {engineState === 'loading' && (
        <div style={{ height: 4, background: 'var(--track)', borderRadius: 2, marginBottom: 14 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width .3s' }} />
        </div>
      )}
      {engineError && <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--c-red)', fontSize: 12 }}>⚠ {engineError} <button onClick={() => setEngineError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button></div>}

      <div className="vision-grid">
        <div>
          <div className="glass-card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select aria-label="Sample footage" value="" disabled={engineState !== 'ready'} style={selectStyle}
                onChange={e => { const s = SAMPLES.find(x => x.file === e.target.value); if (s) startMain({ kind: s.kind, url: `/samples/${s.file}`, name: s.label }); }}>
                <option value="">▶ Sample footage…</option>
                {SAMPLES.map(s => <option key={s.file} value={s.file}>{s.label}</option>)}
              </select>
              <label style={{ ...btnStyle, opacity: engineState === 'ready' ? 1 : 0.5 }}>
                ⬆ Upload image / video
                <input type="file" accept="image/*,video/*" hidden disabled={engineState !== 'ready'} onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
              </label>
              <button style={btnStyle} disabled={engineState !== 'ready'} onClick={() => startMain({ kind: 'webcam', name: 'Live webcam' })}>📷 Webcam on main</button>
              <button style={{ ...btnStyle, ...(pipOn ? { background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.5)', color: 'var(--c-green)' } : {}) }} disabled={engineState !== 'ready'} onClick={() => togglePip(!pipOn)}>
                {pipOn ? '◉ Corner webcam on' : '◎ Corner webcam'}
              </button>
              {mainSource && mainSource.kind !== 'image' && <button style={{ ...btnStyle, color: 'var(--c-red)' }} onClick={() => startMain(null)}>■ Stop main</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Main camera</span>
              {camSelect('main', mainCam)}
              <Link href="/site" style={{ fontSize: 11, color: 'var(--c-cyan)' }}>Manage cameras</Link>
            </div>

            <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', minHeight: 360 }}>
              <canvas ref={canvasRef} style={{ width: '100%', display: mainSource ? 'block' : 'none' }} />
              {!mainSource && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#94a3b8', textAlign: 'center', padding: 24 }}>
                  <div style={{ fontSize: 40 }}>🎥</div>
                  <div style={{ fontSize: 14, color: '#e2e8f0' }}>Choose sample footage, upload a CCTV clip / photo, start a webcam, or pick a camera with a video URL</div>
                  <div style={{ fontSize: 12 }}>Tip: turn on the <strong>corner webcam</strong> to test live detection on yourself while footage plays — each feed reports as its own camera.</div>
                </div>
              )}
              {mainSource && (
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 16px)' }}>
                  <span style={overlayChip}>{mainCamera?.id} · {mainCamera?.label} · {mainCamera?.zone}</span>
                  <span style={overlayChip}>{mainSource.name}</span>
                  {r && <span style={overlayChip}>{r.inference_ms.toFixed(0)} ms{fps.main ? ` · ${fps.main.toFixed(1)} fps` : ''}</span>}
                </div>
              )}
              {events.main.some(e => e.type === 'FIRE') && <div className="emergency-mode" style={{ position: 'absolute', inset: 0, border: '3px solid #f97316', pointerEvents: 'none' }} />}

              {/* Corner webcam */}
              <div style={{ position: 'absolute', right: 10, bottom: 10, width: 'min(34%, 260px)', display: pipOn ? 'block' : 'none', borderRadius: 8, overflow: 'hidden', border: `2px solid ${events.pip.length ? '#ef4444' : 'rgba(255,255,255,0.6)'}`, boxShadow: '0 6px 24px rgba(0,0,0,0.5)', background: '#000' }}>
                <canvas ref={pipCanvasRef} style={{ width: '100%', display: 'block' }} />
                <div style={{ position: 'absolute', top: 4, left: 4, right: 4, display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ ...overlayChip, fontSize: 9 }}>● LIVE {pipCam}</span>
                  <button onClick={swap} title="Move webcam to the main stage" style={{ ...overlayChip, fontSize: 9, cursor: 'pointer', border: 'none' }}>⤢</button>
                </div>
                <div style={{ position: 'absolute', bottom: 4, left: 4, ...overlayChip, fontSize: 9 }}>
                  {results.pip ? `${results.pip.worker_count} worker · ${results.pip.ppe_violations} viol.${results.pip.fire_detected ? ' · FIRE' : ''}` : 'warming up…'}
                </div>
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} alt="" style={{ display: 'none' }} crossOrigin="anonymous" />
              <video ref={videoRef} style={{ display: 'none' }} muted playsInline loop crossOrigin="anonymous" />
              <video ref={pipVideoRef} style={{ display: 'none' }} muted playsInline />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>Required PPE in {mainCamera?.zone} ({zoneName(mainCamera?.zone || '')}):</span>
              {required.length ? required.map((i: string) => (
                <span key={i} className="tag-chip" style={req?.permitDriven?.includes(i) ? { color: 'var(--c-amber)', borderColor: 'rgba(255,179,0,0.4)' } : undefined}>
                  {lb[i] || i}{req?.permitDriven?.includes(i) ? ' · permit' : ''}
                </span>
              )) : <span className="tag-chip">None (safe zone)</span>}
              {pipOn && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 220, flex: '1 1 220px' }}>Corner webcam reports as {camSelect('pip', pipCam)}</span>
              )}
              <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={stream} onChange={e => setStream(e.target.checked)} /> Stream to command center
              </label>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 14, marginTop: 14, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>How detection stays reliable.</strong> Two YOLOv8 models run in a Web Worker ({provider || 'WebGPU/WASM'}).
            In live video every worker is <em>tracked</em> across frames (stable IDs, eased boxes) and each PPE item is voted over the last 8 frames —
            a worker turns <span style={{ color: '#f59e0b' }}>amber</span> while the system is checking and <span style={{ color: '#ef4444' }}>red</span> only after the item is seen missing in ≥3 frames.
            Fire needs 2 of 5 frames, smoke and PPE alerts 3 of 5. RTSP cameras use the same engine through the Python edge agent.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {tile('Workers', r?.worker_count ?? '—', 'var(--c-cyan)')}
            {tile('PPE violations', r ? r.ppe_violations : '—', r?.ppe_violations ? '#ef4444' : 'var(--c-green)', r?.worker_count ? `${Math.round((r.compliant_workers / r.worker_count) * 100)}% compliant` : undefined)}
            {tile('Fire', r ? (r.fire_detected ? 'YES' : 'no') : '—', r?.fire_detected ? '#f97316' : 'var(--c-green)', r?.fire_detected ? `${Math.round(r.fire_confidence * 100)}% conf.` : undefined)}
            {tile('Smoke', r ? (r.smoke_detected ? 'YES' : 'no') : '—', r?.smoke_detected ? '#9ca3af' : 'var(--c-green)', r?.smoke_detected ? `${Math.round(r.smoke_confidence * 100)}% conf.` : undefined)}
          </div>

          <div className="glass-card" style={{ padding: 14 }}>
            <div style={panelTitle}>Confirmed events</div>
            {!events.main.length && !events.pip.length && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No confirmed hazards right now.</div>}
            {(['main', 'pip'] as FeedKey[]).flatMap(k => events[k].map(e => (
              <div key={k + e.type} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, marginBottom: 6, background: `${EVENT_STYLE[e.type].color}18`, border: `1px solid ${EVENT_STYLE[e.type].color}55` }}>
                <span>{EVENT_STYLE[e.type].icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{k === 'pip' ? `[${pipCam} webcam] ` : ''}{describe(e)}</span>
              </div>
            )))}
          </div>

          <div className="glass-card" style={{ padding: 14 }}>
            <div style={panelTitle}>Workers in view {pipOn && results.pip ? `· webcam ${results.pip.worker_count}` : ''}</div>
            {!r?.workers.length && !results.pip?.workers.length && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No workers detected.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {(['main', 'pip'] as FeedKey[]).flatMap(k => (results[k]?.workers ?? []).map(w => (
                <div key={k + w.id} style={{ padding: 8, borderRadius: 6, background: !w.compliant ? 'rgba(239,68,68,0.09)' : w.pending ? 'rgba(245,158,11,0.09)' : 'rgba(34,197,94,0.07)', border: `1px solid ${!w.compliant ? 'rgba(239,68,68,0.35)' : w.pending ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.25)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, fontWeight: 700, color: !w.compliant ? 'var(--c-red)' : w.pending ? 'var(--c-amber)' : 'var(--c-green)' }}>
                    <span>{k === 'pip' ? '📷 ' : ''}{w.id}{w.frames ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {w.frames}f</span> : null}</span>
                    <span>{!w.compliant ? `Missing: ${w.missing.map(m => lb[m] || m).join(', ')}` : w.pending ? 'Checking…' : 'Compliant'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {Object.entries(w.ppe).filter(([, s]) => s !== 'unknown').map(([item, s]) => (
                      <span key={item} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: s === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.18)', color: s === 'ok' ? 'var(--c-green)' : 'var(--c-red)' }}>
                        {s === 'ok' ? '✓' : '✗'} {lb[item] || item}{(results[k]?.required_ppe || []).includes(item) ? '' : ' (opt.)'}
                      </span>
                    ))}
                  </div>
                </div>
              )))}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ ...panelTitle, display: 'flex', justifyContent: 'space-between' }}>
              <span>Sent to command center</span>
              <Link href="/alerts" style={{ color: 'var(--c-cyan)', textDecoration: 'none', textTransform: 'none', letterSpacing: 0 }}>Open alerts →</Link>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{sent.ok} payloads delivered{sent.failed ? ` · ${sent.failed} failed${sent.lastError ? ` (${sent.lastError})` : ''}` : ''}</div>
            {log.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Alerts raised from these feeds appear here.</div>}
            {log.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{l.at}</span>
                <span>{EVENT_STYLE[l.type]?.icon}</span>
                <span style={{ color: 'var(--text-body)', flex: 1 }}>{l.cam}: {l.text}</span>
                <span style={{ color: l.sent ? 'var(--c-green)' : 'var(--c-red)' }}>{l.sent ? '✓' : '✗'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(0,176,255,0.1)', border: '1px solid rgba(0,176,255,0.3)', color: 'var(--c-cyan)' };
const selectStyle: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', maxWidth: '100%' };
const overlayChip: React.CSSProperties = { fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.65)', color: '#e8f0ff', fontFamily: 'JetBrains Mono, monospace' };
const panelTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 };
