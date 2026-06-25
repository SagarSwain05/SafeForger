'use client';
import { useSocket, API_URL } from '@/lib/socket';
import { useState } from 'react';

export default function EmergencyPage() {
  const { emergencyState, riskData } = useSocket();
  const [triggering, setTriggering] = useState(false);
  const [level, setLevel] = useState('LEVEL_2');
  const [cause, setCause] = useState('');
  const [resetting, setResetting] = useState(false);

  const isActive = emergencyState?.active;
  const timeline = emergencyState?.timeline ?? [];
  const report = emergencyState?.report;

  const handleTrigger = async () => {
    if (!cause.trim()) return;
    setTriggering(true);
    await fetch(`${API_URL}/api/emergency/trigger`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, cause, affectedZones: ['Z-01', 'Z-07'] })
    });
    setTriggering(false);
  };

  const handleReset = async () => {
    setResetting(true);
    await fetch(`${API_URL}/api/emergency/reset`, { method: 'POST' });
    setResetting(false);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: isActive ? '#ff1744' : '#e8f0ff', letterSpacing: 1, animation: isActive ? 'emergencyFlash 0.5s ease-in-out infinite alternate' : 'none' }}>
            🚨 EMERGENCY RESPONSE
          </h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Autonomous orchestrator · DGMS/Factory Act incident reporting</div>
        </div>
        {isActive && (
          <button onClick={handleReset} disabled={resetting} style={{ padding: '10px 20px', borderRadius: 8, background: 'rgba(255,23,68,0.1)', border: '1px solid rgba(255,23,68,0.4)', color: '#ff4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {resetting ? 'Resetting…' : '🔄 Reset Emergency'}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Trigger Panel */}
        {!isActive ? (
          <div className="glass-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e8f0ff', marginBottom: 20 }}>Emergency Trigger</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: '#8ba0c4', display: 'block', marginBottom: 6 }}>Emergency Level</label>
                <select value={level} onChange={e => setLevel(e.target.value)} style={{ width: '100%', padding: '10px', background: 'rgba(10,18,40,0.8)', border: '1px solid rgba(56,100,200,0.2)', borderRadius: 8, color: '#e8f0ff', fontSize: 13 }}>
                  <option value="LEVEL_1">Level 1 — Minor Incident (Zone Evacuation)</option>
                  <option value="LEVEL_2">Level 2 — Major Incident (Plant Shutdown)</option>
                  <option value="LEVEL_3">Level 3 — Catastrophic (Full Site Evacuation)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#8ba0c4', display: 'block', marginBottom: 6 }}>Trigger Cause</label>
                <textarea value={cause} onChange={e => setCause(e.target.value)} rows={3}
                  placeholder="Describe the triggering condition (e.g. 'Hot work permit active with CH4 at 18% LEL in Z-01')"
                  style={{ width: '100%', padding: '10px', background: 'rgba(10,18,40,0.8)', border: '1px solid rgba(56,100,200,0.2)', borderRadius: 8, color: '#e8f0ff', fontSize: 13, resize: 'vertical' }}
                />
              </div>
              {/* Auto-fill from current risk */}
              {riskData?.alerts?.length > 0 && (
                <button onClick={() => setCause(riskData.alerts[0].details)} style={{ padding: '8px', borderRadius: 6, background: 'rgba(255,179,0,0.08)', border: '1px solid rgba(255,179,0,0.2)', color: '#ffb300', fontSize: 11, cursor: 'pointer' }}>
                  ⚡ Auto-fill from live compound risk alert
                </button>
              )}
              <button onClick={handleTrigger} disabled={triggering || !cause.trim()} style={{
                padding: '14px', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(255,23,68,0.15)', border: '2px solid rgba(255,23,68,0.5)', color: '#ff1744',
                opacity: !cause.trim() ? 0.5 : 1, letterSpacing: 1, fontFamily: 'Orbitron, monospace',
              }}>
                {triggering ? '⏳ INITIATING…' : '🚨 DECLARE EMERGENCY'}
              </button>
            </div>
          </div>
        ) : (
          /* Active Emergency Status */
          <div className="glass-card" style={{ padding: 24, borderColor: 'rgba(255,23,68,0.4)', background: 'rgba(255,23,68,0.05)' }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#ff4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2 }}>EMERGENCY ACTIVE</div>
              <div style={{ fontSize: 20, fontFamily: 'Orbitron, monospace', color: '#ff1744', marginTop: 4 }}>{emergencyState.level}</div>
              <div style={{ fontSize: 12, color: '#8ba0c4', marginTop: 6 }}>{emergencyState.triggeredBy}</div>
              <div style={{ fontSize: 11, color: '#4a6080', marginTop: 4 }}>
                Triggered: {new Date(emergencyState.triggeredAt).toLocaleTimeString()}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {(emergencyState.affectedZones ?? []).map((z: string) => (
                <span key={z} style={{ padding: '3px 10px', borderRadius: 12, background: 'rgba(255,23,68,0.15)', border: '1px solid rgba(255,68,68,0.3)', color: '#ff6b6b', fontSize: 11 }}>{z}</span>
              ))}
            </div>
            <div style={{ padding: 12, background: 'rgba(255,23,68,0.08)', borderRadius: 8, border: '1px solid rgba(255,68,68,0.2)', fontSize: 12, color: '#ff8080', lineHeight: 1.5 }}>
              ⚠ All non-essential personnel must evacuate to Assembly Point A immediately. Emergency response teams mobilized.
            </div>
          </div>
        )}

        {/* Response Timeline */}
        <div className="glass-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e8f0ff', marginBottom: 16 }}>Response Timeline</h2>
          {timeline.length === 0 && <div style={{ color: '#4a6080', fontSize: 13, textAlign: 'center', padding: 30 }}>No active emergency. Trigger an emergency to see autonomous response.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {timeline.map((evt: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 12, position: 'relative' }} className="fade-in-up">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 10, height: 10, background: '#00e676', borderRadius: '50%', marginTop: 2, flexShrink: 0, boxShadow: '0 0 8px #00e676' }} />
                  {i < timeline.length - 1 && <div style={{ width: 1, flex: 1, background: 'rgba(0,230,118,0.2)', marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e8f0ff' }}>{evt.title}</div>
                  <div style={{ fontSize: 11, color: '#8ba0c4', marginTop: 2 }}>{evt.description}</div>
                  <div style={{ fontSize: 10, color: '#4a6080', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>{new Date(evt.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Incident Report */}
      {report && (
        <div className="glass-card" style={{ padding: 24, marginTop: 20, borderColor: 'rgba(0,176,255,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#00b0ff' }}>📋 {report.title} — {report.reportId}</h2>
            <span style={{ padding: '3px 10px', borderRadius: 12, background: 'rgba(255,179,0,0.1)', color: '#ffb300', border: '1px solid rgba(255,179,0,0.3)', fontSize: 11 }}>{report.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            {[['Report ID', report.reportId], ['Classification', report.classification], ['Plant', report.plant], ['Generated', new Date(report.generatedAt).toLocaleString()]].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: '#4a6080' }}>{k}</div>
                <div style={{ fontSize: 12, color: '#e8f0ff', fontFamily: 'JetBrains Mono, monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: 16, background: 'rgba(10,18,40,0.8)', borderRadius: 8, border: '1px solid rgba(56,100,200,0.15)', fontSize: 12, color: '#8ba0c4', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', maxHeight: 320, overflowY: 'auto' }}>
            {report.content}
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#4a6080', marginBottom: 6 }}>Regulatory Notifications:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {report.regulatory?.map((r: string) => <span key={r} className="tag-chip">{r}</span>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
