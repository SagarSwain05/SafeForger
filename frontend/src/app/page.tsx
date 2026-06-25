'use client';
import { useSocket, API_URL } from '@/lib/socket';
import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

const STATUS_COLOR: Record<string, string> = {
  NORMAL: '#00e676', WARNING: '#ffb300', CRITICAL: '#ff1744', SAFE: '#00e676',
  ELEVATED: '#ff8f00', HIGH: '#ff5252',
};
const STATUS_BG: Record<string, string> = {
  NORMAL: 'rgba(0,230,118,0.07)', WARNING: 'rgba(255,179,0,0.1)',
  CRITICAL: 'rgba(255,23,68,0.13)', SAFE: 'rgba(0,230,118,0.07)',
};

function SensorCard({ s }: { s: any }) {
  const pct = s.type === 'O2'
    ? 100 - ((s.value - s.criticalThreshold) / (25 - s.criticalThreshold)) * 100
    : Math.min(100, (s.value / (s.criticalThreshold * 1.2)) * 100);
  const color = STATUS_COLOR[s.status] ?? '#00e676';
  return (
    <div className="glass-card" style={{ padding: 14, background: STATUS_BG[s.status] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: '#4a6080', textTransform: 'uppercase', letterSpacing: 1 }}>{s.zone}</div>
          <div style={{ fontSize: 12, color: '#8ba0c4', marginTop: 1 }}>{s.id}</div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
          background: `${color}20`, color, border: `1px solid ${color}40`
        }}>{s.status}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color }}>{s.value.toFixed(1)}</span>
        <span style={{ fontSize: 11, color: '#4a6080' }}>{s.unit}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4a6080' }}>{s.type}</span>
      </div>
      <div className="sensor-bar-track">
        <div className="sensor-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <div style={{ height: 36, marginTop: 6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={s.history ?? []}>
            <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
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
        <span style={{ color: '#ff1744', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>⚠ LIVE ALERTS</span>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div className="ticker-inner">
            {items.map((a, i) => (
              <span key={i} style={{ marginRight: 48, fontSize: 12, color: a.severity === 'CRITICAL' ? '#ff4444' : '#ffb300', fontFamily: 'JetBrains Mono, monospace' }}>
                [{a.severity}] {a.name}: {a.details?.slice(0, 80)}…
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScadaCard({ label, value, unit, status }: any) {
  const c = status === 'FAULT' ? '#ff1744' : status === 'DEGRADED' ? '#ffb300' : '#00e676';
  return (
    <div className="glass-card" style={{ padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: '#4a6080', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c }}>{value}</div>
      <div style={{ fontSize: 10, color: '#4a6080' }}>{unit}</div>
      <div style={{ marginTop: 6, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: status === 'NORMAL' ? '100%' : status === 'DEGRADED' ? '60%' : '20%', background: c, borderRadius: 2, transition: 'all 1s' }} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { sensors, riskData, emergencyState, shiftInfo, permits, connected } = useSocket();
  const [scada] = useState([
    { label: 'Crude Pump P-101', value: '94.2', unit: 'RPM%', status: 'NORMAL' },
    { label: 'Compressor K-201', value: '88.7', unit: 'RPM%', status: 'NORMAL' },
    { label: 'Heat Ex E-101', value: '67.3', unit: '°C', status: 'DEGRADED' },
    { label: 'Valve FCV-301', value: 'OPEN', unit: '100%', status: 'NORMAL' },
    { label: 'Boiler B-101', value: '12.4', unit: 'bar', status: 'NORMAL' },
    { label: 'Cooling Tower', value: '89.1', unit: 'RPM%', status: 'NORMAL' },
    { label: 'Flare KO Drum', value: 'LOW', unit: 'Level', status: 'NORMAL' },
    { label: 'Storage V-401', value: '73.2', unit: '% Full', status: 'NORMAL' },
  ]);
  const [scenario, setScenario] = useState('NORMAL');

  const riskScore = riskData?.riskScore ?? 0;
  const riskStatus = riskData?.status ?? 'SAFE';
  const alerts = riskData?.alerts ?? [];
  const scoreColor = STATUS_COLOR[riskStatus] ?? '#00e676';
  const isEmergency = emergencyState?.active;

  const triggerScenario = async (s: string) => {
    setScenario(s);
    await fetch(`${API_URL}/api/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: s }) });
  };

  const criticalCount = sensors.filter(s => s.status === 'CRITICAL').length;
  const warningCount = sensors.filter(s => s.status === 'WARNING').length;
  const activePermits = permits.filter(p => p.status === 'ACTIVE').length;

  return (
    <div style={{ padding: 24, maxWidth: 1600 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>
            COMMAND CENTER
          </h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>
            {shiftInfo ? `Shift ${shiftInfo.current} · Supervisor: ${shiftInfo.supervisor} · ${shiftInfo.workersOnSite} workers on-site` : 'Loading shift data…'}
          </div>
        </div>
        {/* Scenario Controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#4a6080' }}>Demo Scenario:</span>
          {['NORMAL', 'KILL_CHAIN', 'EMERGENCY'].map(s => (
            <button key={s} onClick={() => triggerScenario(s)} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${scenario === s ? scoreColor : 'rgba(56,100,200,0.2)'}`,
              background: scenario === s ? `${scoreColor}18` : 'rgba(10,18,40,0.5)',
              color: scenario === s ? scoreColor : '#8ba0c4', transition: 'all 0.2s',
            }}>{s.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {/* Alert Ticker */}
      {alerts.length > 0 && <div style={{ marginBottom: 16 }}><AlertTicker alerts={alerts} /></div>}

      {/* Emergency Banner */}
      {isEmergency && (
        <div style={{
          marginBottom: 20, padding: '14px 20px', borderRadius: 10, animation: 'emergencyFlash 0.5s ease-in-out infinite alternate',
          border: '1px solid rgba(255,23,68,0.5)', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>🚨</span>
          <div>
            <div style={{ color: '#ff1744', fontWeight: 700, fontSize: 14 }}>EMERGENCY ACTIVE — {emergencyState.level}</div>
            <div style={{ color: '#ff6b6b', fontSize: 12 }}>{emergencyState.triggeredBy}</div>
          </div>
          <a href="/emergency" style={{ marginLeft: 'auto', padding: '6px 14px', background: '#ff1744', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>View Response →</a>
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {/* Risk Score */}
        <div className="glass-card" style={{ padding: 16, gridColumn: 'span 1', background: `${scoreColor}0a`, borderColor: `${scoreColor}30` }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>AI Risk Score</div>
          <div style={{ fontSize: 40, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{riskScore}</div>
          <div style={{ fontSize: 11, color: scoreColor, fontWeight: 600, marginTop: 4 }}>{riskStatus}</div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 8 }}>
            <div style={{ height: '100%', width: `${riskScore}%`, background: scoreColor, borderRadius: 2, transition: 'width 1s' }} />
          </div>
        </div>
        <div className="glass-card" style={{ padding: 16, background: criticalCount > 0 ? 'rgba(255,23,68,0.1)' : undefined }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Critical Sensors</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: criticalCount > 0 ? '#ff1744' : '#00e676' }}>{criticalCount}</div>
          <div style={{ fontSize: 11, color: '#4a6080' }}>{warningCount} warning</div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Active Permits</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#ffb300' }}>{activePermits}</div>
          <div style={{ fontSize: 11, color: '#4a6080' }}>PTW in progress</div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Compound Risks</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: alerts.length > 0 ? '#ff5252' : '#00e676' }}>{alerts.length}</div>
          <div style={{ fontSize: 11, color: '#4a6080' }}>rule violations</div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Live Sensors</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#448aff' }}>{sensors.length}</div>
          <div style={{ fontSize: 11, color: connected ? '#00e676' : '#ff4444' }}>{connected ? '● Live stream' : '● Disconnected'}</div>
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Sensor Grid */}
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>IoT Sensor Telemetry</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {sensors.map(s => <SensorCard key={s.id} s={s} />)}
          </div>

          {/* Compound Alerts */}
          {alerts.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: '#ff4444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>⚠ Compound Risk Alerts</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {alerts.map((a: any, i: number) => (
                  <div key={i} className="glass-card" style={{
                    padding: 16, borderColor: a.severity === 'CRITICAL' ? 'rgba(255,23,68,0.4)' : 'rgba(255,82,82,0.3)',
                    background: a.severity === 'CRITICAL' ? 'rgba(255,23,68,0.08)' : 'rgba(255,82,82,0.06)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: a.severity === 'CRITICAL' ? '#ff1744' : '#ff5252' }}>{a.name}</div>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 700, background: 'rgba(255,23,68,0.15)', color: '#ff4444', border: '1px solid rgba(255,68,68,0.3)' }}>{a.severity}</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#8ba0c4', marginBottom: 8, lineHeight: 1.5 }}>{a.details}</p>
                    <div style={{ fontSize: 11, color: '#4a6080', fontFamily: 'JetBrains Mono, monospace' }}>📚 {a.regulation}</div>
                    {a.aiRecommendation && (
                      <div style={{ marginTop: 10, padding: 10, background: 'rgba(0,176,255,0.08)', borderRadius: 6, border: '1px solid rgba(0,176,255,0.15)' }}>
                        <div style={{ fontSize: 10, color: '#00b0ff', fontWeight: 600, marginBottom: 4 }}>🤖 AI RECOMMENDATION</div>
                        <p style={{ fontSize: 11, color: '#8ba0c4', lineHeight: 1.5 }}>{a.aiRecommendation}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* SCADA Status */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>SCADA Equipment Status</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {scada.map(s => <ScadaCard key={s.label} {...s} />)}
            </div>
          </div>

          {/* Active Permits */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Active Permits</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {permits.filter(p => p.status === 'ACTIVE').map(p => (
                <div key={p.id} style={{ padding: 10, background: 'rgba(255,179,0,0.06)', borderRadius: 8, border: '1px solid rgba(255,179,0,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#ffb300' }}>{p.icon} {p.typeKey?.replace('_', ' ')}</span>
                    <span style={{ fontSize: 10, color: '#4a6080' }}>{p.id}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#8ba0c4', marginTop: 4 }}>{p.zoneName}</div>
                  <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>{p.requestedBy} · {p.elapsedMinutes}m elapsed</div>
                </div>
              ))}
              {permits.filter(p => p.status === 'ACTIVE').length === 0 && (
                <div style={{ fontSize: 12, color: '#4a6080', textAlign: 'center', padding: 12 }}>No active permits</div>
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Quick Actions</h2>
            {[
              { href: '/heatmap', label: 'View Safety Heatmap', icon: '🗺️', color: '#448aff' },
              { href: '/permits', label: 'Raise New Permit', icon: '📋', color: '#ffb300' },
              { href: '/incidents', label: 'Query Incident RAG', icon: '🔍', color: '#00b0ff' },
              { href: '/emergency', label: 'Emergency Console', icon: '🚨', color: '#ff4444' },
            ].map(a => (
              <a key={a.href} href={a.href} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, textDecoration: 'none', color: a.color, fontSize: 12, marginBottom: 4, background: `${a.color}10`, transition: 'background 0.2s' }}>
                <span>{a.icon}</span>{a.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
