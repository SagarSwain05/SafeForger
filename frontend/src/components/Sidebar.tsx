'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSocket } from '@/lib/socket';
import { useState } from 'react';

const NAV = [
  { href: '/',           icon: '⚡', label: 'Command Center' },
  { href: '/heatmap',    icon: '🗺️', label: 'Safety Heatmap' },
  { href: '/cctv',       icon: '📹', label: 'CCTV Intelligence' },
  { href: '/calibration', icon: '📐', label: 'Spatial Calibration' },
  { href: '/permits',    icon: '📋', label: 'Permit-to-Work' },
  { href: '/incidents',  icon: '🔍', label: 'Incident RAG' },
  { href: '/graph',      icon: '🕸️', label: 'Risk Graph' },
  { href: '/emergency',  icon: '🚨', label: 'Emergency' },
  { href: '/compliance', icon: '✅', label: 'Compliance Audit' },
];

const STATUS_COLOR: Record<string, string> = {
  SAFE: '#00e676', LOW: '#69f0ae', ELEVATED: '#ff8f00',
  HIGH: '#ff5252', CRITICAL: '#ff1744',
};

export default function Sidebar() {
  const pathname = usePathname();
  const { connected, riskData, emergencyState } = useSocket();
  const [collapsed, setCollapsed] = useState(false);

  const riskScore = riskData?.riskScore ?? 0;
  const riskStatus = riskData?.status ?? 'SAFE';
  const scoreColor = STATUS_COLOR[riskStatus] ?? '#00e676';
  const isEmergency = emergencyState?.active;

  return (
    <aside style={{
      width: collapsed ? 64 : 220,
      minWidth: collapsed ? 64 : 220,
      background: 'rgba(6,10,25,0.97)',
      borderRight: `1px solid ${isEmergency ? 'rgba(255,23,68,0.5)' : 'rgba(56,100,200,0.15)'}`,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
      transition: 'width 0.3s ease, min-width 0.3s ease',
      zIndex: 50,
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        padding: collapsed ? '20px 0' : '20px 16px',
        borderBottom: '1px solid rgba(56,100,200,0.12)',
        display: 'flex', alignItems: 'center', gap: 10,
        justifyContent: collapsed ? 'center' : 'space-between',
      }}>
        {!collapsed && (
          <div>
            <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 800, fontSize: 16, color: '#00b0ff', letterSpacing: 1 }}>
              SAFE<span style={{ color: '#ff4444' }}>FORGER</span>
            </div>
            <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>Industrial Safety AI</div>
          </div>
        )}
        {collapsed && <span style={{ fontSize: 20 }}>🛡️</span>}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{ background: 'none', border: 'none', color: '#4a6080', cursor: 'pointer', fontSize: 14, padding: 4 }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Risk Score */}
      {!collapsed && (
        <div style={{
          margin: '12px 12px 0',
          padding: '12px',
          background: `rgba(${riskStatus === 'CRITICAL' ? '255,23,68' : riskStatus === 'HIGH' ? '255,82,82' : '0,230,118'},0.08)`,
          border: `1px solid ${scoreColor}30`,
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: '#8ba0c4', textTransform: 'uppercase', letterSpacing: 1 }}>Risk Score</span>
            <span style={{ fontSize: 10, color: scoreColor, fontWeight: 700 }}>{riskStatus}</span>
          </div>
          <div style={{ fontSize: 28, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: scoreColor, lineHeight: 1 }}>
            {riskScore}<span style={{ fontSize: 12, color: '#4a6080' }}>/100</span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 8 }}>
            <div style={{ height: '100%', width: `${riskScore}%`, background: scoreColor, borderRadius: 2, transition: 'width 1s ease' }} />
          </div>
        </div>
      )}

      {/* Nav Links */}
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '10px 0' : '10px 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 8, marginBottom: 2,
                background: active ? 'rgba(0,176,255,0.1)' : 'transparent',
                borderRight: active ? '2px solid #00b0ff' : '2px solid transparent',
                color: active ? '#00b0ff' : '#8ba0c4',
                fontSize: 13, fontWeight: active ? 600 : 400,
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'rgba(56,100,200,0.08)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <span style={{ fontSize: collapsed ? 18 : 15 }}>{icon}</span>
                {!collapsed && <span>{label}</span>}
                {!collapsed && href === '/emergency' && isEmergency && (
                  <span style={{ marginLeft: 'auto', width: 8, height: 8, background: '#ff1744', borderRadius: '50%', animation: 'blink 1s step-end infinite' }} />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Connection Status */}
      <div style={{
        padding: collapsed ? '12px 0' : '12px 16px',
        borderTop: '1px solid rgba(56,100,200,0.12)',
        display: 'flex', alignItems: 'center', gap: 8,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connected ? '#00e676' : '#ff4444',
          boxShadow: connected ? '0 0 8px #00e676' : '0 0 8px #ff4444',
          animation: connected ? 'pulse-safe 2s infinite' : 'none',
        }} />
        {!collapsed && (
          <span style={{ fontSize: 11, color: connected ? '#00e676' : '#ff4444' }}>
            {connected ? 'Live Connected' : 'Disconnected'}
          </span>
        )}
      </div>
    </aside>
  );
}
