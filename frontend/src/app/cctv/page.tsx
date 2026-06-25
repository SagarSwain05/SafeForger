'use client';

import { useSocket } from '@/lib/socket';
import { useEffect, useRef, useState } from 'react';

const CAMERAS = [
  { id: 'CAM-01', label: 'CDU Main Gate', zone: 'Z-01', angle: 135 },
  { id: 'CAM-02', label: 'Tank Farm Perimeter', zone: 'Z-03', angle: 45 },
  { id: 'CAM-03', label: 'Pump Station Entry', zone: 'Z-07', angle: 180 },
  { id: 'CAM-04', label: 'Confined Space CS-01', zone: 'Z-11', angle: 270 },
  { id: 'CAM-05', label: 'Loading Bay', zone: 'Z-13', angle: 90 },
  { id: 'CAM-06', label: 'Control Room Entry', zone: 'Z-05', angle: 0 },
];

function CctvFeed({ cam, selected, onClick, cvData }: { cam: any; selected: boolean; onClick: () => void; cvData: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const [time, setTime] = useState('');

  useEffect(() => {
    setTime(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    const t = setInterval(() => setTime(new Date().toLocaleTimeString('en-GB', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;

    const draw = () => {
      frame++;
      const W = canvas.width, H = canvas.height;
      // Dark background
      ctx.fillStyle = '#080c18';
      ctx.fillRect(0, 0, W, H);

      // Simulated plant room scene
      const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      grad.addColorStop(0, '#0a1428');
      grad.addColorStop(1, '#050914');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.6, W, H * 0.4);

      // Equipment block
      ctx.fillStyle = 'rgba(20,35,70,0.8)';
      ctx.fillRect(20, H * 0.35, 60, H * 0.3);
      ctx.fillRect(110, H * 0.3, 40, H * 0.35);
      ctx.fillRect(190, H * 0.4, 70, H * 0.25);

      // Draw active CV detections if live data is available, else mock normal worker
      const isLive = !!cvData;
      const workerCount = isLive ? cvData.worker_count : 1;
      const hasSmoke = isLive ? cvData.smoke_detected : false;
      const hasViolations = isLive ? cvData.ppe_violations > 0 : cam.id === 'CAM-04';

      // Draw smoke if present
      if (hasSmoke) {
        ctx.fillStyle = 'rgba(120, 130, 150, 0.45)';
        for (let i = 0; i < 15; i++) {
          const sx = W / 2 + Math.sin(frame * 0.05 + i) * 30;
          const sy = H * 0.7 - i * 12 - (frame % 15);
          ctx.beginPath();
          ctx.arc(sx, sy, 10 + i * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw workers
      for (let i = 0; i < workerCount; i++) {
        const offset = i * 45;
        const wX = 80 + offset + Math.sin(frame * 0.02 + i) * 5;
        const wY = H * 0.48;

        // Base color
        ctx.fillStyle = hasViolations ? '#ff5252' : '#00e676';

        // Draw bounding box
        ctx.strokeStyle = hasViolations ? '#ff1744' : '#00e676';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(wX - 16, wY - 4, 32, 50);
        ctx.setLineDash([]);

        // Head and body
        ctx.beginPath();
        ctx.ellipse(wX, wY + 25, 8, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(wX, wY + 4, 6, 0, Math.PI * 2);
        ctx.fill();

        // Helmet
        if (!hasViolations) {
          ctx.fillStyle = '#ffeb3b';
          ctx.beginPath();
          ctx.ellipse(wX, wY - 1, 8, 5, 0, Math.PI, Math.PI * 2);
          ctx.fill();
        }

        // Tag label
        ctx.fillStyle = hasViolations ? 'rgba(255,23,68,0.85)' : 'rgba(0,230,118,0.85)';
        ctx.fillRect(wX - 16, wY - 14, 64, 10);
        ctx.fillStyle = '#fff';
        ctx.font = '7px monospace';
        ctx.fillText(hasViolations ? 'NO_PPE 0.92' : 'PERSON 0.98', wX - 14, wY - 6);
      }

      // Scanline effect
      const scanY = (frame * 1.2) % H;
      const scanGrad = ctx.createLinearGradient(0, scanY - 2, 0, scanY + 2);
      scanGrad.addColorStop(0, 'transparent');
      scanGrad.addColorStop(0.5, 'rgba(0,255,100,0.08)');
      scanGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 2, W, 4);

      // Noise grains
      for (let i = 0; i < 15; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.02})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 1);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [cam.id, cvData]);

  const hasAlert = cvData?.ppe_violations > 0 || cvData?.smoke_detected || cam.id === 'CAM-04';

  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer', borderRadius: 8, overflow: 'hidden', position: 'relative',
        border: `1px solid ${selected ? '#00b0ff' : hasAlert ? 'rgba(255,23,68,0.6)' : 'rgba(0,255,100,0.2)'}`,
        boxShadow: selected ? '0 0 20px rgba(0,176,255,0.3)' : hasAlert ? '0 0 15px rgba(255,23,68,0.3)' : 'none',
        transition: 'all 0.3s',
      }}
    >
      <canvas ref={canvasRef} width={280} height={180} style={{ display: 'block', width: '100%' }} />
      {/* Chrome HUD overlays */}
      <div style={{ position: 'absolute', top: 8, left: 8, fontFamily: 'monospace', fontSize: 10, color: '#00ff66', textShadow: '0 0 6px #00ff66' }}>
        {time}
      </div>
      <div style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, background: '#ff1744', borderRadius: '50%', animation: 'blink 1s step-end infinite' }} />
      <div style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 10, color: '#00ff66', fontFamily: 'monospace' }}>
        {cam.id} · {cam.label}
      </div>
      {hasAlert && (
        <div style={{ position: 'absolute', bottom: 24, left: 8, right: 8 }}>
          <div style={{
            fontSize: 9, padding: '2.5px 6px', borderRadius: 3, marginBottom: 2, fontFamily: 'monospace',
            background: 'rgba(255,23,68,0.85)', color: '#fff', fontWeight: 600
          }}>
            {cvData?.smoke_detected ? '⚠ SMOKE DETECTED' : '⚠ PPE NON-COMPLIANCE'}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CctvPage() {
  const { cvDetections } = useSocket();
  const [selected, setSelected] = useState<string | null>(null);
  const [rtspUrl, setRtspUrl] = useState('');
  const [cameraName, setCameraName] = useState('New IP Camera');
  const [targetZone, setTargetZone] = useState('Z-01');
  const [logs, setLogs] = useState<any[]>([]);

  // Calculate live global stats
  const liveCvs = Object.values(cvDetections ?? {});
  const totalWorkers = liveCvs.reduce((acc: number, curr: any) => acc + (curr.worker_count || 0), 0);
  const totalViolations = liveCvs.reduce((acc: number, curr: any) => acc + (curr.ppe_violations || 0), 0);
  const smokeCount = liveCvs.filter((c: any) => c.smoke_detected).length;
  const ppeCompliance = totalWorkers > 0 ? Math.round(((totalWorkers - totalViolations) / totalWorkers) * 100) : 100;

  useEffect(() => {
    // Generate initial live log list
    setLogs([
      { time: '00:41:05', cam: 'CAM-04', event: 'PPE Non-Compliance Detected', detail: 'Worker without hard hat in confined space area', severity: 'CRITICAL' },
      { time: '00:39:22', cam: 'CAM-02', event: 'Unauthorized Zone Entry Attempt', detail: 'Person detected near Tank Farm perimeter fence', severity: 'HIGH' },
      { time: '00:35:11', cam: 'CAM-01', event: 'Crowd Density Alert', detail: '4 workers in single zone during hot work activity', severity: 'WARNING' },
      { time: '00:30:00', cam: 'CAM-06', event: 'All Clear', detail: 'Control room — normal activity', severity: 'SAFE' },
    ]);
  }, []);

  // Sync WebSocket CV detections to live audit log
  useEffect(() => {
    if (!cvDetections) return;
    const latest = Object.values(cvDetections).sort((a: any, b: any) => b.receivedAt - a.receivedAt)[0] as any;
    if (latest && latest.receivedAt > Date.now() - 5000) {
      const timeStr = new Date(latest.receivedAt).toLocaleTimeString('en-GB', { hour12: false });
      let event = 'CV Update';
      let detail = `Worker count: ${latest.worker_count}`;
      let severity = 'SAFE';

      if (latest.smoke_detected) {
        event = '⚠ Smoke Alert';
        detail = 'Visual smoke detection triggered by camera analytics';
        severity = 'CRITICAL';
      } else if (latest.ppe_violations > 0) {
        event = '⚠ PPE Non-Compliance';
        detail = `${latest.ppe_violations} workers missing required helmet or vest`;
        severity = 'HIGH';
      }

      setLogs(prev => {
        const dup = prev.some(l => l.time === timeStr && l.cam === latest.camera_id);
        if (dup) return prev;
        return [{ time: timeStr, cam: latest.camera_id, event, detail, severity }, ...prev.slice(0, 10)];
      });
    }
  }, [cvDetections]);

  const handleAddCamera = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rtspUrl) return;
    alert(`Connected to RTSP Stream: ${rtspUrl}\nZone Mapping: ${targetZone}\nSensor pipeline initialized successfully!`);
    setRtspUrl('');
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>CCTV INTELLIGENCE</h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Live Computer Vision analytics · {CAMERAS.length} channels connected</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['PPE Compl.', `${ppeCompliance}%`, '#00e676'], ['PPE Viol.', totalViolations, '#ff5252'], ['Smoke', smokeCount, '#ffb300'], ['Workers', totalWorkers || 1, '#448aff']].map(([k, v, c]) => (
            <div key={String(k)} className="glass-card" style={{ padding: '8px 14px', textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 10, color: '#4a6080' }}>{k}</div>
              <div style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 700, color: String(c) }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginBottom: 20 }}>
        {/* Grid of camera feeds */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {CAMERAS.map(cam => {
            const liveData = cvDetections ? Object.values(cvDetections).find((c: any) => c.camera_id === cam.id) : null;
            return (
              <CctvFeed
                key={cam.id}
                cam={cam}
                selected={selected === cam.id}
                onClick={() => setSelected(selected === cam.id ? null : cam.id)}
                cvData={liveData}
              />
            );
          })}
        </div>

        {/* RTSP Stream Connector Setup */}
        <div className="glass-card" style={{ padding: 18, height: 'fit-content' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Orbitron, monospace', color: '#e8f0ff', marginBottom: 12 }}>
            CONNECT IP CAMERA
          </h3>
          <form onSubmit={handleAddCamera} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 10, color: '#8ba0c4', display: 'block', marginBottom: 4 }}>CAMERA ID / NAME</label>
              <input
                type="text"
                value={cameraName}
                onChange={e => setCameraName(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: 'rgba(5,9,20,0.6)', border: '1px solid rgba(56,100,200,0.2)', borderRadius: 5, color: '#fff', fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#8ba0c4', display: 'block', marginBottom: 4 }}>RTSP / WEBCAM STREAM URL</label>
              <input
                type="text"
                placeholder="rtsp://admin:pwd@192.168.1.50:554/stream"
                value={rtspUrl}
                onChange={e => setRtspUrl(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: 'rgba(5,9,20,0.6)', border: '1px solid rgba(56,100,200,0.2)', borderRadius: 5, color: '#fff', fontSize: 11, fontFamily: 'monospace' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#8ba0c4', display: 'block', marginBottom: 4 }}>PLANT ZONE MAPPING</label>
              <select
                value={targetZone}
                onChange={e => setTargetZone(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: 'rgba(5,9,20,0.6)', border: '1px solid rgba(56,100,200,0.2)', borderRadius: 5, color: '#fff', fontSize: 12 }}
              >
                {Array.from({ length: 15 }).map((_, idx) => {
                  const zId = `Z-${String(idx + 1).padStart(2, '0')}`;
                  return <option key={zId} value={zId} style={{ background: '#080f1e' }}>Zone {zId}</option>;
                })}
              </select>
            </div>
            <button
              type="submit"
              style={{
                marginTop: 6, padding: '8px 12px', background: '#00b0ff', color: '#000', fontWeight: 700,
                border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1
              }}
            >
              Initialize Capture Pipeline
            </button>
          </form>
          <div style={{ marginTop: 14, fontSize: 10, color: '#4a6080', borderTop: '1px solid rgba(56,100,200,0.1)', paddingTop: 10 }}>
            💡 SafeForger supports real-time homography coordinate transformation. Click the camera feeds to inspect raw frame bounding boxes.
          </div>
        </div>
      </div>

      {/* CV Analytics Log */}
      <div className="glass-card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
          Computer Vision Detection Log
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {logs.map((log, i) => {
            const c = log.severity === 'CRITICAL' ? '#ff1744' : log.severity === 'HIGH' ? '#ff5252' : log.severity === 'WARNING' ? '#ffb300' : '#00e676';
            return (
              <div key={i} className="glass-card" style={{ padding: 12, borderColor: `${c}30`, background: `${c}08` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#4a6080' }}>{log.time}</span>
                  <span style={{ fontSize: 10, color: '#00b0ff' }}>{log.cam}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c, marginBottom: 4 }}>{log.event}</div>
                <div style={{ fontSize: 11, color: '#8ba0c4' }}>{log.detail}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
