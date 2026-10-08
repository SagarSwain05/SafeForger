'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface Plant { id: string; name: string; operator: string; sector: string; sectorLabel: string; type: string; district: string; state: string; lat: number | null; lng: number | null; source: string; estate?: boolean }
export type PlantChoice = { directoryId: string; plant: Plant } | { newPlant: { name: string; organization: string; sector: string; district: string; state: string } };
interface Meta { total: number; sectors: { id: string; label: string; count: number }[]; states: { name: string; count: number }[]; attribution: string }

const SOURCE: Record<string, string> = { wikidata: 'Wikidata', osm: 'OpenStreetMap', user: 'Added by users', curated: 'Verified' };

/** Search the all-India plant directory, or add a plant that isn't listed. */
export default function PlantPicker({ value, onChange }: { value: PlantChoice | null; onChange: (c: PlantChoice | null) => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [sector, setSector] = useState('');
  const [results, setResults] = useState<Plant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [np, setNp] = useState({ name: '', organization: '', sector: 'manufacturing', district: '', state: '' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { api<Meta>('/directory/meta', { timeoutMs: 75000 }).then(setMeta).catch(() => {}); }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim() && !state && !sector) { setResults([]); setTotal(0); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ total: number; results: Plant[] }>(`/directory/search?q=${encodeURIComponent(q)}&state=${encodeURIComponent(state)}&sector=${sector}&limit=30`, { timeoutMs: 75000 });
        setResults(r.results); setTotal(r.total);
      } catch { setResults([]); }
      setLoading(false);
    }, 220);
  }, [q, state, sector]);

  if (value) {
    const isNew = 'newPlant' in value;
    const p = isNew ? null : value.plant;
    return (
      <div style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(22,163,74,0.45)', background: 'rgba(22,163,74,0.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#16a34a' }}>✓ {isNew ? 'NEW PLANT — WILL BE ADDED TO THE DIRECTORY' : 'YOUR PLANT'}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{isNew ? value.newPlant.name : p!.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {isNew ? [value.newPlant.organization, value.newPlant.district, value.newPlant.state].filter(Boolean).join(' · ') : [p!.operator, p!.type, [p!.district, p!.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
        </div>
        <button type="button" className="btn-ghost" style={{ marginTop: 8, padding: '5px 10px', fontSize: 12 }} onClick={() => onChange(null)}>Change plant</button>
      </div>
    );
  }

  return (
    <div>
      {!adding ? (
        <>
          <input aria-label="Search your plant" autoComplete="off" placeholder={`Search ${meta ? meta.total.toLocaleString('en-IN') + ' ' : ''}plants across India — name, company or city…`}
            value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <select aria-label="State" value={state} onChange={e => setState(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px', padding: '7px 9px', fontSize: 12 }}>
              <option value="">All states</option>
              {meta?.states.map(s => <option key={s.name} value={s.name}>{s.name}{s.count ? ` (${s.count})` : ''}</option>)}
            </select>
            <select aria-label="Sector" value={sector} onChange={e => setSector(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px', padding: '7px 9px', fontSize: 12 }}>
              <option value="">All sectors</option>
              {meta?.sectors.map(s => <option key={s.id} value={s.id}>{s.label} ({s.count})</option>)}
            </select>
          </div>
          <div role="listbox" aria-label="Matching plants" style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto', borderRadius: 10, border: results.length ? '1px solid var(--border-subtle)' : 'none' }}>
            {results.map(p => (
              <button type="button" role="option" aria-selected={false} key={p.id} onClick={() => onChange({ directoryId: p.id, plant: p })}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px', border: 'none', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{p.name}</span>
                  <span className="tag-chip" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{p.sectorLabel}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {[p.operator, p.type, [p.district, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  <span style={{ color: 'var(--text-muted)' }}> · {SOURCE[p.source] || p.source}</span>
                </div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {loading ? 'Searching…' : (q || state || sector) ? `${total.toLocaleString('en-IN')} match${total === 1 ? '' : 'es'}${total > results.length ? ` — showing ${results.length}, refine your search` : ''}` : 'Start typing to find your plant.'}
          </div>
          <button type="button" className="btn-ghost" style={{ marginTop: 8, width: '100%' }} onClick={() => { setAdding(true); setNp(n => ({ ...n, name: q, state })); }}>
            Can&apos;t find your plant? ＋ Add your organisation / plant
          </button>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Plant / site name *<input value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} placeholder="e.g. Sri Lakshmi Textiles, Unit 3" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Organisation / company<input value={np.organization} onChange={e => setNp({ ...np, organization: e.target.value })} /></label>
          <label className="field">Industry sector *
            <select value={np.sector} onChange={e => setNp({ ...np, sector: e.target.value })}>{meta?.sectors.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
          <label className="field">State *
            <select value={np.state} onChange={e => setNp({ ...np, state: e.target.value })}><option value="">Choose…</option>{meta?.states.map(s => <option key={s.name}>{s.name}</option>)}</select>
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>District / city<input value={np.district} onChange={e => setNp({ ...np, district: e.target.value })} /></label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>← Back to search</button>
            <button type="button" className="btn-primary" disabled={np.name.trim().length < 3 || !np.state || !np.sector} onClick={() => onChange({ newPlant: { ...np, name: np.name.trim() } })}>Use this plant</button>
          </div>
        </div>
      )}
      {meta?.attribution && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>Directory data: {meta.attribution}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)', color: 'var(--text-primary)', fontSize: 14 };
