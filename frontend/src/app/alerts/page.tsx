'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, useSocket, type Alert } from '@/lib/socket';

const SEV_COLOR: Record<string, string> = { CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffb300', LOW: '#448aff' };
const TYPE_META: Record<string, { icon: string; label: string }> = {
  FIRE: { icon: '🔥', label: 'Fire' }, SMOKE: { icon: '💨', label: 'Smoke' }, PPE_VIOLATION: { icon: '⛑️', label: 'PPE' },
  COMPOUND_RISK: { icon: '🧠', label: 'Compound risk' }, SENSOR: { icon: '📟', label: 'Sensor' }, EMERGENCY: { icon: '🚨', label: 'Emergency' },
};
const STATUS_COLOR: Record<string, string> = { OPEN: '#ff5252', ACKNOWLEDGED: '#ffb300', RESOLVED: '#22c55e' };

const ago = (iso: string | null) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export default function AlertsPage() {
  const { alerts, alertStats } = useSocket();
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [full, setFull] = useState<Alert | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setSelectedId(id);
  }, []);

  const filtered = useMemo(() => alerts.filter(a =>
    (typeFilter === 'ALL' || a.type === typeFilter) &&
    (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? a.status !== 'RESOLVED' : a.status === statusFilter))
  ), [alerts, typeFilter, statusFilter]);

  const selected = alerts.find(a => a.id === selectedId) || filtered[0] || null;

  // Fetch the full alert (with evidence frame) when selection or its evidence changes
  useEffect(() => {
    if (!selected) { setFull(null); return; }
    if (selected.evidence) { setFull(selected); return; }
    if (!selected.hasEvidence) { setFull(selected); return; }
    api<Alert>(`/alerts/${selected.id}`).then(setFull).catch(() => setFull(selected));
  }, [selected?.id, selected?.evidenceAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, action: 'ack' | 'resolve') => {
    setBusy(true);
    try { await api(`/alerts/${id}/${action}`, { method: 'POST', json: { by: 'Control Room Operator' } }); } finally { setBusy(false); }
  };

  const view = full && selected && full.id === selected.id ? { ...selected, evidence: full.evidence ?? selected.evidence } : selected;
  const s = alertStats;

  return (
    <div style={{ padding: 24, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>ALERT CENTER</h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Every hazard routed to the right people — with location, evidence frame, regulation and recommended action</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s?.channels && Object.entries(s.channels).map(([k, v]) => (
            <span key={k} className="tag-chip" style={{ color: v ? (v === 'simulated' ? '#ffb300' : '#22c55e') : '#4a6080' }}>
              {k}{v === 'simulated' ? ' (simulated)' : v ? ' ✓' : ' off'}
            </span>
          ))}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {[
          ['Open', s?.open ?? 0, (s?.open ?? 0) ? '#ff5252' : '#22c55e'],
          ['Open critical', s?.openCritical ?? 0, (s?.openCritical ?? 0) ? '#ff1744' : '#22c55e'],
          ['Acknowledged', s?.acknowledged ?? 0, '#ffb300'],
          ['Resolved', s?.resolved ?? 0, '#22c55e'],
          ['Mean time to ack', s?.meanTimeToAcknowledgeSec != null ? `${s.meanTimeToAcknowledgeSec}s` : '—', '#00b0ff'],
        ].map(([l, v, c]) => (
          <div key={String(l)} className="glass-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>{l}</div>
            <div style={{ fontSize: 28, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: String(c) }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {['ALL', 'FIRE', 'SMOKE', 'PPE_VIOLATION', 'COMPOUND_RISK', 'SENSOR', 'EMERGENCY'].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} style={chip(typeFilter === t)}>{t === 'ALL' ? 'All types' : `${TYPE_META[t].icon} ${TYPE_META[t].label}`}</button>
        ))}
        <span style={{ width: 12 }} />
        {['ACTIVE', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL'].map(t => (
          <button key={t} onClick={() => setStatusFilter(t)} style={chip(statusFilter === t)}>{t === 'ACTIVE' ? 'Not resolved' : t[0] + t.slice(1).toLowerCase()}</button>
        ))}
      </div>

      <div className="alerts-grid">
        <div className="glass-card" style={{ padding: 8, maxHeight: '70vh', overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: '#4a6080', fontSize: 13 }}>
              No alerts here. Start a feed on <Link href="/vision" style={{ color: '#00b0ff' }}>Vision AI</Link> or run the kill-chain demo on the <Link href="/" style={{ color: '#00b0ff' }}>Command Center</Link>.
            </div>
          )}
          {filtered.map(a => (
            <button key={a.id} onClick={() => setSelectedId(a.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: 10, marginBottom: 6, borderRadius: 8, cursor: 'pointer',
              background: selected?.id === a.id ? 'rgba(0,176,255,0.08)' : 'rgba(10,18,40,0.5)',
              border: `1px solid ${selected?.id === a.id ? 'rgba(0,176,255,0.4)' : `${SEV_COLOR[a.severity]}33`}`,
              borderLeft: `3px solid ${SEV_COLOR[a.severity]}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e8f0ff' }}>{TYPE_META[a.type]?.icon} {a.title}</span>
                <span style={{ fontSize: 10, color: STATUS_COLOR[a.status], fontWeight: 700, whiteSpace: 'nowrap' }}>{a.status}</span>
              </div>
              <div style={{ fontSize: 11, color: '#8ba0c4', marginTop: 3 }}>
                <span style={{ color: SEV_COLOR[a.severity], fontWeight: 700 }}>{a.severity}</span> · {a.zoneName || 'Plant'}{a.zone ? ` (${a.zone})` : ''}{a.cameraId ? ` · ${a.cameraId}` : ''} · {ago(a.createdAt)}
                {a.occurrences > 1 ? ` · ×${a.occurrences}` : ''}{!a.active && a.status !== 'RESOLVED' ? ' · cleared' : ''}{a.hasEvidence ? ' · 📸' : ''}
              </div>
            </button>
          ))}
        </div>

        {view ? (
          <div className="glass-card" style={{ padding: 18, borderColor: `${SEV_COLOR[view.severity]}55` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: SEV_COLOR[view.severity], fontWeight: 800, letterSpacing: 1 }}>{view.severity} · {TYPE_META[view.type]?.label?.toUpperCase()} · {view.id}</div>
                <h2 style={{ fontSize: 18, color: '#e8f0ff', margin: '4px 0 6px' }}>{view.title}</h2>
                <p style={{ fontSize: 13, color: '#c7d2fe', lineHeight: 1.55 }}>{view.message}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {view.status === 'OPEN' && <button disabled={busy} onClick={() => act(view.id, 'ack')} style={actionBtn('#ffb300')}>✋ Acknowledge</button>}
                {view.status !== 'RESOLVED' && <button disabled={busy} onClick={() => act(view.id, 'resolve')} style={actionBtn('#22c55e')}>✓ Resolve</button>}
              </div>
            </div>

            <div className="detail-grid" style={{ marginTop: 14 }}>
              <div>
                {view.evidence ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={view.evidence} alt={`Evidence frame for ${view.title}`} style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(56,100,200,0.25)' }} />
                ) : (
                  <div style={{ padding: 24, borderRadius: 8, border: '1px dashed rgba(56,100,200,0.3)', color: '#4a6080', fontSize: 12, textAlign: 'center' }}>
                    {view.hasEvidence ? 'Loading evidence frame…' : 'No camera frame for this alert (sensor / permit based).'}
                  </div>
                )}
                {view.details?.chains?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={sectionTitle}>Why (knowledge-graph path)</div>
                    {view.details.chains.map((c: string[], i: number) => (
                      <div key={i} style={{ fontSize: 11, color: '#c7d2fe', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>{c.join('  →  ')}</div>
                    ))}
                  </div>
                )}
                {view.details?.aiRecommendation && (
                  <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(0,176,255,0.07)', border: '1px solid rgba(0,176,255,0.2)' }}>
                    <div style={{ fontSize: 10, color: '#00b0ff', fontWeight: 700, marginBottom: 4 }}>🤖 AI RECOMMENDATION</div>
                    <div style={{ fontSize: 12, color: '#c7d2fe', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{view.details.aiRecommendation}</div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={sectionTitle}>Location</div>
                  <div style={{ fontSize: 12, color: '#e8f0ff' }}>{view.zoneName || 'Plant-wide'} {view.zone && <span style={{ color: '#8ba0c4' }}>({view.zone})</span>}</div>
                  {view.cameraId && <div style={{ fontSize: 12, color: '#8ba0c4' }}>Camera {view.cameraId}</div>}
                  {view.location && <div style={{ fontSize: 11, color: '#4a6080', fontFamily: 'JetBrains Mono, monospace' }}>map ({Math.round(view.location.x)}, {Math.round(view.location.y)}) · <Link href="/heatmap" style={{ color: '#00b0ff' }}>view on heatmap</Link></div>}
                </div>
                {view.recommendedActions?.length > 0 && (
                  <div>
                    <div style={sectionTitle}>Recommended actions</div>
                    <ol style={{ paddingLeft: 18, fontSize: 12, color: '#e8f0ff', lineHeight: 1.6 }}>{view.recommendedActions.map((x, i) => <li key={i}>{x}</li>)}</ol>
                  </div>
                )}
                {view.regulations?.length > 0 && (
                  <div>
                    <div style={sectionTitle}>Regulation</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{view.regulations.map(r => <span key={r} className="tag-chip">{r}</span>)}</div>
                  </div>
                )}
                <div>
                  <div style={sectionTitle}>Routed to</div>
                  {view.recipients.map(r => (
                    <div key={r.name + r.role} style={{ fontSize: 12, color: '#e8f0ff' }}>{r.name} <span style={{ color: '#8ba0c4' }}>— {r.role}</span></div>
                  ))}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    {view.deliveries.map((d, i) => (
                      <span key={i} className="tag-chip" style={{ color: d.status === 'failed' ? '#ef4444' : d.status === 'simulated' ? '#ffb300' : '#22c55e' }} title={d.error || ''}>
                        {d.channel}: {d.status}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={sectionTitle}>Timeline</div>
                  <div style={{ fontSize: 11, color: '#8ba0c4', lineHeight: 1.7, fontFamily: 'JetBrains Mono, monospace' }}>
                    <div>detected  {new Date(view.detectedAt).toLocaleTimeString()}</div>
                    <div>alerted   {new Date(view.createdAt).toLocaleTimeString()} ({Math.max(0, (Date.parse(view.createdAt) - Date.parse(view.detectedAt)) / 1000).toFixed(1)}s)</div>
                    {view.acknowledgedAt && <div>ack       {new Date(view.acknowledgedAt).toLocaleTimeString()} by {view.acknowledgedBy}</div>}
                    {view.resolvedAt && <div>resolved  {new Date(view.resolvedAt).toLocaleTimeString()} by {view.resolvedBy}</div>}
                    <div>last seen {ago(view.lastSeenAt)} · {view.occurrences} observation(s)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: 30, color: '#4a6080', textAlign: 'center' }}>Select an alert</div>
        )}
      </div>
    </div>
  );
}

const chip = (on: boolean): React.CSSProperties => ({
  padding: '6px 10px', borderRadius: 16, fontSize: 11, cursor: 'pointer', fontWeight: 600,
  background: on ? 'rgba(0,176,255,0.15)' : 'rgba(10,18,40,0.6)', border: `1px solid ${on ? 'rgba(0,176,255,0.45)' : 'rgba(56,100,200,0.2)'}`,
  color: on ? '#7dd3fc' : '#8ba0c4',
});
const actionBtn = (c: string): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: `${c}1f`, border: `1px solid ${c}66`, color: c,
});
const sectionTitle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 };
