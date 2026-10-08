'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, useSocket } from '@/lib/socket';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } };
// Silence/mute survive page reloads within the browser session
const sread = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const swrite = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } };

/** Two-tone industrial wail built with WebAudio (no audio files to load). */
class Siren {
  ctx: AudioContext | null = null;
  osc: OscillatorNode | null = null;
  gain: GainNode | null = null;
  timer: ReturnType<typeof setInterval> | null = null;

  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  get blocked() { return !this.ctx || this.ctx.state !== 'running'; }

  start(volume = 0.18) {
    const ctx = this.ensure();
    if (this.osc) return;
    this.osc = ctx.createOscillator();
    this.gain = ctx.createGain();
    this.osc.type = 'sawtooth';
    this.gain.gain.value = volume;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2200;
    this.osc.connect(filter); filter.connect(this.gain); this.gain.connect(ctx.destination);
    this.osc.start();
    const sweep = () => {
      if (!this.osc || !this.ctx) return;
      const t = this.ctx.currentTime;
      this.osc.frequency.cancelScheduledValues(t);
      this.osc.frequency.setValueAtTime(620, t);
      this.osc.frequency.linearRampToValueAtTime(1180, t + 0.55);
      this.osc.frequency.linearRampToValueAtTime(620, t + 1.1);
    };
    sweep();
    this.timer = setInterval(sweep, 1100);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.osc?.stop(); } catch { /* already stopped */ }
    this.osc?.disconnect(); this.gain?.disconnect();
    this.osc = null; this.gain = null;
  }
}

export default function SirenController() {
  const { emergencyState, alerts } = useSocket();
  const sirenRef = useRef<Siren | null>(null);
  const [armed, setArmed] = useState(true);
  const [mutedUntil, setMutedUntil] = useState(0);
  const [silencedEmergency, setSilencedEmergency] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    setArmed(read('sf_siren') !== 'off');
    setMutedUntil(Number(sread('sf_siren_muted_until')) || 0);
    setSilencedEmergency(sread('sf_siren_silenced'));
    sirenRef.current = new Siren();
    // Browsers only allow audio after a user gesture — unlock on the first click/keypress
    const unlock = () => { sirenRef.current?.ensure(); setNeedsGesture(false); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const onArm = (e: Event) => setArmed((e as CustomEvent).detail !== 'off');
    window.addEventListener('sf-siren', onArm);
    const t = setInterval(() => tick(x => x + 1), 5000);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('sf-siren', onArm); clearInterval(t); sirenRef.current?.stop(); };
  }, []);

  const criticalOpen = useMemo(() => alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'OPEN' && a.active), [alerts]);
  const emergencyActive = !!emergencyState?.active && silencedEmergency !== emergencyState?.triggeredAt;
  const alarm = emergencyActive || criticalOpen.length > 0;
  const muted = Date.now() < mutedUntil;
  const showOverlay = alarm && !muted;

  useEffect(() => {
    const s = sirenRef.current;
    if (!s) return;
    if (showOverlay && armed) {
      s.start();
      setNeedsGesture(s.blocked);
    } else {
      s.stop();
    }
  }, [showOverlay, armed]);

  const acknowledge = useCallback(async () => {
    setBusy(true);
    try {
      if (criticalOpen.length) await api('/alerts/ack-critical', { method: 'POST', json: {} });
      if (emergencyState?.active) { setSilencedEmergency(emergencyState.triggeredAt); swrite('sf_siren_silenced', emergencyState.triggeredAt); }
    } catch { /* still silence locally */ }
    setBusy(false);
  }, [criticalOpen.length, emergencyState]);

  const mute = (minutes: number) => { const until = Date.now() + minutes * 60000; setMutedUntil(until); swrite('sf_siren_muted_until', String(until)); };

  if (!showOverlay) {
    // Persistent strobe border while an emergency is active, even when silenced
    return emergencyState?.active ? <div aria-hidden className="emergency-strobe" /> : null;
  }

  const headline = emergencyActive
    ? `EMERGENCY ${emergencyState.level}${emergencyState.auto ? ' — DECLARED AUTOMATICALLY' : ''}`
    : `CRITICAL ALERT${criticalOpen.length > 1 ? `S (${criticalOpen.length})` : ''}`;
  const detail = emergencyActive ? emergencyState.triggeredBy : criticalOpen[0]?.title;
  const where = emergencyActive ? (emergencyState.affectedZones || []).join(', ') : (criticalOpen[0]?.zoneName ? `${criticalOpen[0].zoneName} (${criticalOpen[0].zone})` : '');

  return (
    <div role="alertdialog" aria-modal="true" aria-label={headline} className="siren-overlay">
      <div className="siren-panel">
        <div style={{ fontSize: 46, lineHeight: 1 }} aria-hidden>🚨</div>
        <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 900, fontSize: 22, letterSpacing: 2, color: '#fff', marginTop: 10 }}>{headline}</div>
        {detail && <div style={{ fontSize: 15, color: '#ffe4e6', marginTop: 10, lineHeight: 1.45 }}>{detail}</div>}
        {where && <div style={{ fontSize: 13, color: '#fecdd3', marginTop: 6 }}>📍 {where}</div>}
        {emergencyActive && <div style={{ fontSize: 12, color: '#fecdd3', marginTop: 6 }}>Evacuate affected zones to the Emergency Assembly area (Z-15).</div>}
        {needsGesture && armed && (
          <button onClick={() => { sirenRef.current?.ensure(); setNeedsGesture(false); }} style={{ ...btn, background: '#fff', color: '#b91c1c', marginTop: 14 }}>🔊 Click to sound the siren</button>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          <button onClick={acknowledge} disabled={busy} style={{ ...btn, background: '#fff', color: '#b91c1c' }}>{busy ? 'Acknowledging…' : '✋ Acknowledge & silence'}</button>
          <button onClick={() => mute(5)} style={{ ...btn, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.5)' }}>🔇 Mute 5 min</button>
          <Link href={emergencyActive ? '/emergency' : `/alerts?id=${criticalOpen[0]?.id}`} onClick={() => mute(1)} style={{ ...btn, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)', textDecoration: 'none' }}>View details →</Link>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: '#fecdd3' }}>
          Siren {armed ? 'on' : 'off'} · <button onClick={() => { const v = armed ? 'off' : 'on'; write('sf_siren', v); setArmed(!armed); window.dispatchEvent(new CustomEvent('sf-siren', { detail: v })); }} style={{ background: 'none', border: 'none', color: '#fff', textDecoration: 'underline', cursor: 'pointer', fontSize: 11 }}>{armed ? 'turn sound off' : 'turn sound on'}</button>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '10px 16px', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: 'pointer', border: 'none' };
