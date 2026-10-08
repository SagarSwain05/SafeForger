'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/lib/theme';
import StatusWidget from './StatusWidget';

const NAV = [
  { href: '/dashboard',   icon: '⚡', label: 'Command Center' },
  { href: '/vision',      icon: '🎯', label: 'Vision AI' },
  { href: '/alerts',      icon: '🔔', label: 'Alert Center' },
  { href: '/heatmap',     icon: '🗺️', label: 'Safety Heatmap' },
  { href: '/cctv',        icon: '📹', label: 'Camera Wall' },
  { href: '/permits',     icon: '📋', label: 'Permit-to-Work' },
  { href: '/graph',       icon: '🕸️', label: 'Risk Graph' },
  { href: '/incidents',   icon: '🔍', label: 'Incident RAG' },
  { href: '/compliance',  icon: '✅', label: 'Compliance Audit' },
  { href: '/emergency',   icon: '🚨', label: 'Emergency' },
  { href: '/site',        icon: '🏭', label: 'Site & Cameras' },
  { href: '/calibration', icon: '📐', label: 'Spatial Calibration' },
];

const STATUS_COLOR: Record<string, string> = { SAFE: '#16a34a', LOW: '#22c55e', ELEVATED: '#ea580c', HIGH: '#ef4444', CRITICAL: '#e11d48' };
const readSiren = () => { try { return localStorage.getItem('sf_siren') !== 'off'; } catch { return true; } };

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { riskData, emergencyState, alertStats } = useSocket();
  const { user, site, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [siren, setSiren] = useState(true);

  useEffect(() => {
    setSiren(readSiren());
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    const onSiren = (e: Event) => setSiren((e as CustomEvent).detail !== 'off');
    window.addEventListener('sf-siren', onSiren);
    return () => { mq.removeEventListener('change', apply); window.removeEventListener('sf-siren', onSiren); };
  }, []);

  const toggleSiren = () => {
    const v = siren ? 'off' : 'on';
    try { localStorage.setItem('sf_siren', v); } catch { /* blocked */ }
    setSiren(!siren);
    window.dispatchEvent(new CustomEvent('sf-siren', { detail: v }));
  };

  const riskScore = riskData?.riskScore ?? 0;
  const riskStatus = riskData?.status ?? 'SAFE';
  const scoreColor = STATUS_COLOR[riskStatus] ?? '#16a34a';
  const isEmergency = emergencyState?.active;
  const openAlerts = alertStats?.open ?? 0;

  return (
    <aside style={{
      width: collapsed ? 64 : 236, minWidth: collapsed ? 64 : 236, background: 'var(--bg-panel)',
      borderRight: `1px solid ${isEmergency ? 'rgba(255,23,68,0.5)' : 'var(--border-subtle)'}`,
      display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0,
      transition: 'width 0.3s ease, min-width 0.3s ease', zIndex: 50,
    }}>
      <div style={{ padding: collapsed ? '16px 0' : '16px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 8 }}>
        {!collapsed && (
          <Link href="/" style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 800, fontSize: 16, color: 'var(--c-cyan)', letterSpacing: 1 }}>SAFE<span style={{ color: '#ef4444' }}>FORGE</span></div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Nexus · Industrial Safety AI</div>
          </Link>
        )}
        {collapsed && <span style={{ fontSize: 20 }}>🛡️</span>}
        <button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 4 }}>{collapsed ? '›' : '‹'}</button>
      </div>

      {!collapsed && site && (
        <button onClick={() => router.push(user?.isDemo ? '/sites' : '/site')} title={user?.isDemo ? 'Switch site' : 'Facility settings'} style={{ margin: '10px 10px 0', padding: '9px 10px', borderRadius: 10, textAlign: 'left', cursor: 'pointer', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{site.mode === 'live' ? '● Live facility' : 'Simulated'} · {site.sectorLabel}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{site.name}</div>
          <div style={{ fontSize: 10, color: 'var(--c-cyan)', marginTop: 2 }}>{user?.isDemo ? '⇄ Switch site' : '⚙ Facility settings'}</div>
        </button>
      )}

      {!collapsed && (
        <div style={{ margin: '10px 10px 0', padding: 10, background: `${scoreColor}14`, border: `1px solid ${scoreColor}40`, borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>Risk score</span>
            <span style={{ fontSize: 10, color: scoreColor, fontWeight: 700 }}>{riskStatus}</span>
          </div>
          <div style={{ fontSize: 24, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: scoreColor, lineHeight: 1 }}>{riskScore}<span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/100</span></div>
        </div>
      )}

      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} title={label} style={{ textDecoration: 'none' }}>
              <div className="nav-item" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '9px 0' : '9px 12px', justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 8, marginBottom: 2, background: active ? 'rgba(0,176,255,0.12)' : 'transparent',
                borderRight: active ? '2px solid var(--accent)' : '2px solid transparent',
                color: active ? 'var(--c-cyan)' : 'var(--text-secondary)', fontSize: 13, fontWeight: active ? 700 : 500,
              }}>
                <span style={{ fontSize: collapsed ? 18 : 15 }}>{icon}</span>
                {!collapsed && <span>{label}</span>}
                {!collapsed && href === '/alerts' && openAlerts > 0 && (
                  <span style={{ marginLeft: 'auto', minWidth: 18, padding: '0 6px', height: 18, borderRadius: 9, background: alertStats?.openCritical ? '#e11d48' : '#ea580c', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{openAlerts}</span>
                )}
                {!collapsed && href === '/emergency' && isEmergency && <span style={{ marginLeft: 'auto', width: 8, height: 8, background: '#e11d48', borderRadius: '50%', animation: 'blink 1s step-end infinite' }} />}
              </div>
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: collapsed ? '8px 4px' : '8px 10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <StatusWidget collapsed={collapsed} />
        <div style={{ display: 'flex', gap: 6, justifyContent: collapsed ? 'center' : 'flex-start', flexWrap: 'wrap' }}>
          <ThemeToggle compact />
          <button onClick={toggleSiren} title={siren ? 'Siren on — click to mute alarms' : 'Siren off — click to enable'} aria-label="Toggle siren"
            style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: siren ? 'var(--c-red)' : 'var(--text-muted)' }}>{siren ? '🔊' : '🔇'}</button>
          {!collapsed && (
            <button onClick={() => { signOut(); router.push('/login'); }} style={{ marginLeft: 'auto', padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 11, background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>Sign out</button>
          )}
        </div>
        {!collapsed && user && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={user.email}>
            {user.name} · {user.role}
          </div>
        )}
      </div>
    </aside>
  );
}
