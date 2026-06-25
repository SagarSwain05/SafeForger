'use client';
import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/socket';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from 'recharts';

const STATUS_COLOR: Record<string, string> = {
  COMPLIANT: '#00e676', OBSERVATION: '#ffb300', NON_COMPLIANT: '#ff1744'
};

export default function CompliancePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API_URL}/api/compliance`);
        setData(await r.json());
      } catch {}
      setLoading(false);
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div style={{ padding: 24, color: '#4a6080' }}>Loading compliance data…</div>;
  if (!data) return <div style={{ padding: 24, color: '#4a6080' }}>Could not load compliance data. Ensure backend is running.</div>;

  const radarData = data.items?.map((item: any) => ({
    subject: item.standard.replace('OISD-', '').replace('Factory Act ', 'FA-').replace('DGMS ', ''),
    score: item.score,
  }));

  const compliant = data.items?.filter((i: any) => i.status === 'COMPLIANT').length ?? 0;
  const observation = data.items?.filter((i: any) => i.status === 'OBSERVATION').length ?? 0;
  const nonCompliant = data.items?.filter((i: any) => i.status === 'NON_COMPLIANT').length ?? 0;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>COMPLIANCE AUDIT</h1>
        <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Continuous monitoring against OISD / DGMS / Factory Act standards</div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>Overall Score</div>
          <div style={{ fontSize: 40, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: data.overallScore >= 80 ? '#00e676' : data.overallScore >= 60 ? '#ffb300' : '#ff4444' }}>{data.overallScore}<span style={{ fontSize: 16 }}>%</span></div>
        </div>
        <div className="glass-card" style={{ padding: 16, background: 'rgba(0,230,118,0.07)' }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>Compliant</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#00e676' }}>{compliant}</div>
        </div>
        <div className="glass-card" style={{ padding: 16, background: 'rgba(255,179,0,0.07)' }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>Observations</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#ffb300' }}>{observation}</div>
        </div>
        <div className="glass-card" style={{ padding: 16, background: nonCompliant > 0 ? 'rgba(255,23,68,0.1)' : undefined }}>
          <div style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>Non-Compliant</div>
          <div style={{ fontSize: 36, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#ff1744' }}>{nonCompliant}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Compliance Items */}
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Standards Assessment</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.items?.map((item: any) => {
              const c = STATUS_COLOR[item.status] ?? '#8ba0c4';
              return (
                <div key={item.id} className="glass-card" style={{ padding: 16, borderColor: `${c}25` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f0ff' }}>{item.topic}</div>
                      <div style={{ fontSize: 11, color: '#4a6080', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{item.standard}</div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: `${c}15`, color: c, border: `1px solid ${c}30`, flexShrink: 0, marginLeft: 12 }}>{item.status.replace('_', ' ')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                      <div style={{ height: '100%', width: `${item.score}%`, background: c, borderRadius: 3, transition: 'width 1s' }} />
                    </div>
                    <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c, width: 40, textAlign: 'right' }}>{item.score}%</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#4a6080', marginTop: 6 }}>Last checked: {new Date(item.lastChecked).toLocaleTimeString()}</div>

                  {item.status !== 'COMPLIANT' && (
                    <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,179,0,0.06)', borderRadius: 6, border: '1px solid rgba(255,179,0,0.15)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#ffb300', marginBottom: 4 }}>Corrective Actions Required:</div>
                      <ul style={{ paddingLeft: 14, margin: 0 }}>
                        {item.status === 'NON_COMPLIANT' ? [
                          'Immediate permit suspension in affected zones',
                          'Safety officer review within 2 hours',
                          'DGMS notification if condition persists >4 hours'
                        ] : [
                          'Schedule compliance review within 48 hours',
                          'Update procedure documentation',
                          'Brief shift supervisors on requirements'
                        ].map((a, i) => (
                          <li key={i} style={{ fontSize: 11, color: '#8ba0c4', marginBottom: 3 }}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Radar Chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Compliance Radar</h3>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(56,100,200,0.2)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#4a6080', fontSize: 9 }} />
                <Radar name="Score" dataKey="score" stroke="#00b0ff" fill="#00b0ff" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Regulatory Bodies</h3>
            {[
              { name: 'OISD', full: 'Oil Industry Safety Directorate', items: 3, status: 'COMPLIANT' },
              { name: 'DGMS', full: 'Directorate General of Mines Safety', items: 2, status: 'OBSERVATION' },
              { name: 'Factory Act', full: 'Factories Act 1948', items: 1, status: 'COMPLIANT' },
            ].map(rb => {
              const c = STATUS_COLOR[rb.status];
              return (
                <div key={rb.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(56,100,200,0.08)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f0ff' }}>{rb.name}</div>
                    <div style={{ fontSize: 10, color: '#4a6080' }}>{rb.full}</div>
                  </div>
                  <span style={{ fontSize: 11, color: c }}>{rb.status.replace('_', ' ')}</span>
                </div>
              );
            })}
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Next Audit</h3>
            <div style={{ fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#00b0ff' }}>14 days</div>
            <div style={{ fontSize: 11, color: '#4a6080' }}>DGMS Annual Safety Audit</div>
            <div style={{ marginTop: 10, padding: 8, background: 'rgba(0,176,255,0.08)', borderRadius: 6, fontSize: 11, color: '#8ba0c4' }}>
              Current readiness: <span style={{ color: '#ffb300', fontWeight: 600 }}>78%</span> — 2 observations need resolution
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
