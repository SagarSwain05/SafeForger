'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import SiteEditor, { formFromSite } from '@/components/SiteEditor';

const SOURCE_LABEL: Record<string, string> = { browser: 'Browser (upload / samples)', webcam: 'Webcam', video_url: 'Video URL', rtsp: 'RTSP via edge agent' };

export default function SitePage() {
  const { site, refreshSite, selectSite } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [msg, setMsg] = useState('');
  if (!site) return null;
  const s = site;

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setMsg(`${what} copied`); } catch { setMsg('Copy failed — select and copy manually'); }
    setTimeout(() => setMsg(''), 2500);
  };

  const agentCmd = (cam: any) => [
    'cd cv-service && pip install -r requirements.txt',
    `python main.py --backend-url ${API_URL} --site ${s.id} --api-key ${showKey ? s.ingestKey : '<INGEST_KEY>'} --camera ${cam.id} --source "${cam.url || 'rtsp://user:pass@camera-ip:554/stream'}"`,
  ].join('\n');

  const duplicate = async () => {
    const body = { ...formFromSite(s), name: `${s.name} (my site)`, members: [] };
    const created = await api('/sites', { method: 'POST', json: body });
    await selectSite(created.id);
    setMsg('Created your editable copy');
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${s.name}? This cannot be undone.`)) return;
    await api(`/sites/${s.id}`, { method: 'DELETE' });
    await selectSite(null);
    router.push('/sites');
  };

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 1 }}>SITE &amp; CAMERAS</h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{s.name} · {s.company} · {s.sectorLabel} · {[s.location?.city, s.location?.state].filter(Boolean).join(', ')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {s.canEdit && <button className="btn-primary" onClick={() => setEditing(e => !e)}>{editing ? 'Close editor' : '✎ Edit site'}</button>}
          {!s.canEdit && <button className="btn-primary" onClick={duplicate}>⧉ Make my own editable copy</button>}
          {s.canEdit && <button className="btn-ghost" onClick={remove} style={{ color: 'var(--c-red)' }}>Delete</button>}
        </div>
      </div>
      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--c-green)' }}>✓ {msg}</div>}
      {s.kind !== 'custom' && (
        <div className="glass-card" style={{ padding: 12, marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          {s.kind === 'sandbox' ? 'Fictional sandbox plant with simulated data (demo account).' : 'Digital twin based on a public facility name — simulated telemetry for the demo account, not affiliated with the operator.'} Make an editable copy to rename zones and cameras.
        </div>
      )}

      {editing && s.canEdit && (
        <div style={{ marginBottom: 22 }}>
          <SiteEditor initial={formFromSite(s)} submitLabel="Save changes" onCancel={() => setEditing(false)}
            onSubmit={async (body) => { await api(`/sites/${s.id}`, { method: 'PATCH', json: body }); await refreshSite(); setEditing(false); setMsg('Site updated — the plant runtime reloaded with the new layout'); }} />
        </div>
      )}

      <div className="detail-grid">
        <section className="glass-card" style={{ padding: 16 }}>
          <h2 style={h2}>Cameras ({s.layout.cameras.length})</h2>
          {s.layout.cameras.map((c: any) => {
            const zone = s.layout.zones.find((z: any) => z.id === c.zone);
            return (
              <div key={c.id} style={{ padding: 10, borderRadius: 8, background: 'var(--bg-subtle)', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.id} · {c.label}</strong>
                  <span className="tag-chip" style={{ fontSize: 10 }}>{SOURCE_LABEL[c.sourceType] || c.sourceType}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{c.zone} · {zone?.name} · PPE: {(zone?.requiredPPE || []).join(', ') || 'none'}</div>
                {c.url && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 3, wordBreak: 'break-all' }}>{c.sourceType === 'rtsp' ? c.url.replace(/\/\/[^@/]*@/, '//***@') : c.url}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {c.sourceType !== 'rtsp' && <Link href={`/vision?camera=${c.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}>🎯 Analyse in Vision AI</Link>}
                  {c.sourceType === 'rtsp' && <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => copy(agentCmd(c), 'Edge-agent command')}>⧉ Copy edge-agent command</button>}
                </div>
                {c.sourceType === 'rtsp' && <pre style={pre}>{agentCmd(c)}</pre>}
              </div>
            );
          })}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="glass-card" style={{ padding: 16 }}>
            <h2 style={h2}>Connect CCTV / edge devices</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              IP cameras (RTSP) are analysed next to the NVR by the SafeForge Python edge agent — raw video never leaves the site; only detections and evidence frames are sent here.
              Webcams, uploaded clips and CORS-enabled video URLs are analysed directly in the browser on the Vision AI page.
            </p>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>Site ID</div>
            <code style={codeBox}>{s.id}</code>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>Ingest key (keep secret)</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <code style={{ ...codeBox, flex: 1 }}>{showKey ? s.ingestKey : '•'.repeat(24)}</code>
              <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
              <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => copy(s.ingestKey || '', 'Ingest key')}>Copy</button>
            </div>
            {s.canEdit && <button className="btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={async () => { await api(`/sites/${s.id}`, { method: 'PATCH', json: { rotateKey: true } }); await refreshSite(); setMsg('Ingest key rotated — update your edge agents'); }}>↻ Rotate key</button>}
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>Ingest endpoint</div>
            <code style={codeBox}>POST {API_URL}/api/sites/{s.id}/vision/detections</code>
          </section>

          {s.mode === 'live' && (
            <section className="glass-card" style={{ padding: 16, borderColor: 'rgba(22,163,74,0.35)' }}>
              <h2 style={h2}>Real-time inputs</h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                This facility is <strong>live</strong>: every value on the dashboard comes from these feeds. Send them from your gas-detection controller, SCADA/historian or access-control system (or a small gateway script) using the ingest key. Detectors that stop reporting for 2 minutes show as OFFLINE.
              </p>
              {[
                ['Gas / process sensors', 'telemetry', `{"readings":[{"sensorId":"${s.layout.sensors[0]?.id || 'S-GAS-01'}","value":4.2}]}`],
                ['SCADA equipment states', 'scada', '{"equipment":[{"id":"P-101","label":"Charge pump","zone":"Z-01","state":"RUNNING","value":1480,"unit":"RPM"}]}'],
                ['Badge / RFID presence', 'presence', '{"workers":[{"id":"B-1042","name":"A. Kumar","role":"Fitter","zone":"Z-07"}]}'],
              ].map(([label, ep, body]) => {
                const cmd = [`curl -X POST ${API_URL}/api/sites/${s.id}/${ep} \\`, `  -H "Content-Type: application/json" -H "X-API-Key: ${showKey ? s.ingestKey : '<INGEST_KEY>'}" \\`, `  -d '${body}'`].join('\n');
                return (
                  <div key={ep} style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-primary)', fontWeight: 700 }}>
                      {label}<button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => copy(cmd, `${label} example`)}>Copy</button>
                    </div>
                    <pre style={pre}>{cmd}</pre>
                  </div>
                );
              })}
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                Or run the bundled gateway (CSV replay or Modbus TCP polling): <code style={{ ...codeBox, display: 'inline', padding: '1px 6px' }}>python cv-service/telemetry_gateway.py --site {s.id} --api-key &lt;key&gt; --modbus 10.0.0.5:502 --map registers.json</code>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>Supervisors can also log handheld gas-test readings from the Command Center.</div>
            </section>
          )}

          <section className="glass-card" style={{ padding: 16 }}>
            <h2 style={h2}>Sensors ({s.layout.sensors.length})</h2>
            {s.layout.sensors.map((x: any) => (
              <div key={x.id} style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '3px 0' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>{x.id}</span> · {x.type} · {x.label} · {x.zone}
              </div>
            ))}
          </section>

          <section className="glass-card" style={{ padding: 16 }}>
            <h2 style={h2}>Emergency contacts</h2>
            {(s.contacts || []).length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Using the demo shift roster. {s.canEdit ? 'Edit the site to add your own contacts.' : ''}</div>}
            {(s.contacts || []).map((c: any, i: number) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text-body)', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <strong>{c.name}</strong> — {c.role}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}
              </div>
            ))}
          </section>

          <section className="glass-card" style={{ padding: 16 }}>
            <h2 style={h2}>Zones</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {s.layout.zones.map((z: any) => (
                <div key={z.id} style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>{z.id}</span> {z.name} <span style={{ color: z.hazardClass === 'CRITICAL' || z.hazardClass === 'HIGH' ? 'var(--c-red)' : 'var(--text-muted)' }}>· {z.hazardClass}</span></div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 };
const codeBox: React.CSSProperties = { display: 'block', padding: '7px 10px', borderRadius: 7, background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', fontSize: 11, color: 'var(--text-body)', wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace' };
const pre: React.CSSProperties = { ...codeBox, marginTop: 8, whiteSpace: 'pre-wrap' };
