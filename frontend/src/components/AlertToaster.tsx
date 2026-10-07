'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSocket, type Alert } from '@/lib/socket';

const SEV_COLOR: Record<string, string> = { CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffb300', LOW: '#448aff' };
const ICON: Record<string, string> = { FIRE: '🔥', SMOKE: '💨', PPE_VIOLATION: '⛑️', COMPOUND_RISK: '🧠', SENSOR: '📟', EMERGENCY: '🚨' };

/** Pops a toast for every new HIGH/CRITICAL alert (with a short tone for CRITICAL), and shows backend status. */
export default function AlertToaster() {
  const { latestAlert, connected, everConnected } = useSocket();
  const [toasts, setToasts] = useState<Alert[]>([]);
  const [slow, setSlow] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!latestAlert || !['CRITICAL', 'HIGH'].includes(latestAlert.severity)) return;
    setToasts(t => [latestAlert, ...t.filter(x => x.id !== latestAlert.id)].slice(0, 3));
    const id = latestAlert.id;
    const timer = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 12000);
    if (latestAlert.severity === 'CRITICAL') {
      try {
        audioRef.current = audioRef.current || new AudioContext();
        const ctx = audioRef.current;
        [0, 0.25].forEach(offset => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = 880; g.gain.value = 0.05;
          o.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime + offset); o.stop(ctx.currentTime + offset + 0.15);
        });
      } catch { /* audio blocked until user interaction */ }
    }
    return () => clearTimeout(timer);
  }, [latestAlert]);

  // Free-tier hosting sleeps when idle; tell the user instead of showing an empty dashboard
  useEffect(() => {
    if (connected) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [connected]);

  return (
    <>
      {slow && (
        <div role="status" style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 2000, padding: '8px 16px', borderRadius: 8, background: 'rgba(255,179,0,0.12)', border: '1px solid rgba(255,179,0,0.4)', color: '#ffd166', fontSize: 12, backdropFilter: 'blur(8px)', maxWidth: '92vw', textAlign: 'center' }}>
          {everConnected ? '⟳ Connection lost — reconnecting to the SafeForge backend…' : '⟳ Waking the SafeForge backend (free hosting tier — first load can take up to a minute)…'}
        </div>
      )}
      <div aria-live="assertive" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 10, width: 360, maxWidth: 'calc(100vw - 32px)' }}>
        {toasts.map(a => (
          <div key={a.id} className="fade-in-up" style={{ padding: 12, borderRadius: 10, background: 'rgba(8,12,28,0.96)', border: `1px solid ${SEV_COLOR[a.severity]}88`, borderLeft: `4px solid ${SEV_COLOR[a.severity]}`, boxShadow: `0 8px 30px ${SEV_COLOR[a.severity]}33` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#e8f0ff' }}>{ICON[a.type] || '⚠'} {a.title}</span>
              <button aria-label="Dismiss" onClick={() => setToasts(t => t.filter(x => x.id !== a.id))} style={{ background: 'none', border: 'none', color: '#8ba0c4', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#c7d2fe', marginTop: 4, lineHeight: 1.45 }}>{a.message.slice(0, 180)}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
              <span style={{ color: SEV_COLOR[a.severity], fontWeight: 700 }}>{a.severity} · {a.recipients.length} people notified</span>
              <Link href={`/alerts?id=${a.id}`} style={{ color: '#00b0ff', textDecoration: 'none' }}>Open →</Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
