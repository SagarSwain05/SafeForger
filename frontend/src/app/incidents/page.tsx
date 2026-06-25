'use client';
import { API_URL } from '@/lib/socket';
import { useState } from 'react';

export default function IncidentsPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [incLoaded, setIncLoaded] = useState(false);

  const SAMPLE_QUERIES = [
    'Show patterns for H2S incidents in confined spaces',
    'Hot work permit near gas accumulation incidents',
    'Shift changeover safety failures',
    'What does OISD say about confined space entry?',
    'SIMOPS risk assessment regulation',
  ];

  const handleQuery = async (q?: string) => {
    const finalQuery = q || query;
    if (!finalQuery.trim()) return;
    setLoading(true); setResult(null);
    try {
      const r = await fetch(`${API_URL}/api/rag/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: finalQuery })
      });
      setResult(await r.json());
    } catch { setResult({ answer: 'Backend unavailable. Start the server on port 5001.', sources: [], patterns: [] }); }
    setLoading(false);
  };

  const loadIncidents = async () => {
    if (incLoaded) return;
    const r = await fetch(`${API_URL}/api/incidents`);
    setIncidents(await r.json());
    setIncLoaded(true);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>INCIDENT PATTERN INTELLIGENCE</h1>
        <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>RAG-powered query over incident corpus + OISD/DGMS/Factory Act regulations</div>
      </div>

      {/* Query Interface */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleQuery()}
            placeholder="Ask about incident patterns, regulations, risk factors…"
            style={{ flex: 1, padding: '12px 16px', background: 'rgba(10,18,40,0.8)', border: '1px solid rgba(56,100,200,0.2)', borderRadius: 8, color: '#e8f0ff', fontSize: 13 }}
          />
          <button onClick={() => handleQuery()} disabled={loading} style={{ padding: '12px 20px', borderRadius: 8, background: 'rgba(0,176,255,0.15)', border: '1px solid rgba(0,176,255,0.4)', color: '#00b0ff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {loading ? '🔍 Analyzing…' : '🔍 Query'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#4a6080', marginRight: 4 }}>Quick:</span>
          {SAMPLE_QUERIES.map(q => (
            <button key={q} onClick={() => { setQuery(q); handleQuery(q); }} style={{ padding: '4px 10px', borderRadius: 12, background: 'rgba(56,100,200,0.08)', border: '1px solid rgba(56,100,200,0.2)', color: '#8ba0c4', fontSize: 11, cursor: 'pointer' }}>{q}</button>
          ))}
        </div>
      </div>

      {/* Result */}
      {loading && (
        <div className="glass-card" style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ color: '#00b0ff', fontSize: 14 }}>🤖 Analyzing incident corpus and regulatory database…</div>
        </div>
      )}

      {result && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginBottom: 20 }}>
          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ fontSize: 11, color: '#00b0ff', fontWeight: 600, marginBottom: 10 }}>🤖 AI ANALYSIS</div>
            <div style={{ fontSize: 13, color: '#e8f0ff', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{result.answer}</div>
            {result.patterns?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: '#4a6080', marginBottom: 6 }}>Detected Patterns:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {result.patterns.map((p: string) => <span key={p} className="tag-chip">{p.replace(/_/g, ' ')}</span>)}
                </div>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8ba0c4', fontWeight: 600, marginBottom: 10 }}>📚 SOURCES ({result.count ?? result.sources?.length ?? 0} records)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.sources?.map((s: any, i: number) => (
                <div key={i} className="glass-card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#00b0ff' }}>{s.code || s.id}</div>
                  <div style={{ fontSize: 11, color: '#e8f0ff', marginTop: 2 }}>{s.title}</div>
                  {s.date && <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>{s.date} · {s.location}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Incident Database */}
      <div className="glass-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>Incident Database</h2>
          <button onClick={loadIncidents} style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(56,100,200,0.1)', border: '1px solid rgba(56,100,200,0.2)', color: '#8ba0c4', fontSize: 11, cursor: 'pointer' }}>Load Records</button>
        </div>
        {incidents.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
            {incidents.map(inc => (
              <div key={inc.id} className="glass-card" style={{ padding: 14, borderColor: inc.casualties > 0 ? 'rgba(255,68,68,0.25)' : 'rgba(255,179,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#4a6080' }}>{inc.date}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: inc.casualties > 0 ? '#ff4444' : '#ffb300' }}>{inc.casualties} casualt{inc.casualties === 1 ? 'y' : 'ies'}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e8f0ff', marginBottom: 4 }}>{inc.location}</div>
                <div style={{ fontSize: 11, color: '#8ba0c4', marginBottom: 8, lineHeight: 1.5 }} className="truncate-2">{inc.description}</div>
                <div style={{ fontSize: 10, color: '#4a6080', fontFamily: 'JetBrains Mono, monospace' }}>📚 {inc.regulation}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {inc.tags?.slice(0, 3).map((t: string) => <span key={t} className="tag-chip">{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
