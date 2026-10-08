'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import SiteEditor, { emptyForm } from '@/components/SiteEditor';
import PlantPicker, { type PlantChoice } from '@/components/PlantPicker';

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


/** Real accounts: linked to one plant from the all-India directory (own it, or join a colleague's). */
function RealOnboarding({ onOpen }: { sites: any[] | null; onOpen: (id: string) => Promise<void>; reload: () => Promise<any> }) {
  const [fac, setFac] = useState<any>(null);
  const [choice, setChoice] = useState<PlantChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api('/me/facility', { timeoutMs: 75000 }).then(setFac).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (fac?.status !== 'pending') return;
    const t = setInterval(load, 15000);   // auto-continue as soon as the owner approves
    return () => clearInterval(t);
  }, [fac?.status]);

  const link = async () => {
    if (!choice) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/me/plant', { method: 'POST', json: 'newPlant' in choice ? { newPlant: choice.newPlant } : { directoryId: choice.directoryId } });
      setFac(r);
      if (r.status === 'attached') await onOpen(r.site.id);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  if (!fac) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{err || 'Loading your facility…'}</div>;

  if (fac.status === 'attached') {
    const s = fac.site;
    return (
      <div style={{ maxWidth: 720, margin: '48px auto', padding: 20 }}>
        <div className="feature" style={{ padding: 24 }}>
          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 800 }}>● YOUR FACILITY</div>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '6px 0' }}>{s.name}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.company} · {s.sectorLabel} · {[s.location?.city, s.location?.state].filter(Boolean).join(', ')}</p>
          <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => onOpen(s.id)}>Open live dashboard →</button>
        </div>
      </div>
    );
  }

  if (fac.status === 'pending') {
    const s = fac.site;
    return (
      <div style={{ maxWidth: 720, margin: '48px auto', padding: 20 }}>
        <div className="feature" style={{ padding: 24 }}>
          <div style={{ fontSize: 11, color: '#d97706', fontWeight: 800 }}>⏳ AWAITING APPROVAL</div>
          <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '6px 0' }}>{s.name}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            This plant is already monitored on SafeForge. Your request to join has been sent to the facility owner{s.owner ? ` (${s.owner})` : ''}.
            You will get access as soon as they approve it — this page checks automatically.
          </p>
          <button className="btn-ghost" style={{ marginTop: 12 }} onClick={load}>Check again</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 60px' }}>
      <h1 style={{ fontSize: 24, color: 'var(--text-primary)' }}>Link your plant</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.55 }}>
        Find the plant you work at among industrial plants across India, or add it if it isn&apos;t listed. Your account is linked to <strong>one plant</strong>.
        If you are the first from your plant you become its owner and can invite colleagues; otherwise the owner approves your request.
        Live facilities show <strong>only real data</strong> from the cameras, sensors and systems you connect.
      </p>
      <div className="feature" style={{ padding: 18, marginTop: 18 }}>
        <PlantPicker value={choice} onChange={setChoice} />
        {err && <div style={{ marginTop: 10, color: 'var(--c-red)', fontSize: 13 }}>{err}</div>}
        <button className="btn-primary" style={{ marginTop: 14, width: '100%' }} disabled={!choice || busy} onClick={link}>{busy ? 'Linking…' : 'Link this plant & continue →'}</button>
      </div>
    </div>
  );
}
