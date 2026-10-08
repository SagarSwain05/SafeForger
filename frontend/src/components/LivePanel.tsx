'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';

type Conn = {
  mode: string;
  cctv: { configured: number; online: number };
  sensors: { configured: number; online: number; lastReading: number | null };
  scada: { connected: boolean; equipment: number };
  presence: { people: number };
  permits: { active: number; total: number };
};

/** Live sites: what is actually connected, plus manual entry of handheld gas-test readings. */
export default function LivePanel() {
  const { sensors } = useSocket();
  const [c, setC] = useState<Conn | null>(null);
  const [sensorId, setSensorId] = useState('');
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => api<Conn>('/connections').then(setC).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (!sensorId && sensors.length) setSensorId(sensors[0].id); }, [sensors, sensorId]);

  const log = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      await api('/telemetry', { method: 'POST', json: { sensorId, value: Number(value) } });
      setMsg(`Logged ${value} for ${sensorId}`); setValue('');
    } catch (err: any) { setMsg(err.message); }
    setBusy(false);
  };

  const tile = (label: string, ok: boolean, main: string, sub: string, href: string, cta: string) => (
    <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-subtle)', border: `1px solid ${ok ? 'rgba(22,163,74,0.35)' : 'var(--border-subtle)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        <span>{label}</span><span style={{ color: ok ? '#16a34a' : '#94a3b8', fontWeight: 800 }}>{ok ? '● LIVE' : '○ NOT CONNECTED'}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>{main}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</div>
      <Link href={href} style={{ display: 'inline-block', marginTop: 6, fontSize: 11, color: 'var(--c-cyan)' }}>{cta} →</Link>
    </div>
  );

  return (
    <div className="glass-card" style={{ padding: 16, marginBottom: 20, borderColor: 'rgba(14,165,233,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-cyan)', textTransform: 'uppercase', letterSpacing: 1 }}>Live data connections</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Everything on this dashboard comes from these inputs — nothing is simulated</span>
      </div>
      {!c ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking connections…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          {tile('CCTV', c.cctv.online > 0, `${c.cctv.online}/${c.cctv.configured}`, 'cameras streaming', '/vision', 'Start a camera')}
          {tile('Gas & process sensors', c.sensors.online > 0, `${c.sensors.online}/${c.sensors.configured}`, c.sensors.lastReading ? `last reading ${new Date(c.sensors.lastReading).toLocaleTimeString()}` : 'no readings yet', '/site', 'Connect a gateway')}
          {tile('SCADA', c.scada.connected, `${c.scada.equipment}`, 'equipment reporting', '/site', 'Connect SCADA')}
          {tile('People on site', c.presence.people > 0, `${c.presence.people}`, 'from badges + CCTV', '/site', 'Connect badges')}
          {tile('Permits', c.permits.active > 0, `${c.permits.active}`, `active · ${c.permits.total} total`, '/permits', 'Raise a permit')}
        </div>
      )}
      <form onSubmit={log} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Log a handheld reading</span>
        <select aria-label="Sensor" value={sensorId} onChange={e => setSensorId(e.target.value)} style={inp}>
          {sensors.map(s => <option key={s.id} value={s.id}>{s.id} · {s.label || s.type} ({s.zone}, {s.unit})</option>)}
        </select>
        <input aria-label="Value" type="number" step="any" required value={value} onChange={e => setValue(e.target.value)} placeholder="value" style={{ ...inp, width: 110 }} />
        <button className="btn-primary" disabled={busy || !sensorId} style={{ padding: '7px 14px' }}>{busy ? 'Saving…' : 'Log reading'}</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{msg}</span>}
      </form>
    </div>
  );
}

const inp: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, maxWidth: '100%' };
