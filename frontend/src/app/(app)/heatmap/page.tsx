'use client';

import { useSocket, api } from '@/lib/socket';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// Load Leaflet Map dynamically to prevent Next.js SSR document reference errors
const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: '520px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-panel)', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
      <div style={{ color: 'var(--c-cyan)', fontFamily: 'monospace' }}>⚡ Loading Digital Twin GIS Canvas…</div>
    </div>
  ),
});

const STATUS_COLOR: Record<string, string> = {
  SAFE: '#16a34a', NORMAL: '#16a34a', LOW: '#22c55e',
  WARNING: '#d97706', ELEVATED: '#ea580c', HIGH: '#ef4444', CRITICAL: '#e11d48',
};

function getRiskColor(score: number): string {
  if (score >= 70) return '#e11d48';
  if (score >= 40) return '#ef4444';
  if (score >= 20) return '#ea580c';
  if (score >= 5) return '#d97706';
  return '#16a34a';
}

export default function HeatmapPage() {
  const { sensors, workers, permits, riskData, cvDetections, alerts } = useSocket();
  const [layout, setLayout] = useState<any>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  useEffect(() => {
    api('/plant-layout')
      .then(setLayout)
      .catch(console.error);
  }, []);

  if (!layout) {
    return (
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading plant layout…</div>
      </div>
    );
  }

  // Build zone → sensor readings map
  const sensorsByZone: Record<string, any[]> = {};
  sensors.forEach(s => {
    if (!sensorsByZone[s.zone]) sensorsByZone[s.zone] = [];
    sensorsByZone[s.zone].push(s);
  });

  // Build zone → permits map
  const permitsByZone: Record<string, any[]> = {};
  permits.filter(p => p.status === 'ACTIVE').forEach(p => {
    if (!permitsByZone[p.zone]) permitsByZone[p.zone] = [];
    permitsByZone[p.zone].push(p);
  });

  // Build zone → workers map
  const workersByZone: Record<string, any[]> = {};
  workers.forEach(w => {
    if (!workersByZone[w.zoneId]) workersByZone[w.zoneId] = [];
    workersByZone[w.zoneId].push(w);
  });

  // Zone risk scores come from the backend risk engine (sensors + permits + CCTV + compound rules)
  const zoneRiskScores: Record<string, number> = {};
  const zoneDrivers: Record<string, string[]> = {};
  layout.zones.forEach((zone: any) => {
    const z = riskData?.zoneScores?.[zone.id];
    zoneRiskScores[zone.id] = z?.score ?? 0;
    zoneDrivers[zone.id] = z?.drivers ?? [];
  });

  const selected = layout.zones.find((z: any) => z.id === selectedZone);

  return (
    <div style={{ padding: 24 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 1 }}>
            GEOSPATIAL SAFETY HEATMAP
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Real-time GIS digital twin — {layout.plant.name}</div>
        </div>
        {/* Map Legend */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {[['SAFE', '#16a34a'], ['WARNING', '#d97706'], ['HIGH', '#ef4444'], ['CRITICAL', '#e11d48']].map(([l, c]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              <div style={{ width: 12, height: 12, background: c as string, borderRadius: 3, opacity: 0.7 }} />{l}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <div style={{ width: 10, height: 10, background: '#0ea5e9', borderRadius: '50%' }} /> Workers
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <div style={{ width: 10, height: 10, border: '1.5px solid #16a34a', background: 'var(--bg-panel)', borderRadius: '3px' }} /> Cameras
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <div style={{ width: 14, height: 10, border: '2px dashed #ff4444' }} /> Permits
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        {/* Dynamic Leaflet GIS Container */}
        <div className="glass-card" style={{ padding: 12, position: 'relative' }}>
          <LeafletMap
            sensors={sensors}
            workers={workers}
            permits={permits}
            riskData={riskData}
            layout={layout}
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
            zoneRiskScores={zoneRiskScores}
            vision={cvDetections}
            alerts={alerts}
          />
        </div>

        {/* Sidebar Info Panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selected ? (
            <div className="glass-card" style={{ padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{selected.name}</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>{selected.id} · {selected.type}</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Hazard Class</div>
                <span style={{
                  padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  background: `${selected.color}20`, color: selected.color, border: `1px solid ${selected.color}40`
                }}>{selected.hazardClass}</span>
              </div>
              {/* Zone sensors */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Active Sensors</div>
                {(sensorsByZone[selected.id] ?? []).length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No sensors in zone</div>}
                {(sensorsByZone[selected.id] ?? []).map((s: any) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--bg-hover)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.type}</span>
                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: STATUS_COLOR[s.status] }}>{s.value === null || s.value === undefined ? 'no data' : `${Number(s.value).toFixed(1)} ${s.unit}`}</span>
                  </div>
                ))}
              </div>
              {/* Zone workers */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Risk score {zoneRiskScores[selected.id] ?? 0}/100 — drivers</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(zoneDrivers[selected.id] ?? []).length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Baseline hazard class only</span>}
                  {(zoneDrivers[selected.id] ?? []).map((d: string) => <span key={d} className="tag-chip">{d}</span>)}
                </div>
                {cvDetections[selected.id] && (
                  <div style={{ fontSize: 11, color: 'var(--text-body)', marginTop: 8 }}>
                    📹 {cvDetections[selected.id].camera_id}: {cvDetections[selected.id].worker_count} workers · {cvDetections[selected.id].ppe_violations} PPE violations{cvDetections[selected.id].fire_detected ? ' · 🔥 FIRE' : ''}{cvDetections[selected.id].smoke_detected ? ' · 💨 SMOKE' : ''}
                  </div>
                )}
                {alerts.filter(a => a.zone === selected.id && a.status !== 'RESOLVED').slice(0, 3).map(a => (
                  <a key={a.id} href={`/alerts?id=${a.id}`} style={{ display: 'block', fontSize: 11, color: a.severity === 'CRITICAL' ? '#ff6b6b' : '#d97706', marginTop: 6, textDecoration: 'none' }}>⚠ {a.title} →</a>
                ))}
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Workers in Zone ({(workersByZone[selected.id] ?? []).length})</div>
                {(workersByZone[selected.id] ?? []).slice(0, 4).map((w: any) => (
                  <div key={w.id} style={{ fontSize: 11, color: 'var(--text-primary)', padding: '3px 0' }}>● {w.name} <span style={{ color: 'var(--text-muted)' }}>({w.role})</span></div>
                ))}
              </div>
              {/* Zone permits */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Active Permits ({(permitsByZone[selected.id] ?? []).length})</div>
                {(permitsByZone[selected.id] ?? []).map((p: any) => (
                  <div key={p.id} style={{ fontSize: 11, color: 'var(--c-amber)', padding: '3px 0' }}>{p.icon} {p.typeKey?.replace('_', ' ') || p.type}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                Click a zone on the Leaflet map to inspect status
              </div>
            </div>
          )}

          {/* Zone Risk List */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Zone Risk Scores</h3>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {[...layout.zones].sort((a: any, b: any) => (zoneRiskScores[b.id] ?? 0) - (zoneRiskScores[a.id] ?? 0)).map((zone: any) => {
                const score = zoneRiskScores[zone.id] ?? 0;
                const c = getRiskColor(score);
                return (
                  <div key={zone.id} onClick={() => setSelectedZone(zone.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bg-hover)', cursor: 'pointer' }}>
                    <div style={{ width: 28, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{zone.id}</div>
                    <div style={{ flex: 1, fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zone.name}</div>
                    <div style={{ width: 60 }}>
                      <div style={{ height: 4, background: 'var(--track)', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${score}%`, background: c, borderRadius: 2 }} />
                      </div>
                    </div>
                    <div style={{ width: 24, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: c, textAlign: 'right' }}>{score}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
