'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';

const DEMO = { email: 'safeforgerdemo@gmail.com', password: 'Safeforger@20226' };

const GOALS = [
  { icon: '⛑️', title: 'Safety-gear compliance', text: 'Detect whether every worker wears the PPE their zone requires — helmet, high-visibility vest, safety footwear and gloves where applicable.' },
  { icon: '🔥', title: 'Smoke & fire, early', text: 'Spot the first signs of smoke and flames on CCTV in real time, confirmed over several frames so a single noisy frame never raises an alarm.' },
  { icon: '📍', title: 'Alerts with location & context', text: 'Tell the right people the zone, camera, map position, evidence frame, event type, regulation breached and what to do next.' },
  { icon: '⏱️', title: 'Faster intervention', text: 'Cut response time with routed alerts, an on-screen siren, acknowledgement tracking and an autonomous emergency response.' },
];

const FEATURES = [
  { icon: '🎯', title: 'Edge Vision AI', text: 'Two YOLOv8 models (19-class PPE + fire/smoke) run in the browser via WebGPU/WebAssembly and on a Python edge agent for RTSP cameras. Per-worker tracking keeps IDs stable and filters flicker.' },
  { icon: '🧠', title: 'Compound-risk engine', text: 'A knowledge graph links permits, gas sensors, cameras and people across adjacent zones. It catches deadly overlaps — hot work next to a slow gas build-up — before any single alarm sounds.' },
  { icon: '📈', title: 'Lead time, not just alarms', text: 'Trend forecasting estimates minutes-to-alarm for every worsening sensor near active work.' },
  { icon: '📋', title: 'Permit intelligence', text: 'Blocks unsafe permits using live gas readings, SIMOPS conflicts and CCTV PPE status; extra PPE is demanded automatically while hot work or confined-space entry is active.' },
  { icon: '🚨', title: 'Autonomous response', text: 'Critical risk or confirmed fire triggers alarm, permit suspension, evacuation guidance, evidence freeze and an AI-drafted statutory incident report.' },
  { icon: '📚', title: 'Regulation-aware', text: 'Every alert cites the Factories Act, OISD, IS and ISO references that apply; a RAG agent answers questions over incidents and regulations; a live audit scores compliance.' },
  { icon: '🏭', title: 'Your site, your cameras', text: 'Pick a real Indian facility twin or create your own site with zones, PPE rules, cameras (webcam, video URL, RTSP via edge agent) and emergency contacts.' },
  { icon: '🔔', title: 'Control-room ready', text: 'Alert center with evidence and ack/resolve, siren with full-screen alarm, heatmap, camera wall, light and dark themes, and a live server-status panel.' },
];

const STEPS = [
  ['See', 'Cameras, gas sensors, SCADA and worker locations stream in. Vision runs at the edge — raw video never leaves the site.'],
  ['Think', 'The risk engine fuses detections with permits and trends over a knowledge graph of the plant, scoring every zone 0–100.'],
  ['Learn', 'Alerts are enriched with regulations and similar past incidents; compliance is audited continuously.'],
  ['Act', 'People are alerted with evidence; critical conditions trigger the siren and an autonomous emergency response.'],
];

const SECTORS = ['Oil & gas refineries', 'Integrated steel plants', 'Thermal power stations', 'Chemical & petrochemical', 'Cement', 'Automotive manufacturing', 'Mining', 'Pharmaceutical / API', 'Ports & logistics', 'Construction sites'];

export default function Landing() {
  const { signIn, user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const tryDemo = async () => {
    if (user) { router.push('/dashboard'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', json: DEMO, timeoutMs: 75000 });
      signIn(r.token, r.user);
      router.push('/sites');
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div>
      {/* Hero */}
      <section className="section" style={{ paddingTop: 72, paddingBottom: 48 }}>
        <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--c-red)', fontSize: 12, fontWeight: 700 }}>
          Zero-harm industrial operations
        </div>
        <h1 style={{ fontSize: 'clamp(30px, 5vw, 52px)', lineHeight: 1.08, color: 'var(--text-primary)', margin: '18px 0 16px', letterSpacing: -1, maxWidth: 900 }}>
          See unsafe work and fire <span style={{ color: 'var(--c-cyan)' }}>before</span> it becomes an incident.
        </h1>
        <p className="lead" style={{ fontSize: 17 }}>
          SafeForge Nexus watches factory CCTV for missing PPE, smoke and fire, fuses it with gas sensors, permits-to-work and worker locations,
          and alerts the right people with the exact location, evidence and next action — often minutes before any single alarm would sound.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          <button onClick={tryDemo} disabled={busy} className="btn-primary" style={{ padding: '12px 20px', fontSize: 14 }}>{busy ? 'Opening demo… (server may take a minute to wake)' : '▶ Try the live demo'}</button>
          <Link href="/register" className="btn-ghost" style={{ padding: '12px 20px', fontSize: 14 }}>Create your site</Link>
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--c-red)', fontSize: 13 }}>{err}</div>}
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          Demo account: <code>{DEMO.email}</code> / <code>{DEMO.password}</code>
        </div>
        <div className="grid-3" style={{ marginTop: 36 }}>
          {[['19', 'PPE classes detected (incl. missing gear)'], ['2 of 5', 'frames to confirm fire — no single-frame false alarms'], ['< 2 s', 'detection-to-alert on the dashboard'], ['10', 'industry sectors with real-facility twins']].map(([k, v]) => (
            <div key={v} className="feature" style={{ padding: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--c-cyan)', fontFamily: 'JetBrains Mono, monospace' }}>{k}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section className="section" style={{ paddingTop: 24 }}>
        <h2>The problem</h2>
        <p className="lead">
          Factories face constant risk from unsafe practices and from smoke and fire, yet detection is often delayed or inconsistent.
          Many sites rely on manual monitoring, periodic inspections or standalone alarms that cannot tell whether a worker is wearing the
          right gear, and give no location-specific evidence of smoke or fire. The data often exists — on a CCTV screen nobody is watching,
          in a gas reading that looks normal, in a permit nobody cross-checked — but nobody acts on it in time.
        </p>
      </section>

      {/* Goals */}
      <section id="goals" className="section" style={{ paddingTop: 24 }}>
        <h2>Objectives</h2>
        <p className="lead">An AI system that works reliably in dynamic industrial environments and shortens the time from hazard to intervention.</p>
        <div className="grid-3">
          {GOALS.map(g => <div key={g.title} className="feature"><div style={{ fontSize: 26 }}>{g.icon}</div><h3>{g.title}</h3><p>{g.text}</p></div>)}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="section" style={{ paddingTop: 24 }}>
        <h2>What SafeForge does</h2>
        <div className="grid-3">
          {FEATURES.map(f => <div key={f.title} className="feature"><div style={{ fontSize: 24 }}>{f.icon}</div><h3>{f.title}</h3><p>{f.text}</p></div>)}
        </div>
      </section>

      {/* How */}
      <section id="how" className="section" style={{ paddingTop: 24 }}>
        <h2>How it works</h2>
        <div className="grid-3">
          {STEPS.map(([t, d], i) => (
            <div key={t} className="feature">
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--c-cyan)', letterSpacing: 1 }}>PHASE {i + 1}</div>
              <h3 style={{ fontSize: 20 }}>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="section" style={{ paddingTop: 24 }}>
        <h2>Built for heavy industry</h2>
        <p className="lead">Start from a sector template with zones, hazard classes and PPE rules already set — or pick a digital twin of a well-known Indian facility — then connect your own cameras.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
          {SECTORS.map(s => <span key={s} className="tag-chip" style={{ fontSize: 13, padding: '6px 12px' }}>{s}</span>)}
        </div>
      </section>

      {/* CTA */}
      <section className="section" style={{ paddingTop: 24, paddingBottom: 72 }}>
        <div className="feature" style={{ padding: 28, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Run the kill-chain demo in two clicks</h2>
            <p className="lead" style={{ fontSize: 14 }}>Watch a gas drift and a hot-work permit combine into a critical risk, the map turn red, the siren sound and the emergency response run itself.</p>
          </div>
          <button onClick={tryDemo} disabled={busy} className="btn-primary" style={{ padding: '12px 22px', fontSize: 14 }}>{busy ? 'Opening…' : 'Open the live demo →'}</button>
        </div>
      </section>
    </div>
  );
}
