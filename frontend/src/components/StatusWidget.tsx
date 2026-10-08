'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, api } from '@/lib/api';
import { useSocket } from '@/lib/socket';

type Health = { status: string; version: string; uptimeSec: number; memoryMB: number; storage: { kind: string; durable: boolean } | null; email: { verification: boolean }; llm: { configured: boolean }; sites: { runtimes: any[] } | null; sessionsSurviveRestart: boolean };
type Phase = 'checking' | 'online' | 'degraded' | 'waking' | 'offline' | 'restarting';

const COLORS: Record<Phase, string> = { checking: '#94a3b8', online: '#22c55e', degraded: '#f59e0b', waking: '#f59e0b', offline: '#ef4444', restarting: '#f59e0b' };
const LABEL: Record<Phase, string> = { checking: 'Checking…', online: 'All systems live', degraded: 'Realtime reconnecting', waking: 'Server waking up', offline: 'Server unreachable', restarting: 'Server restarting' };

async function ping(timeoutMs = 8000): Promise<{ ok: boolean; ms: number; body?: Health }> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/api/system/status`, { signal: ctrl.signal, cache: 'no-store' });
    const body = await res.json();
    return { ok: res.ok && body.status === 'ok', ms: Math.round(performance.now() - t0), body };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - t0) };
  } finally { clearTimeout(timer); }
}

const fmtUptime = (s: number) => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

/** Sidebar status pill + popover with reconnect / wake / restart controls. */
export default function StatusWidget({ collapsed = false, realtime = true, placement = 'up' }: { collapsed?: boolean; realtime?: boolean; placement?: 'up' | 'down' }) {
  const sock = useSocket();
  const connected = realtime ? sock.connected : true;
  const { reconnect, lastEventAt, restarting, connectError } = sock;
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const check = useCallback(async () => {
    const r = await ping();
    setServerOk(r.ok);
    setLatency(r.ok ? r.ms : null);
    if (r.body) setHealth(r.body);
    setFailures(f => (r.ok ? 0 : f + 1));
    return r.ok;
  }, []);

  useEffect(() => {
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [check]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (open && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const phase: Phase = action === 'restart' || restarting ? 'restarting'
    : serverOk === null ? 'checking'
    : serverOk && connected ? 'online'
    : serverOk ? 'degraded'
    : failures < 4 ? 'waking' : 'offline';

  const wake = async () => {
    setAction('wake'); setMessage('Pinging the server — a sleeping free-tier instance needs 30–60 s to boot…');
    for (let i = 0; i < 30; i++) {
      if (await check()) { setMessage(`Server is up (${i ? `after ~${i * 4}s` : 'already awake'}). Reconnecting realtime…`); reconnect(); setAction(null); return; }
      await new Promise(r => setTimeout(r, 4000));
    }
    setMessage('Still unreachable after 2 minutes — check the hosting dashboard.');
    setAction(null);
  };

  const restart = async () => {
    if (!window.confirm('Restart the SafeForge server? Everyone is disconnected for a few seconds and in-memory plant state resets.')) return;
    setAction('restart'); setMessage('Requesting restart…');
    try {
      await api('/system/restart', { method: 'POST', json: {} });
    } catch (err: any) {
      setMessage(err.message); setAction(null); return;
    }
    setMessage('Restarting — waiting for the server to come back…');
    await new Promise(r => setTimeout(r, 3000));
    for (let i = 0; i < 40; i++) {
      const r = await ping(6000);
      if (r.ok && r.body && r.body.uptimeSec < 120) {
        setHealth(r.body); setServerOk(true); setLatency(r.ms);
        setMessage('Server restarted. Reconnecting…');
        reconnect(); setAction(null); return;
      }
      await new Promise(r2 => setTimeout(r2, 3000));
    }
    setMessage('The server has not come back yet — try Wake in a moment.');
    setAction(null);
  };

  const doReconnect = async () => {
    setAction('reconnect'); setMessage('Reconnecting realtime channel…');
    await check();
    reconnect();
    setTimeout(() => { setAction(null); setMessage(''); }, 1500);
  };

  const c = COLORS[phase];
  const rt = health?.sites?.runtimes?.length ?? 0;
  const lastEvt = lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`Server status: ${LABEL[phase]}`}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '8px 0' : '8px 10px', borderRadius: 8, background: open ? 'var(--bg-hover)' : 'transparent', border: '1px solid transparent', cursor: 'pointer' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, flexShrink: 0, animation: phase === 'online' ? 'pulse-safe 2s infinite' : phase === 'checking' ? 'none' : 'blink 1.2s step-end infinite' }} />
        {!collapsed && (
          <span style={{ textAlign: 'left', minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: c }}>{LABEL[phase]}</span>
            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>{latency != null ? `${latency} ms · ` : ''}{realtime ? (connected ? 'realtime on' : 'realtime off') : 'API'}</span>
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="System status" style={{ position: 'absolute', ...(placement === 'up' ? { bottom: '110%', left: collapsed ? 8 : 0 } : { top: '115%', right: 0 }), width: 300, zIndex: 3000, padding: 14, borderRadius: 12, background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{LABEL[phase]}</strong>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 11, margin: 0 }}>
            {[
              ['API server', serverOk ? `online · v${health?.version ?? '?'}` : serverOk === null ? 'checking' : 'not responding'],
              ['Latency', latency != null ? `${latency} ms` : '—'],
              ['Uptime', health ? fmtUptime(health.uptimeSec) : '—'],
              ['Realtime', !realtime ? 'opens with a site' : connected ? `connected${lastEvt != null ? ` · last event ${lastEvt}s ago` : ''}` : `disconnected${connectError ? ` (${connectError})` : ''}`],
              ['Plant runtimes', health ? `${rt} active` : '—'],
              ['Memory', health ? `${health.memoryMB} MB` : '—'],
              ['Storage', health?.storage ? `${health.storage.kind}${health.storage.durable ? '' : ' (resets on restart)'}` : '—'],
              ['AI (Gemini)', health ? (health.llm.configured ? 'configured' : 'rule-based fallback') : '—'],
              ['Email verify', health ? (health.email.verification ? 'Brevo on' : 'off') : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                <dd style={{ margin: 0, color: 'var(--text-body)', textAlign: 'right' }}>{v}</dd>
              </div>
            ))}
          </dl>
          {message && <div style={{ marginTop: 10, fontSize: 11, color: 'var(--c-amber)', lineHeight: 1.4 }}>{message}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 12 }}>
            <button disabled={!!action} onClick={doReconnect} style={ctl('#0ea5e9')}>{action === 'reconnect' ? '…' : '⟳ Reconnect'}</button>
            <button disabled={!!action} onClick={wake} style={ctl('#f59e0b')}>{action === 'wake' ? 'Waking…' : '☕ Wake'}</button>
            <button disabled={!!action} onClick={restart} style={ctl('#ef4444')}>{action === 'restart' ? '…' : '↻ Restart'}</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>Free hosting sleeps after ~15 min idle; Wake boots it. Restart asks the server to restart itself — the host brings it back automatically.</div>
        </div>
      )}
    </div>
  );
}

const ctl = (c: string): React.CSSProperties => ({ padding: '7px 4px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: `${c}1f`, border: `1px solid ${c}66`, color: c });
