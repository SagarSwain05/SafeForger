'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useSocket, type Alert } from '@/lib/socket';

const CAMERAS = [
  { id: 'CAM-01', label: 'CDU Main Gate', zone: 'Z-01' },
  { id: 'CAM-02', label: 'Tank Farm Perimeter', zone: 'Z-03' },
  { id: 'CAM-03', label: 'Pump Station Entry', zone: 'Z-07' },
  { id: 'CAM-04', label: 'Confined Space CS-01', zone: 'Z-11' },
  { id: 'CAM-05', label: 'Loading Bay', zone: 'Z-13' },
  { id: 'CAM-06', label: 'Control Room Entry', zone: 'Z-05' },
];

export default function CameraWall() {
  const { cvDetections, alerts } = useSocket();
  const [frames, setFrames] = useState<Record<string, { src: string; alert: Alert }>>({});
  const [requirements, setRequirements] = useState<Record<string, any>>({});
  const [, tick] = useState(0);

  useEffect(() => { api('/vision/requirements').then(setRequirements).catch(() => {}); }, []);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 3000); return () => clearInterval(t); }, []);

  // Latest evidence frame per camera (fetched on demand — alert lists omit images)
  useEffect(() => {
    CAMERAS.forEach(cam => {
      const a = alerts.find(x => x.cameraId === cam.id && x.hasEvidence);
      if (!a) return;
      const key = `${a.id}:${a.evidenceAt}`;
      if (frames[cam.id] && `${frames[cam.id].alert.id}:${frames[cam.id].alert.evidenceAt}` === key) return;
      if (a.evidence) { setFrames(f => ({ ...f, [cam.id]: { src: a.evidence!, alert: a } })); return; }
      api<Alert>(`/alerts/${a.id}`).then(full => full.evidence && setFrames(f => ({ ...f, [cam.id]: { src: full.evidence!, alert: a } }))).catch(() => {});
    });
  }, [alerts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 24, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>CAMERA WALL</h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Live AI status of every plant camera — fed by browser and Python edge agents. Tiles show the latest evidence frame.</div>
        </div>
        <Link href="/vision" style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(0,176,255,0.12)', border: '1px solid rgba(0,176,255,0.4)', color: '#7dd3fc', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>🎯 Stream a camera</Link>
      </div>

      <div className="cam-grid">
        {CAMERAS.map(cam => {
          const d = cvDetections[cam.zone];
          const live = d && d.camera_id === cam.id;
          const status = !live ? { t: 'NO FEED', c: '#4a6080' } : d.fire_detected ? { t: '🔥 FIRE', c: '#f97316' } : d.smoke_detected ? { t: '💨 SMOKE', c: '#a3a3a3' } : d.ppe_violations ? { t: `⛑️ ${d.ppe_violations} PPE`, c: '#ef4444' } : { t: '✓ CLEAR', c: '#22c55e' };
          const frame = frames[cam.id];
          const req = requirements[cam.zone]?.items ?? [];
          return (
            <div key={cam.id} className="glass-card" style={{ overflow: 'hidden', borderColor: live ? `${status.c}66` : undefined }}>
              <div className="cctv-feed" style={{ aspectRatio: '16 / 9', borderRadius: 0 }}>
                {frame ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frame.src} alt={`Latest evidence from ${cam.id}`} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: live ? 1 : 0.55 }} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 12, background: 'repeating-linear-gradient(45deg, #070b16, #070b16 10px, #0a1020 10px, #0a1020 20px)' }}>
                    {live ? 'Streaming — no events yet' : 'No feed connected'}
                  </div>
                )}
                {live && <div className="cctv-recording" />}
                <div className="cctv-timestamp">{cam.id} · {cam.zone}</div>
                <div style={{ position: 'absolute', bottom: 8, right: 8, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.7)', color: status.c, fontSize: 11, fontWeight: 800 }}>{status.t}</div>
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e8f0ff' }}>{cam.label}</span>
                  <span style={{ fontSize: 11, color: '#8ba0c4' }}>{live ? `${d.source} · ${d.fps ? d.fps + ' fps' : 'still'}` : 'offline'}</span>
                </div>
                <div style={{ fontSize: 11, color: '#8ba0c4', marginTop: 4 }}>
                  {live ? `${d.worker_count} worker(s) · ${d.ppe_compliance_pct ?? 100}% PPE compliant` : 'Assign a source on Vision AI or run the edge agent'}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {req.length ? req.map((i: string) => <span key={i} className="tag-chip" style={{ fontSize: 10 }}>{i}</span>) : <span className="tag-chip" style={{ fontSize: 10 }}>no PPE required</span>}
                </div>
                {frame && <Link href={`/alerts?id=${frame.alert.id}`} style={{ display: 'block', fontSize: 11, color: '#00b0ff', marginTop: 8, textDecoration: 'none' }}>Last event: {frame.alert.title} →</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
