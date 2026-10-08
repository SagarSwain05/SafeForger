'use client';
import { apiFetch } from '@/lib/api';
import { useSocket, API_URL } from '@/lib/socket';
import { useState } from 'react';

const PERMIT_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  HOT_WORK: { label: 'Hot Work', icon: '🔥', color: '#ff4444' },
  COLD_WORK: { label: 'Cold Work', icon: '🔧', color: '#4488ff' },
  CONFINED_SPACE: { label: 'Confined Space Entry', icon: '🕳️', color: '#ff8844' },
  ELECTRICAL_ISOLATION: { label: 'Electrical Isolation', icon: '⚡', color: '#ca8a04' },
  HEIGHT_WORK: { label: 'Work at Height', icon: '🏗️', color: '#16a34a' },
  RADIATION: { label: 'Radiography Work', icon: '☢️', color: '#ff44ff' },
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#16a34a', PENDING: '#d97706', CLOSED: 'var(--text-muted)', REJECTED: '#ff4444',
};

export default function PermitsPage() {
  const { permits } = useSocket();
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [form, setForm] = useState({ type: 'HOT_WORK', zone: 'Z-01', requestedBy: '', description: '', durationHours: 4 });
  const [validation, setValidation] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');

  const handleValidate = async () => {
    setValidating(true); setValidation(null);
    try {
      const r = await apiFetch(`/permits/${form.type}/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      setValidation(await r.json());
    } catch { setValidation({ canApprove: false, aiAnalysis: 'Could not reach server.' }); }
    setValidating(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await apiFetch(`/permits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      setSuccess('Permit submitted successfully and is pending approval.');
      setTab('list');
      setForm({ type: 'HOT_WORK', zone: 'Z-01', requestedBy: '', description: '', durationHours: 4 });
      setValidation(null);
    } catch { }
    setSubmitting(false);
  };

  const [statusError, setStatusError] = useState('');
  const handleStatus = async (id: string, status: string) => {
    setStatusError('');
    const r = await apiFetch(`/permits/${id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, by: 'Shift Supervisor' })
    });
    if (r.status === 409) {
      const body = await r.json();
      setStatusError(`${id} blocked by permit intelligence: ${(body.validation?.violations ?? []).map((v: any) => v.message).join(' ')}`);
    }
  };

  const active = permits.filter(p => p.status === 'ACTIVE');
  const pending = permits.filter(p => p.status === 'PENDING');
  const closed = permits.filter(p => p.status === 'CLOSED');

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 1 }}>PERMIT-TO-WORK</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>AI-validated digital permit management · OISD-STD-105 compliant</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['list', 'new'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: tab === t ? 'rgba(0,176,255,0.15)' : 'var(--bg-subtle)',
              border: `1px solid ${tab === t ? 'rgba(0,176,255,0.4)' : 'var(--border-subtle)'}`,
              color: tab === t ? '#0ea5e9' : 'var(--text-secondary)',
            }}>{t === 'list' ? '📋 All Permits' : '+ New Permit'}</button>
          ))}
        </div>
      </div>

      {statusError && (
        <div style={{ marginBottom: 16, padding: 12, background: 'rgba(255,23,68,0.1)', border: '1px solid rgba(255,23,68,0.3)', borderRadius: 8, color: 'var(--c-red-soft)', fontSize: 13 }}>🚫 {statusError}</div>
      )}
      {success && (
        <div style={{ marginBottom: 16, padding: 12, background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)', borderRadius: 8, color: 'var(--c-green)', fontSize: 13 }}>✓ {success}</div>
      )}

      {tab === 'list' ? (
        <div>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[['ACTIVE', active.length, '#16a34a'], ['PENDING', pending.length, '#d97706'], ['CLOSED', closed.length, 'var(--text-muted)']].map(([s, n, c]) => (
              <div key={String(s)} className="glass-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>{s}</div>
                <div style={{ fontSize: 32, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: String(c) }}>{n}</div>
              </div>
            ))}
          </div>

          {/* Active Permits */}
          {active.length > 0 && (
            <>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Active Permits</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 20 }}>
                {active.map(p => {
                  const pt = PERMIT_TYPES[p.typeKey ?? p.type];
                  return (
                    <div key={p.id} className="glass-card" style={{ padding: 18, borderColor: `${pt?.color ?? '#d97706'}30` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: pt?.color ?? '#fff' }}>{pt?.icon} {pt?.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.id}</div>
                        </div>
                        <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: 'rgba(0,230,118,0.1)', color: 'var(--c-green)', border: '1px solid rgba(0,230,118,0.3)' }}>ACTIVE</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 10 }}>{p.title || p.description}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                        {[['Zone', p.zoneName || p.zone], ['Requested By', p.requestedBy], ['Duration', `${p.durationHours}h`], ['Elapsed', `${p.elapsedMinutes ?? 0}m`]].map(([k, v]) => (
                          <div key={k}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{k}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {(p.aiWarnings?.length ?? 0) > 0 && (
                        <div style={{ marginBottom: 10, padding: 8, background: 'rgba(255,179,0,0.08)', borderRadius: 6, border: '1px solid rgba(255,179,0,0.2)' }}>
                          {p.aiWarnings.map((w: string, i: number) => <div key={i} style={{ fontSize: 11, color: 'var(--c-amber)' }}>⚠ {w}</div>)}
                        </div>
                      )}
                      <button onClick={() => handleStatus(p.id, 'CLOSED')} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid rgba(255,68,68,0.3)', background: 'rgba(255,68,68,0.08)', color: 'var(--c-red-soft)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Close Permit
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-amber)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Pending Approval</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pending.map(p => {
                  const pt = PERMIT_TYPES[p.typeKey ?? p.type];
                  return (
                    <div key={p.id} className="glass-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, borderColor: 'rgba(255,179,0,0.2)' }}>
                      <span style={{ fontSize: 22 }}>{pt?.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.title || pt?.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.id} · {p.zoneName || p.zone} · {p.requestedBy}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleStatus(p.id, 'ACTIVE')} style={{ padding: '6px 14px', borderRadius: 6, background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)', color: 'var(--c-green)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Approve</button>
                        <button onClick={() => handleStatus(p.id, 'REJECTED')} style={{ padding: '6px 14px', borderRadius: 6, background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.2)', color: 'var(--c-red-soft)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reject</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {active.length === 0 && pending.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div>No permits found. Create a new permit to get started.</div>
            </div>
          )}
        </div>
      ) : (
        /* New Permit Form */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>New Permit Request</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Permit Type *</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }}>
                  {Object.entries(PERMIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Work Zone *</label>
                <select value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }}>
                  {['Z-01','Z-02','Z-03','Z-04','Z-05','Z-06','Z-07','Z-08','Z-09','Z-10','Z-11','Z-12','Z-13','Z-14','Z-15'].map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Requested By *</label>
                <input value={form.requestedBy} onChange={e => setForm(f => ({ ...f, requestedBy: e.target.value }))}
                  placeholder="Engineer / Technician name"
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Duration (hours)</label>
                <input type="number" value={form.durationHours} min={1} max={12}
                  onChange={e => setForm(f => ({ ...f, durationHours: Number(e.target.value) }))}
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Work Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Describe the work to be performed…"
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleValidate} disabled={validating} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid rgba(0,176,255,0.4)', background: 'rgba(0,176,255,0.1)', color: 'var(--c-cyan)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {validating ? '🤖 Validating…' : '🤖 AI Validate'}
                </button>
                <button onClick={handleSubmit} disabled={submitting || (validation !== null && !validation?.canApprove)} style={{
                  flex: 1, padding: 12, borderRadius: 8, border: '1px solid rgba(0,230,118,0.4)',
                  background: 'rgba(0,230,118,0.1)', color: 'var(--c-green)', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', opacity: (validation !== null && !validation?.canApprove) ? 0.5 : 1,
                }}>
                  {submitting ? 'Submitting…' : '✓ Submit Permit'}
                </button>
              </div>
            </div>
          </div>

          {/* AI Validation Panel */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16 }}>🤖 AI Safety Validation</h2>
            {!validation && !validating && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 40, lineHeight: 1.6 }}>
                Click <strong style={{ color: 'var(--c-cyan)' }}>AI Validate</strong> to check this permit against:
                <br />• Live sensor readings
                <br />• Active simultaneous operations
                <br />• OISD/DGMS regulations
              </div>
            )}
            {validating && <div style={{ color: 'var(--c-cyan)', fontSize: 13, textAlign: 'center', padding: 40 }}>🔍 Analyzing live plant conditions…</div>}
            {validation && (
              <div>
                <div style={{ padding: 14, borderRadius: 10, marginBottom: 16, background: validation.canApprove ? 'rgba(0,230,118,0.1)' : 'rgba(255,23,68,0.1)', border: `1px solid ${validation.canApprove ? 'rgba(0,230,118,0.3)' : 'rgba(255,23,68,0.3)'}` }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: validation.canApprove ? '#16a34a' : '#e11d48', marginBottom: 8 }}>
                    {validation.canApprove ? '✅ APPROVED — Safe to proceed' : '🚫 BLOCKED — Safety violation detected'}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{validation.aiAnalysis}</p>
                </div>
                {(validation.violations ?? []).map((v: any, i: number) => (
                  <div key={i} style={{ padding: 10, background: 'rgba(255,23,68,0.08)', borderRadius: 6, border: '1px solid rgba(255,68,68,0.2)', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#ff4444' }}>{v.rule}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{v.message}</div>
                  </div>
                ))}
                {(validation.warnings ?? []).map((w: any, i: number) => (
                  <div key={i} style={{ padding: 10, background: 'rgba(255,179,0,0.08)', borderRadius: 6, border: '1px solid rgba(255,179,0,0.2)', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-amber)' }}>{w.rule}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{w.message}</div>
                  </div>
                ))}
                {(validation.applicableRegs ?? []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Applicable Regulations:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {validation.applicableRegs.map((r: string) => <span key={r} className="tag-chip">{r}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
