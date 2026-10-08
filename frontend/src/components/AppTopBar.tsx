'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/lib/theme';
import StatusWidget from './StatusWidget';

/** Header used on full-width app pages (site picker). */
export default function AppTopBar() {
  const { user, signOut, site } = useAuth();
  const router = useRouter();
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-panel)', position: 'sticky', top: 0, zIndex: 50, flexWrap: 'wrap' }}>
      <Link href="/" style={{ textDecoration: 'none', fontFamily: 'Orbitron, monospace', fontWeight: 800, fontSize: 16, color: 'var(--c-cyan)', letterSpacing: 1 }}>SAFE<span style={{ color: '#ef4444' }}>FORGE</span></Link>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Choose a site to monitor</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 190 }}><StatusWidget realtime={false} placement="down" /></div>
        {site && <button onClick={() => router.push('/dashboard')} style={btn}>← Back to {site.name.slice(0, 22)}</button>}
        <ThemeToggle compact />
        {user && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.name}</span>}
        <button onClick={() => { signOut(); router.push('/login'); }} style={btn}>Sign out</button>
      </div>
    </header>
  );
}

const btn: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' };
