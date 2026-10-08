'use client';
import { useSocket, api } from '@/lib/socket';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import LivePanel from '@/components/LivePanel';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

const STATUS_COLOR: Record<string, string> = {
  NORMAL: '#16a34a', WARNING: '#d97706', CRITICAL: '#e11d48', SAFE: '#16a34a',
  ELEVATED: '#ea580c', HIGH: '#ef4444',
};
const STATUS_BG: Record<string, string> = {
  NORMAL: 'rgba(0,230,118,0.07)', WARNING: 'rgba(255,179,0,0.1)',
  CRITICAL: 'rgba(255,23,68,0.13)', SAFE: 'rgba(0,230,118,0.07)',
};

const ago = (ts: number | null) => {
  if (!ts) return 'never';
  const sec = Math.round((Date.now() - ts) / 1000);
  return sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.round(sec / 60)}m ago` : `${Math.round(sec / 3600)}h ago`;
};

function SensorCard({ s }: { s: any }) {
  const offline = s.online === false || s.value === null || s.value === undefined;
  const pct = offline ? 0 : s.type === 'O2'
    ? 100 - ((s.value - s.criticalThreshold) / (25 - s.criticalThreshold)) * 100
    : Math.min(100, (s.value / (s.criticalThreshold * 1.2)) * 100);
  const color = offline ? '#64748b' : STATUS_COLOR[s.status] ?? '#16a34a';
  return (
    <div className="glass-card" style={{ padding: 14, background: offline ? undefined : STATUS_BG[s.status], opacity: offline ? 0.75 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{s.zone} · {s.id}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.label}>{s.label || s.type}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: `${color}20`, color, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>{offline ? (s.value === null ? 'NO DATA' : 'OFFLINE') : s.status}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color }}>{s.value === null || s.value === undefined ? '—' : Number(s.value).toFixed(1)}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.unit}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{s.type}</span>
      </div>
      <div className="sensor-bar-track">
        <div className="sensor-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
      {s.source && s.source !== 'simulated' ? (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>{s.value === null ? 'Waiting for first reading' : `${String(s.source).replace('manual:', 'manual · ')} · ${ago(s.lastUpdated)}`}</div>
      ) : null}
      <div style={{ height: 36, marginTop: 6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={s.history ?? []}>
            <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AlertTicker({ alerts }: { alerts: any[] }) {
  if (!alerts?.length) return null;
  const items = [...alerts, ...alerts];
  return (
    <div style={{
      background: 'rgba(255,23,68,0.1)', border: '1px solid rgba(255,23,68,0.3)',
      borderRadius: 8, padding: '8px 16px', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: '#e11d48', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>⚠ LIVE ALERTS</span>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div className="ticker-inner">
            {items.map((a, i) => (
              <span key={i} style={{ marginRight: 48, fontSize: 12, color: a.severity === 'CRITICAL' ? '#ff4444' : '#d97706', fontFamily: 'JetBrains Mono, monospace' }}>
                [{a.severity}] {a.name}: {a.details?.slice(0, 80)}…
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScadaCard({ label, value, unit, state, normal }: any) {
  const c = state === 'FAULT' || state === 'TRIPPED' ? '#e11d48' : state !== normal ? '#d97706' : '#16a34a';
  return (
    <div className="glass-card" style={{ padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 16, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{unit} · {state}</div>
    </div>
  );
}

const killChainSteps = (zone: string) => [
  { step: 'drift', title: '1 · Silent drift', text: `Flammable gas in ${zone} (Z-01) creeps up — every sensor stays below its alarm. A threshold system sees nothing.` },
  { step: 'permit', title: '2 · Hot-work permit issued', text: 'A paper hot-work permit goes live in the same zone, bypassing gas validation. SafeForge links the two instantly.' },
  { step: 'reset', title: '↺ Reset demo', text: 'Restore baseline: normal gas, permits back to their seed state, emergency stood down.' },
];

export default function DashboardPage() {
  const { site } = useAuth();
  const z1 = site?.layout.zones[0]?.name || 'Z-01';
  const KILL_CHAIN_STEPS = killChainSteps(z1);
  const { sensors, riskData, emergencyState, shiftInfo, permits, connected, scada, scenario, cvDetections, alerts, alertStats, siteInfo } = useSocket();
  const live = site?.mode === 'live';
  const situation = siteInfo?.situation;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const riskScore = riskData?.riskScore ?? 0;
  const riskStatus = riskData?.status ?? 'SAFE';
  const compound = riskData?.alerts ?? [];
  const scoreColor = STATUS_COLOR[riskStatus] ?? '#16a34a';
  const isEmergency = emergencyState?.active;
  const lead = riskData?.leadTimeMin;
  const worsening = (riskData?.forecasts ?? []).filter((f: any) => f.trend === 'WORSENING');

  const runStep = async (step: string) => {
    setBusy(step);
    try {
      const r = await api('/demo/kill-chain', { method: 'POST', json: { step } });
      setNote(r.message + (r.riskScore !== undefined ? ` → risk ${r.riskScore} (${r.status})` : ''));
    } catch (e: any) { setNote(`Could not reach backend: ${e.message}`); }
    setBusy('');
  };

  const criticalCount = sensors.filter(s => s.status === 'CRITICAL').length;
  const warningCount = sensors.filter(s => s.status === 'WARNING').length;
  const activePermits = permits.filter(p => p.status === 'ACTIVE');
  const cams = Object.values(cvDetections) as any[];
  const observed = cams.reduce((n, d) => n + (d.worker_count || 0), 0);
  const violations = cams.reduce((n, d) => n + (d.ppe_violations || 0), 0);
  const compliance = observed ? Math.round(((observed - violations) / observed) * 100) : null;
  const openAlerts = alerts.filter(a => a.status !== 'RESOLVED').slice(0, 6);

  const kpi = (label: string, value: any, color: string, sub: string, extra?: React.CSSProperties) => (
    <div className="glass-card" style={{ padding: 16, ...extra }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 34, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 1 }}>COMMAND CENTER</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {shiftInfo ? `${site?.name ?? ''}${live ? '' : site?.kind === 'preset' ? ' (digital twin · simulated)' : ' (simulated)'} · Shift ${shiftInfo.current} · Supervisor ${shiftInfo.supervisor} · ${shiftInfo.workersOnSite} workers on site` : 'Connecting to plant…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="tag-chip" style={live ? { color: '#16a34a', borderColor: 'rgba(22,163,74,0.4)' } : undefined}>{live ? '● LIVE DATA' : `Simulated · ${scenario.replace('_', ' ')}`}</span>
          <Link href="/vision" style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(0,176,255,0.12)', border: '1px solid rgba(0,176,255,0.4)', color: 'var(--c-cyan-soft)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>🎯 Open Vision AI</Link>
        </div>
      </div>

      {compound.length > 0 && <div style={{ marginBottom: 16 }}><AlertTicker alerts={compound} /></div>}

      {isEmergency && (
        <div className="emergency-mode" style={{ marginBottom: 20, padding: '14px 20px', borderRadius: 10, border: '1px solid rgba(255,23,68,0.5)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20 }}>🚨</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ color: '#e11d48', fontWeight: 700, fontSize: 14 }}>EMERGENCY ACTIVE — {emergencyState.level}{emergencyState.auto ? ' (declared automatically)' : ''}</div>
            <div style={{ color: 'var(--c-red-soft)', fontSize: 12 }}>{emergencyState.triggeredBy}</div>
          </div>
          <Link href="/emergency" style={{ padding: '6px 14px', background: '#e11d48', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>View response →</Link>
        </div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        {kpi('AI risk score', riskScore, scoreColor, riskStatus, { background: `${scoreColor}0d`, borderColor: `${scoreColor}40` })}
        {kpi('Lead time to alarm', lead != null ? `${lead}m` : '—', lead != null ? '#d97706' : 'var(--text-muted)', lead != null ? 'worsening sensor near active work' : 'no worsening trend near work')}
        {kpi('Open alerts', alertStats?.open ?? 0, (alertStats?.openCritical ?? 0) ? '#e11d48' : (alertStats?.open ?? 0) ? '#ea580c' : '#16a34a', `${alertStats?.openCritical ?? 0} critical · MTTA ${alertStats?.meanTimeToAcknowledgeSec != null ? alertStats.meanTimeToAcknowledgeSec + 's' : '—'}`)}
        {kpi('PPE compliance', compliance != null ? `${compliance}%` : '—', compliance == null ? 'var(--text-muted)' : compliance >= 95 ? '#16a34a' : compliance >= 80 ? '#d97706' : '#e11d48', cams.length ? `${observed} workers on ${cams.length} camera(s)` : 'no camera streaming')}
        {kpi('Sensors / permits', `${sensors.length}/${activePermits.length}`, criticalCount ? '#e11d48' : '#3b82f6', `${criticalCount} critical · ${warningCount} warning · ${connected ? 'live' : 'offline'}`)}
      </div>

      <div className="dash-grid">
        <div>
          {live && <LivePanel />}
          {!live && situation && (
            <div className="glass-card" style={{ padding: 14, marginBottom: 16, borderColor: 'rgba(234,88,12,0.35)', background: 'rgba(234,88,12,0.05)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#ea580c', letterSpacing: 1 }}>SITE BRIEFING · ACTIVE SITUATION</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{situation.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Watch <strong>{situation.sensorId}</strong> ({situation.sensorLabel}) in {situation.zoneName} ({situation.zone}). Point of action: <strong>{situation.action}</strong>.
              </div>
            </div>
          )}
          {/* Kill-chain demo */}
          {!live && <div className="glass-card" style={{ padding: 16, marginBottom: 20, borderColor: 'rgba(255,179,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-amber-soft)', textTransform: 'uppercase', letterSpacing: 1 }}>Kill-chain demo — compound risk in two steps</h2>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Watch the risk score, heatmap (Z-01) and alert toasts</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {KILL_CHAIN_STEPS.map(s => (
                <button key={s.step} onClick={() => runStep(s.step)} disabled={!!busy} style={{ textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-subtle)', border: `1px solid ${s.step === 'reset' ? 'var(--border-subtle)' : 'rgba(255,179,0,0.35)'}`, opacity: busy && busy !== s.step ? 0.5 : 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: s.step === 'reset' ? 'var(--text-secondary)' : '#d97706' }}>{busy === s.step ? '⏳ ' : ''}{s.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>{s.text}</div>
                </button>
              ))}
            </div>
            {note && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-body)' }}>› {note}</div>}
            {worsening.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {worsening.map((f: any) => (
                  <span key={f.sensorId} className="tag-chip" style={{ color: 'var(--c-amber)', borderColor: 'rgba(255,179,0,0.35)' }}>
                    ↑ {f.sensorId} {f.type} {f.value}{f.unit}{f.etaWarningMin ? ` · alarm in ~${f.etaWarningMin} min` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>}

          {compound.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: '#ff4444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>⚠ Compound risks</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {compound.map((a: any) => (
                  <div key={a.id} className="glass-card" style={{ padding: 16, borderColor: a.severity === 'CRITICAL' ? 'rgba(255,23,68,0.45)' : 'rgba(255,109,0,0.3)', background: a.severity === 'CRITICAL' ? 'rgba(255,23,68,0.07)' : 'rgba(255,109,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: a.severity === 'CRITICAL' ? '#e11d48' : '#ff9100' }}>{a.ruleId} · {a.name}</div>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 700, background: 'rgba(255,23,68,0.15)', color: 'var(--c-red-soft)' }}>{a.severity}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-body)', lineHeight: 1.5 }}>{a.details}</p>
                    {a.chains?.[0] && <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>graph: {a.chains[0].join(' → ')}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>📚 {a.regulation} · ▶ {a.recommendedActions?.[0]}</div>
                    {a.aiRecommendation && (
                      <div style={{ marginTop: 10, padding: 10, background: 'rgba(0,176,255,0.07)', borderRadius: 6, border: '1px solid rgba(0,176,255,0.18)' }}>
                        <div style={{ fontSize: 10, color: 'var(--c-cyan)', fontWeight: 600, marginBottom: 4 }}>🤖 AI RECOMMENDATION</div>
                        <p style={{ fontSize: 11, color: 'var(--text-body)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.aiRecommendation}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>IoT sensor telemetry</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {sensors.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No sensors configured for this site.</div>}
            {sensors.map(s => <SensorCard key={s.id} s={s} />)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>Latest alerts</h2>
              <Link href="/alerts" style={{ fontSize: 11, color: 'var(--c-cyan)', textDecoration: 'none' }}>All →</Link>
            </div>
            {openAlerts.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No open alerts.</div>}
            {openAlerts.map(a => (
              <Link key={a.id} href={`/alerts?id=${a.id}`} style={{ display: 'block', textDecoration: 'none', padding: '8px 10px', marginBottom: 6, borderRadius: 6, background: 'var(--bg-subtle)', borderLeft: `3px solid ${a.severity === 'CRITICAL' ? '#e11d48' : a.severity === 'HIGH' ? '#ea580c' : '#d97706'}` }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{a.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{a.severity} · {a.zone || 'plant'} · {a.status.toLowerCase()} · {new Date(a.createdAt).toLocaleTimeString()}</div>
              </Link>
            ))}
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>CCTV vision</h2>
              <Link href="/cctv" style={{ fontSize: 11, color: 'var(--c-cyan)', textDecoration: 'none' }}>Camera wall →</Link>
            </div>
            {cams.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No camera streaming. <Link href="/vision" style={{ color: 'var(--c-cyan)' }}>Start a feed</Link> or run the Python edge agent.</div>}
            {cams.map((d: any) => (
              <div key={d.zone} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-primary)' }}>{d.camera_id} <span style={{ color: 'var(--text-muted)' }}>{d.zone}</span></span>
                <span style={{ color: d.fire_detected ? '#f97316' : d.smoke_detected ? '#a3a3a3' : d.ppe_violations ? '#ef4444' : '#22c55e' }}>
                  {d.fire_detected ? '🔥 fire' : d.smoke_detected ? '💨 smoke' : d.ppe_violations ? `${d.ppe_violations} PPE` : 'clear'} · {d.worker_count} workers
                </span>
              </div>
            ))}
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>SCADA equipment {live ? (scada?.connected ? '(live gateway)' : '') : '(simulated)'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {(scada?.equipment ?? []).map((e: any) => <ScadaCard key={e.id} label={e.label} value={e.value} unit={e.unit} state={e.state} normal={e.normalState} />)}
              {!scada && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Waiting for SCADA…</div>}
              {scada && !(scada.equipment ?? []).length && <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-muted)' }}>No SCADA gateway connected. Push equipment states to the SCADA endpoint shown on Site &amp; Cameras.</div>}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Active permits</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activePermits.map(p => (
                <div key={p.id} style={{ padding: 10, background: 'rgba(255,179,0,0.06)', borderRadius: 8, border: '1px solid rgba(255,179,0,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-amber)' }}>{p.icon} {p.typeKey?.replace('_', ' ')}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.id}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{p.zoneName} ({p.zone})</div>
                </div>
              ))}
              {activePermits.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>No active permits</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
