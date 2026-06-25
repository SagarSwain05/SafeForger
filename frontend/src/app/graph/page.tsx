'use client';
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/socket';
import { useSocket } from '@/lib/socket';

interface GraphNode { id: string; label: string; type: string; color: string; x?: number; y?: number; }
interface GraphEdge { from: string; to: string; label?: string; color?: string; }

export default function GraphPage() {
  const { riskData } = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading, setLoading] = useState(true);
  const animFrameRef = useRef<number>(0);

  const fetchGraph = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/risk/graph`);
      const data = await r.json();
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
      // Force-directed initial positions
      const pos: Record<string, { x: number; y: number }> = {};
      (data.nodes ?? []).forEach((n: GraphNode, i: number) => {
        const angle = (i / (data.nodes.length || 1)) * Math.PI * 2;
        const radius = 180;
        pos[n.id] = { x: 400 + Math.cos(angle) * radius + (Math.random() - 0.5) * 60, y: 280 + Math.sin(angle) * radius + (Math.random() - 0.5) * 60 };
      });
      setPositions(pos);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchGraph(); }, []);
  useEffect(() => { if (riskData) fetchGraph(); }, [riskData?.riskScore]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const W = canvas.width, H = canvas.height;

    // Simple force simulation
    const pos = { ...positions };

    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);
      // Background
      ctx.fillStyle = 'rgba(5,9,20,1)';
      ctx.fillRect(0, 0, W, H);

      // Subtle radial gradient
      const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/2);
      bg.addColorStop(0, 'rgba(10,25,60,0.4)');
      bg.addColorStop(1, 'transparent');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Apply simple spring forces
      const nodeArr = nodes.filter(n => pos[n.id]);
      nodeArr.forEach(n => {
        if (!pos[n.id]) return;
        // Repulsion from other nodes
        nodeArr.forEach(m => {
          if (m.id === n.id || !pos[m.id]) return;
          const dx = pos[n.id].x - pos[m.id].x;
          const dy = pos[n.id].y - pos[m.id].y;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          if (dist < 120) {
            const force = 2 / dist;
            pos[n.id].x += dx * force * 0.3;
            pos[n.id].y += dy * force * 0.3;
          }
        });
        // Edge spring attraction
        edges.forEach(e => {
          if ((e.from === n.id || e.to === n.id) && pos[e.from] && pos[e.to]) {
            const other = e.from === n.id ? pos[e.to] : pos[e.from];
            const dx = other.x - pos[n.id].x;
            const dy = other.y - pos[n.id].y;
            pos[n.id].x += dx * 0.003;
            pos[n.id].y += dy * 0.003;
          }
        });
        // Center gravity
        pos[n.id].x += (W/2 - pos[n.id].x) * 0.001;
        pos[n.id].y += (H/2 - pos[n.id].y) * 0.001;
        // Clamp
        pos[n.id].x = Math.max(60, Math.min(W - 60, pos[n.id].x));
        pos[n.id].y = Math.max(40, Math.min(H - 40, pos[n.id].y));
      });

      // Draw edges
      edges.forEach(e => {
        if (!pos[e.from] || !pos[e.to]) return;
        const grd = ctx.createLinearGradient(pos[e.from].x, pos[e.from].y, pos[e.to].x, pos[e.to].y);
        const ec = e.color || '#448aff';
        grd.addColorStop(0, ec + '80');
        grd.addColorStop(1, ec + '20');
        ctx.beginPath();
        ctx.moveTo(pos[e.from].x, pos[e.from].y);
        ctx.lineTo(pos[e.to].x, pos[e.to].y);
        ctx.strokeStyle = grd;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Edge label
        const mx = (pos[e.from].x + pos[e.to].x) / 2;
        const my = (pos[e.from].y + pos[e.to].y) / 2;
        ctx.fillStyle = '#4a6080';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.label || '', mx, my - 4);
      });

      // Draw nodes
      nodeArr.forEach(n => {
        if (!pos[n.id]) return;
        const { x, y } = pos[n.id];
        const r = n.type === 'RISK' ? 22 : n.type === 'ZONE' ? 18 : 14;
        // Glow
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
        glow.addColorStop(0, n.color + '40');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Node circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color + '25';
        ctx.fill();
        ctx.strokeStyle = n.color;
        ctx.lineWidth = n.type === 'RISK' ? 2 : 1.5;
        ctx.stroke();
        // Pulsing ring for RISK nodes
        if (n.type === 'RISK') {
          const pr = r + 6 + Math.sin(frame * 0.08) * 4;
          ctx.beginPath();
          ctx.arc(x, y, pr, 0, Math.PI * 2);
          ctx.strokeStyle = n.color + '40';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Node icon
        ctx.fillStyle = n.color;
        ctx.font = `${r * 0.8}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const icon = n.type === 'RISK' ? '⚠' : n.type === 'ZONE' ? '📍' : n.type === 'PERMIT' ? '📋' : '👤';
        ctx.fillText(icon, x, y);
        // Label
        ctx.fillStyle = '#e8f0ff';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = n.label.length > 16 ? n.label.slice(0, 14) + '…' : n.label;
        ctx.fillText(label, x, y + r + 4);
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [nodes, edges, positions]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 800, color: '#e8f0ff', letterSpacing: 1 }}>RISK KNOWLEDGE GRAPH</h1>
          <div style={{ fontSize: 12, color: '#4a6080', marginTop: 4 }}>Live compound risk relationship graph — zones, permits, sensors, workers</div>
        </div>
        <button onClick={fetchGraph} style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(0,176,255,0.1)', border: '1px solid rgba(0,176,255,0.3)', color: '#00b0ff', fontSize: 12, cursor: 'pointer' }}>
          🔄 Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16 }}>
        <div className="glass-card graph-container" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a6080' }}>Loading graph data…</div>
          ) : nodes.length === 0 ? (
            <div style={{ height: 560, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <div style={{ fontSize: 32 }}>🕸️</div>
              <div style={{ color: '#4a6080', fontSize: 13 }}>No active risk relationships detected</div>
              <div style={{ color: '#4a6080', fontSize: 11 }}>Graph populates when compound risks are active</div>
            </div>
          ) : (
            <canvas ref={canvasRef} width={800} height={560} style={{ width: '100%', height: 'auto', display: 'block' }} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Legend */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Legend</h3>
            {[['⚠ RISK', '#ff2244', 'Compound risk events'], ['📍 ZONE', '#4488ff', 'Plant zones'], ['📋 PERMIT', '#ff8844', 'Active permits'], ['👤 WORKER', '#44ff88', 'Worker locations']].map(([icon, c, desc]) => (
              <div key={String(icon)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: String(c), flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, color: '#e8f0ff' }}>{icon}</div>
                  <div style={{ fontSize: 10, color: '#4a6080' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Graph stats */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Graph Stats</h3>
            {[['Nodes', nodes.length], ['Edges', edges.length], ['Risk Nodes', nodes.filter(n => n.type === 'RISK').length], ['Zone Nodes', nodes.filter(n => n.type === 'ZONE').length], ['Permit Nodes', nodes.filter(n => n.type === 'PERMIT').length]].map(([k, v]) => (
              <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(56,100,200,0.08)' }}>
                <span style={{ fontSize: 12, color: '#8ba0c4' }}>{k}</span>
                <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#e8f0ff' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Active Risk alerts */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Active Risks</h3>
            {(riskData?.alerts ?? []).length === 0 && <div style={{ fontSize: 11, color: '#4a6080' }}>No compound risks detected</div>}
            {(riskData?.alerts ?? []).map((a: any, i: number) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(56,100,200,0.08)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: a.severity === 'CRITICAL' ? '#ff1744' : '#ff5252' }}>{a.name}</div>
                <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>{a.severity}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
