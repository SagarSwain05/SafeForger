'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import SiteEditor, { emptyForm } from '@/components/SiteEditor';

const RISK_COLOR: Record<string, string> = { SAFE: '#16a34a', LOW: '#16a34a', ELEVATED: '#d97706', HIGH: '#dc2626', CRITICAL: '#dc2626' };

export default function SitesPage() {
  const { selectSite, siteId, user } = useAuth();
  const router = useRouter();
  const [sites, setSites] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('ALL');
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const load = () => api('/sites', { timeoutMs: 75000 }).then(setSites).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const open = async (id: string) => {
    setOpening(id);
    await selectSite(id);
    router.push('/dashboard');
  };

  const sectors = useMemo(() => [...new Map((sites || []).map(s => [s.sector, s.sectorLabel])).entries()], [sites]);
  const filtered = (sites || []).filter(s =>
    (sector === 'ALL' || s.sector === sector) &&
    (!q || `${s.name} ${s.company} ${s.location?.city} ${s.location?.state}`.toLowerCase().includes(q.toLowerCase())));
  const mine = filtered.filter(s => s.kind === 'custom');
  const sandboxes = filtered.filter(s => s.kind === 'sandbox');
  const presets = filtered.filter(s => s.kind === 'preset');

  if (user && !user.isDemo) return <RealOnboarding sites={sites} onOpen={open} reload={load} />;

  const card = (s: any) => (
    <div key={s.id} className="feature" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderColor: s.id === siteId ? 'var(--accent)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span className="tag-chip" style={{ fontSize: 10 }}>{s.sectorLabel}</span>
        {s.live?.running && <span style={{ fontSize: 10, fontWeight: 700, color: RISK_COLOR[s.live.risk] || 'var(--text-muted)' }}>● LIVE · {s.live.risk || '—'}{s.live.openAlerts ? ` · ${s.live.openAlerts} alerts` : ''}</span>}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{s.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.company}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 {[s.location?.city, s.location?.state].filter(Boolean).join(', ') || '—'}</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.zones} zones · {s.cameras} cameras · {s.sensors} sensors{s.kind === 'custom' ? ` · ${s.canEdit ? 'owner' : 'shared with you'}` : ''}</div>
      <button className="btn-primary" style={{ marginTop: 'auto' }} disabled={!!opening} onClick={() => open(s.id)}>{opening === s.id ? 'Opening…' : s.id === siteId ? 'Continue monitoring →' : 'Monitor this site →'}</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 20px 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, color: 'var(--text-primary)' }}>Welcome{user ? `, ${user.name.split(' ')[0]}` : ''} — choose a site</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Monitor a digital twin of a real Indian facility, the sandbox demo plant, or create your own site with your zones, cameras and contacts.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(c => !c)}>{creating ? 'Close' : '＋ Create a site'}</button>
      </div>

      {creating && (
        <div style={{ marginBottom: 28 }}>
          <SiteEditor initial={emptyForm()} submitLabel="Create site & open"
            onCancel={() => setCreating(false)}
            onSubmit={async (body) => { const s = await api('/sites', { method: 'POST', json: body }); await load(); setCreating(false); await open(s.id); }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input aria-label="Search sites" placeholder="Search by name, company or city…" value={q} onChange={e => setQ(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)', color: 'var(--text-primary)', fontSize: 13, minWidth: 240, flex: '1 1 240px', maxWidth: 360 }} />
        {[['ALL', 'All sectors'], ...sectors].map(([id, label]) => (
          <button key={id} onClick={() => setSector(id)} style={{ padding: '6px 11px', borderRadius: 16, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: sector === id ? 'var(--accent)' : 'var(--bg-subtle)', color: sector === id ? '#fff' : 'var(--text-secondary)' }}>{label}</button>
        ))}
      </div>

      {err && <div style={{ color: 'var(--c-red)', fontSize: 13 }}>{err} — <button className="btn-ghost" onClick={() => { setErr(''); load(); }}>Retry</button></div>}
      {!sites && !err && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading sites… (the server may take a minute to wake)</div>}

      {mine.length > 0 && <Section title="My sites">{mine.map(card)}</Section>}
      {sandboxes.length > 0 && <Section title="Sandbox demo plants" note="Fictional plants with the guided kill-chain demo.">{sandboxes.map(card)}</Section>}
      {presets.length > 0 && (
        <Section title="Real-facility digital twins" note="Public facility names used as templates for demonstration. Telemetry is simulated; SafeForge is not affiliated with these operators. Connect your own cameras on a site you create.">
          {presets.map(card)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontSize: 15, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {note && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{note}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginTop: 12 }}>{children}</div>
    </section>
  );
}


/** Real accounts: one live facility — attach to a real-facility template or set one up from scratch. */
function RealOnboarding({ sites, onOpen, reload }: { sites: any[] | null; onOpen: (id: string) => Promise<void>; reload: () => Promise<any> }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<any>(null);
  const [custom, setCustom] = useState(false);
  const [form, setForm] = useState({ name: '', contactName: '', contactRole: 'Safety Officer', contactEmail: '', members: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api('/sites/templates').then(setTemplates).catch(e => setErr(e.message)); }, []);

  if (sites && sites.length) {
    const s = sites[0];
    return (
      <div style={{ maxWidth: 720, margin: '48px auto', padding: 20 }}>
        <div className="feature" style={{ padding: 24 }}>
          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 800 }}>● YOUR FACILITY</div>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '6px 0' }}>{s.name}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.company} · {s.sectorLabel} · {[s.location?.city, s.location?.state].filter(Boolean).join(', ')}</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Each account is attached to one facility. Everything you see comes from its connected cameras, sensors, SCADA and badges.</p>
          <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => onOpen(s.id)}>Open live dashboard →</button>
        </div>
      </div>
    );
  }

  const create = async (body: any) => {
    setBusy(true); setErr('');
    try { const s = await api('/sites', { method: 'POST', json: body }); await reload(); await onOpen(s.id); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  const filtered = templates.filter(t => !q || `${t.name} ${t.company} ${t.location?.city} ${t.sectorLabel}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 20px 60px' }}>
      <h1 style={{ fontSize: 24, color: 'var(--text-primary)' }}>Set up your facility</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 820, lineHeight: 1.55 }}>
        Your account is attached to <strong>one facility</strong>. Start from a real facility template (zones, hazard classes and PPE rules for that industry are pre-filled) or set one up from scratch.
        Live facilities show <strong>only real data</strong>: CCTV you connect, sensor gateways or handheld readings you log, SCADA and badge feeds — nothing is simulated.
      </p>
      {err && <div style={{ marginTop: 12, color: 'var(--c-red)', fontSize: 13 }}>{err}</div>}

      {!custom && !chosen && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '20px 0 12px', flexWrap: 'wrap' }}>
            <input aria-label="Search facilities" placeholder="Search facility, company or city…" value={q} onChange={e => setQ(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)', color: 'var(--text-primary)', fontSize: 13, minWidth: 260 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>or</span>
            <button className="btn-ghost" onClick={() => setCustom(true)}>＋ Set up a facility from scratch</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
            {filtered.map(t => (
              <button key={t.id} onClick={() => { setChosen(t); setForm(f => ({ ...f, name: t.name })); }} className="feature" style={{ textAlign: 'left', cursor: 'pointer', padding: 14 }}>
                <span className="tag-chip" style={{ fontSize: 10 }}>{t.sectorLabel}</span>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginTop: 8 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.company}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 {t.location?.city}, {t.location?.state}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {chosen && (
        <div className="feature" style={{ padding: 22, marginTop: 20, maxWidth: 720 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Attach your account to</div>
          <h2 style={{ fontSize: 18, color: 'var(--text-primary)' }}>{chosen.name} · {chosen.company}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
            <label className="field">Facility / unit name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Blast Furnace 3 area" /></label>
            <label className="field">Safety contact name<input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></label>
            <label className="field">Contact role
              <select value={form.contactRole} onChange={e => setForm({ ...form, contactRole: e.target.value })}>
                {['Safety Officer', 'Fire & Safety', 'Shift Supervisor', 'Plant Manager', 'Process Engineer', 'Maintenance Lead', 'Instrument Tech'].map(r => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="field">Contact email<input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>Teammates who should see this facility (emails, comma-separated)<input value={form.members} onChange={e => setForm({ ...form, members: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn-ghost" onClick={() => setChosen(null)}>← Back</button>
            <button className="btn-primary" disabled={busy} onClick={() => create({
              templateId: chosen.id, name: form.name || chosen.name,
              contacts: form.contactName ? [{ name: form.contactName, role: form.contactRole, email: form.contactEmail }] : [],
              members: form.members.split(',').map(x => x.trim()).filter(Boolean),
            })}>{busy ? 'Setting up…' : 'Attach & open live dashboard →'}</button>
          </div>
        </div>
      )}

      {custom && (
        <div style={{ marginTop: 20 }}>
          <SiteEditor initial={emptyForm()} submitLabel="Create my facility" onCancel={() => setCustom(false)} onSubmit={create} />
        </div>
      )}
    </div>
  );
}
