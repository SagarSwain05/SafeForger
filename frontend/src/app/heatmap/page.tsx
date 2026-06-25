'use client';

import { useSocket } from '@/lib/socket';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// Load Leaflet Map dynamically to prevent Next.js SSR document reference errors
const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: '520px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,9,20,0.9)', borderRadius: '10px', border: '1px solid rgba(56, 100, 200, 0.15)' }}>
      <div style={{ color: '#00b0ff', fontFamily: 'monospace' }}>⚡ Loading Digital Twin GIS Canvas…</div>
    </div>
  ),
});

const STATUS_COLOR: Record<string, string> = {
  SAFE: '#00e676', NORMAL: '#00e676', LOW: '#69f0ae',
  WARNING: '#ffb300', ELEVATED: '#ff8f00', HIGH: '#ff5252', CRITICAL: '#ff1744',
};

function getRiskColor(score: number): string {
  if (score >= 70) return '#ff1744';
  if (score >= 40) return '#ff5252';
  if (score >= 20) return '#ff8f00';
  if (score >= 5) return '#ffb300';
  return '#00e676';
}

export default function HeatmapPage() {
  const { sensors, workers, permits, riskData } = useSocket();
  const [layout, setLayout] = useState<any>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'}/api/plant-layout`)
      .then(r => r.json())
      .then(setLayout)
      .catch(console.error);
  }, []);

  if (!layout) {
    return (
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div style={{ color: '#4a6080' }}>Loading plant layout…</div>
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

  // Alert zones from risk engine
  const alertZones = new Set<string>();
  (riskData?.alerts ?? []).forEach((a: any) => (a.affectedZones ?? []).forEach((z: string) => alertZones.add(z)));

  // Calculate zone risk scores
  const zoneRiskScores: Record<string, number> = {};
  layout.zones.forEach((zone: any) => {
    const zoneSensors = sensorsByZone[zone.id] ?? [];
    const zonePermits = permitsByZone[zone.id] ?? [];
    let score = 0;
    zoneSensors.forEach(s => {
      if (s.status === 'CRITICAL') score += 30;
      else if (s.status === 'WARNING') score += 15;
    });
    if (zonePermits.some(p => p.type === 'HOT_WORK')) score += 20;
    if (zonePermits.some(p => p.type === 'CONFINED_SPACE')) score += 15;
    if (alertZones.has(zone.id)) score += 25;
    zoneRiskScores[zone.id] = Math.min(100, score);
  });

  const selected = layout.zones.find((z: any) => z.id === selectedZone);

  return (
    <div style={{ padding: 24 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>
            GEOSPATIAL SAFETY HEATMAP
          </h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Real-time GIS digital twin — {layout.plant.name}</div>
        </div>
        {/* Map Legend */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {[['SAFE', '#00e676'], ['WARNING', '#ffb300'], ['HIGH', '#ff5252'], ['CRITICAL', '#ff1744']].map(([l, c]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8ba0c4' }}>
              <div style={{ width: 12, height: 12, background: c as string, borderRadius: 3, opacity: 0.7 }} />{l}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8ba0c4' }}>
            <div style={{ width: 10, height: 10, background: '#00b0ff', borderRadius: '50%' }} /> Workers
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8ba0c4' }}>
            <div style={{ width: 10, height: 10, border: '1.5px solid #00e676', background: 'rgba(8,15,30,0.85)', borderRadius: '3px' }} /> Cameras
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8ba0c4' }}>
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
          />
        </div>

        {/* Sidebar Info Panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selected ? (
            <div className="glass-card" style={{ padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e8f0ff', marginBottom: 4 }}>{selected.name}</h3>
              <div style={{ fontSize: 11, color: '#4a6080', marginBottom: 12 }}>{selected.id} · {selected.type}</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#8ba0c4', marginBottom: 6 }}>Hazard Class</div>
                <span style={{
                  padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  background: `${selected.color}20`, color: selected.color, border: `1px solid ${selected.color}40`
                }}>{selected.hazardClass}</span>
              </div>
              {/* Zone sensors */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#8ba0c4', marginBottom: 6 }}>Active Sensors</div>
                {(sensorsByZone[selected.id] ?? []).length === 0 && <div style={{ fontSize: 11, color: '#4a6080' }}>No sensors in zone</div>}
                {(sensorsByZone[selected.id] ?? []).map((s: any) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(56,100,200,0.08)' }}>
                    <span style={{ fontSize: 11, color: '#8ba0c4' }}>{s.type}</span>
                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: STATUS_COLOR[s.status] }}>{s.value?.toFixed(1)} {s.unit}</span>
                  </div>
                ))}
              </div>
              {/* Zone workers */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#8ba0c4', marginBottom: 6 }}>Workers in Zone ({(workersByZone[selected.id] ?? []).length})</div>
                {(workersByZone[selected.id] ?? []).slice(0, 4).map((w: any) => (
                  <div key={w.id} style={{ fontSize: 11, color: '#e8f0ff', padding: '3px 0' }}>● {w.name} <span style={{ color: '#4a6080' }}>({w.role})</span></div>
                ))}
              </div>
              {/* Zone permits */}
              <div>
                <div style={{ fontSize: 11, color: '#8ba0c4', marginBottom: 6 }}>Active Permits ({(permitsByZone[selected.id] ?? []).length})</div>
                {(permitsByZone[selected.id] ?? []).map((p: any) => (
                  <div key={p.id} style={{ fontSize: 11, color: '#ffb300', padding: '3px 0' }}>{p.icon} {p.typeKey?.replace('_', ' ') || p.type}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: '#4a6080', textAlign: 'center', padding: 20 }}>
                Click a zone on the Leaflet map to inspect status
              </div>
            </div>
          )}

          {/* Zone Risk List */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Zone Risk Scores</h3>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {layout.zones.sort((a: any, b: any) => (zoneRiskScores[b.id] ?? 0) - (zoneRiskScores[a.id] ?? 0)).map((zone: any) => {
                const score = zoneRiskScores[zone.id] ?? 0;
                const c = getRiskColor(score);
                return (
                  <div key={zone.id} onClick={() => setSelectedZone(zone.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(56,100,200,0.08)', cursor: 'pointer' }}>
                    <div style={{ width: 28, fontSize: 10, color: '#4a6080', fontFamily: 'JetBrains Mono, monospace' }}>{zone.id}</div>
                    <div style={{ flex: 1, fontSize: 11, color: '#e8f0ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zone.name}</div>
                    <div style={{ width: 60 }}>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
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
