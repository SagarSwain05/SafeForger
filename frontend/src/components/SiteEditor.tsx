'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FormError } from './AuthCard';

const PPE_ITEMS = [['helmet', 'Helmet'], ['vest', 'Hi-vis vest'], ['boots', 'Safety footwear'], ['gloves', 'Gloves'], ['goggles', 'Eye protection'], ['mask', 'Mask'], ['ear', 'Ear protection']];
const HAZARDS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SAFE'];
const SOURCE_TYPES = [
  ['browser', 'Browser — upload / sample footage'],
  ['webcam', 'Webcam on the monitoring PC'],
  ['video_url', 'Video URL (MP4 / WebM, CORS-enabled)'],
  ['rtsp', 'RTSP IP camera (via edge agent)'],
];

type Zone = { name: string; hazardClass: string; requiredPPE: string[]; type?: string };
type Camera = { id?: string; label: string; zone: string; sourceType: string; url: string };
type Contact = { name: string; role: string; email: string; phone: string };
type Sensor = { id?: string; type: string; zone: string; label: string };
const SENSOR_TYPES = ['CH4', 'H2S', 'CO', 'O2', 'TEMP', 'PRESSURE'];
export interface SiteForm {
  name: string; company: string; sector: string; city: string; state: string; description: string;
  zones: Zone[]; cameras: Camera[]; contacts: Contact[]; members: string; sensors: Sensor[];
}

export const emptyForm = (): SiteForm => ({ name: '', company: '', sector: '', city: '', state: '', description: '', zones: [], cameras: [], contacts: [], members: '', sensors: [] });

export function formFromSite(site: any): SiteForm {
  return {
    name: site.name, company: site.company || '', sector: site.sector, city: site.location?.city || '', state: site.location?.state || '',
    description: site.description || '',
    zones: site.layout.zones.map((z: any) => ({ name: z.name, hazardClass: z.hazardClass, requiredPPE: z.requiredPPE || [], type: z.type })),
    cameras: site.layout.cameras.map((c: any) => ({ id: c.id, label: c.label, zone: c.zone, sourceType: c.sourceType || 'browser', url: c.url || '' })),
    contacts: site.contacts || [], members: (site.members || []).join(', '),
    sensors: (site.layout.sensors || []).map((x: any) => ({ id: x.id, type: x.type, zone: x.zone, label: x.label || '' })),
  };
}

export default function SiteEditor({ initial, submitLabel, onSubmit, onCancel }: {
  initial: SiteForm; submitLabel: string; onSubmit: (body: any) => Promise<void>; onCancel?: () => void;
}) {
  const [f, setF] = useState<SiteForm>(initial);
  const [step, setStep] = useState(0);
  const [sectors, setSectors] = useState<any[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api('/sectors').then(r => { setSectors(r.sectors); setRoles(r.contactRoles); }).catch(e => setErr(e.message)); }, []);

  // Choosing a sector pre-fills its zone template and default cameras
  const pickSector = (id: string) => {
    const s = sectors.find(x => x.id === id);
    if (!s) return;
    setF(prev => ({
      ...prev, sector: id,
      zones: s.zones.map((z: any) => ({ name: z.name, hazardClass: z.hazardClass, requiredPPE: z.requiredPPE, type: z.type })),
      cameras: prev.cameras.length && prev.sector ? prev.cameras : s.cameras.map((label: string, i: number) => ({ label, zone: ['Z-01', 'Z-03', 'Z-07', 'Z-11', 'Z-13', 'Z-05'][i], sourceType: 'browser', url: '' })),
      sensors: prev.sensors.length && prev.sector ? prev.sensors : (s.sensors || []).map((x: any) => ({ ...x })),
    }));
  };

  const zoneIds = f.zones.map((_, i) => `Z-${String(i + 1).padStart(2, '0')}`);
  const setZone = (i: number, patch: Partial<Zone>) => setF(p => ({ ...p, zones: p.zones.map((z, j) => j === i ? { ...z, ...patch } : z) }));
  const setCam = (i: number, patch: Partial<Camera>) => setF(p => ({ ...p, cameras: p.cameras.map((c, j) => j === i ? { ...c, ...patch } : c) }));
  const setSensor = (i: number, patch: Partial<Sensor>) => setF(p => ({ ...p, sensors: p.sensors.map((c, j) => j === i ? { ...c, ...patch } : c) }));
  const setContact = (i: number, patch: Partial<Contact>) => setF(p => ({ ...p, contacts: p.contacts.map((c, j) => j === i ? { ...c, ...patch } : c) }));

  const canNext = step === 0 ? !!(f.name.trim() && f.sector) : true;
  const steps = ['Details', 'Zones & PPE', 'Cameras', 'Sensors', 'Contacts'];

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await onSubmit({
        name: f.name, company: f.company, sector: f.sector, city: f.city, state: f.state, description: f.description,
        zones: f.zones.map(z => ({ name: z.name, hazardClass: z.hazardClass, requiredPPE: z.requiredPPE })),
        cameras: f.cameras.filter(c => c.label.trim()),
        sensors: f.sensors.filter(x => x.type && x.zone),
        contacts: f.contacts.filter(c => c.name.trim()),
        members: f.members.split(',').map(s => s.trim()).filter(Boolean),
      });
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="feature" style={{ padding: 22 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {steps.map((s, i) => (
          <button key={s} type="button" onClick={() => (i === 0 || f.sector) && setStep(i)}
            style={{ padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: step === i ? 'var(--accent)' : 'var(--bg-subtle)', color: step === i ? '#fff' : 'var(--text-secondary)' }}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label className="field">Site name *<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Ennore Steel Works — Unit 2" /></label>
          <label className="field">Company<input value={f.company} onChange={e => setF({ ...f, company: e.target.value })} /></label>
          <label className="field">Industry sector *
            <select value={f.sector} onChange={e => pickSector(e.target.value)}>
              <option value="">Choose…</option>
              {sectors.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">City<input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} /></label>
          <label className="field">State<input value={f.state} onChange={e => setF({ ...f, state: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Description<textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        </div>
      )}

      {step === 1 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Rename zones to match your plant and set the hazard class and PPE each zone requires. Z-01 is the hot-work-with-flammable-atmosphere zone used by the compound-risk demo; Z-11/Z-12 are confined spaces; Z-15 is the assembly area.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto' }}>
            {f.zones.map((z, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px minmax(140px, 1.4fr) 110px minmax(200px, 2fr)', gap: 8, alignItems: 'center', padding: 8, borderRadius: 8, background: 'var(--bg-subtle)' }} className="zone-row">
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{zoneIds[i]}</span>
                <input aria-label={`${zoneIds[i]} name`} value={z.name} onChange={e => setZone(i, { name: e.target.value })} style={inp} />
                <select aria-label={`${zoneIds[i]} hazard`} value={z.hazardClass} onChange={e => setZone(i, { hazardClass: e.target.value })} style={inp}>{HAZARDS.map(h => <option key={h}>{h}</option>)}</select>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PPE_ITEMS.map(([k, l]) => {
                    const on = z.requiredPPE.includes(k);
                    return <button type="button" key={k} onClick={() => setZone(i, { requiredPPE: on ? z.requiredPPE.filter(x => x !== k) : [...z.requiredPPE, k] })}
                      style={{ fontSize: 10, padding: '3px 7px', borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: on ? 'rgba(2,132,199,0.15)' : 'transparent', color: on ? 'var(--c-cyan)' : 'var(--text-muted)' }}>{on ? '✓ ' : ''}{l}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Each camera maps to a zone, so detections inherit the zone&apos;s PPE rules and appear on the heatmap. Browser and webcam sources run on the Vision AI page; RTSP cameras stream through the Python edge agent (command shown on Site &amp; Cameras after saving).</p>
          {f.cameras.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,1.2fr) minmax(120px,1fr) minmax(170px,1.3fr) minmax(160px,1.6fr) 32px', gap: 8, alignItems: 'center', marginBottom: 8 }} className="zone-row">
              <input aria-label="Camera name" placeholder="Camera name" value={c.label} onChange={e => setCam(i, { label: e.target.value })} style={inp} />
              <select aria-label="Zone" value={c.zone} onChange={e => setCam(i, { zone: e.target.value })} style={inp}>{zoneIds.map((z, j) => <option key={z} value={z}>{z} {f.zones[j]?.name}</option>)}</select>
              <select aria-label="Source type" value={c.sourceType} onChange={e => setCam(i, { sourceType: e.target.value })} style={inp}>{SOURCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input aria-label="Source URL" placeholder={c.sourceType === 'rtsp' ? 'rtsp://user:pass@ip:554/stream' : c.sourceType === 'video_url' ? 'https://…/footage.mp4' : '—'} disabled={!['rtsp', 'video_url'].includes(c.sourceType)} value={c.url} onChange={e => setCam(i, { url: e.target.value })} style={inp} />
              <button type="button" aria-label="Remove camera" onClick={() => setF(p => ({ ...p, cameras: p.cameras.filter((_, j) => j !== i) }))} style={{ ...inp, cursor: 'pointer', padding: 6 }}>✕</button>
            </div>
          ))}
          {f.cameras.length < 16 && <button type="button" className="btn-ghost" onClick={() => setF(p => ({ ...p, cameras: [...p.cameras, { label: `Camera ${p.cameras.length + 1}`, zone: 'Z-01', sourceType: 'browser', url: '' }] }))}>＋ Add camera</button>}
        </div>
      )}

      {step === 3 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Fixed detectors at your facility. Each gets an ID your gateway (or a supervisor logging a handheld reading) reports against. Thresholds follow the type (CH₄ 10/20 %LEL, H₂S 5/10 ppm, CO 25/50 ppm, O₂ 19.5/16 %). Unknown IDs sent by a gateway with a type and zone are added automatically.</p>
          {f.sensors.map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,0.8fr) 110px minmax(130px,1fr) minmax(150px,1.4fr) 32px', gap: 8, marginBottom: 8, alignItems: 'center' }} className="zone-row">
              <input aria-label="Sensor ID" placeholder="auto ID" value={x.id || ''} onChange={e => setSensor(i, { id: e.target.value })} style={inp} />
              <select aria-label="Sensor type" value={x.type} onChange={e => setSensor(i, { type: e.target.value })} style={inp}>{SENSOR_TYPES.map(t => <option key={t}>{t}</option>)}</select>
              <select aria-label="Sensor zone" value={x.zone} onChange={e => setSensor(i, { zone: e.target.value })} style={inp}>{zoneIds.map((z, j) => <option key={z} value={z}>{z} {f.zones[j]?.name}</option>)}</select>
              <input aria-label="Sensor label" placeholder="Label (e.g. Tank vent H₂S)" value={x.label} onChange={e => setSensor(i, { label: e.target.value })} style={inp} />
              <button type="button" aria-label="Remove sensor" onClick={() => setF(p => ({ ...p, sensors: p.sensors.filter((_, j) => j !== i) }))} style={{ ...inp, cursor: 'pointer', padding: 6 }}>✕</button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setF(p => ({ ...p, sensors: [...p.sensors, { type: 'CH4', zone: 'Z-01', label: '' }] }))}>＋ Add sensor</button>
        </div>
      )}

      {step === 4 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Alerts are routed by role — fire alerts to Fire &amp; Safety and the Safety Officer, PPE violations to the Shift Supervisor, and so on. Contacts added here replace the demo roster for those roles.</p>
          {f.contacts.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(140px,1fr) minmax(160px,1.3fr) minmax(110px,0.8fr) 32px', gap: 8, marginBottom: 8 }} className="zone-row">
              <input aria-label="Contact name" placeholder="Name" value={c.name} onChange={e => setContact(i, { name: e.target.value })} style={inp} />
              <select aria-label="Role" value={c.role} onChange={e => setContact(i, { role: e.target.value })} style={inp}>{roles.map(r => <option key={r}>{r}</option>)}</select>
              <input aria-label="Email" placeholder="Email" value={c.email} onChange={e => setContact(i, { email: e.target.value })} style={inp} />
              <input aria-label="Phone" placeholder="Phone" value={c.phone} onChange={e => setContact(i, { phone: e.target.value })} style={inp} />
              <button type="button" aria-label="Remove contact" onClick={() => setF(p => ({ ...p, contacts: p.contacts.filter((_, j) => j !== i) }))} style={{ ...inp, cursor: 'pointer', padding: 6 }}>✕</button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setF(p => ({ ...p, contacts: [...p.contacts, { name: '', role: roles[0] || 'Safety Officer', email: '', phone: '' }] }))}>＋ Add contact</button>
          <label className="field" style={{ marginTop: 16 }}>Share with teammates (emails, comma-separated)
            <input value={f.members} onChange={e => setF({ ...f, members: e.target.value })} placeholder="supervisor@plant.com, hse@plant.com" />
          </label>
        </div>
      )}

      <div style={{ marginTop: 18 }}><FormError msg={err} /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
        {step > 0 && <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>← Back</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {step < 4 && <button type="button" className="btn-ghost" disabled={!canNext} onClick={() => setStep(step + 1)}>Next →</button>}
          <button type="button" className="btn-primary" disabled={busy || !f.name.trim() || !f.sector} onClick={submit}>{busy ? 'Saving…' : submitLabel}</button>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, minWidth: 0 };
