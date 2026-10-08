'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/lib/theme';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <div style={{ minHeight: '100vh', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-subtle)', backdropFilter: 'blur(10px)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Link href="/" style={{ textDecoration: 'none', fontFamily: 'Orbitron, monospace', fontWeight: 800, fontSize: 17, color: 'var(--c-cyan)', letterSpacing: 1 }}>
            SAFE<span style={{ color: '#ef4444' }}>FORGE</span> <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 12, color: 'var(--text-muted)', letterSpacing: 0 }}>Nexus</span>
          </Link>
          <nav className="public-nav" style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <a href="/#goals">Goals</a><a href="/#features">Features</a><a href="/#how">How it works</a><a href="/#industries">Industries</a>
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle compact />
            {user ? (
              <Link href="/dashboard" className="btn-primary">Open dashboard →</Link>
            ) : (
              <>
                <Link href="/login" className="btn-ghost">Sign in</Link>
                <Link href="/register" className="btn-primary">Create account</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <div style={{ flex: 1 }}>{children}</div>
      <footer style={{ borderTop: '1px solid var(--border-subtle)', padding: '22px 20px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
        SafeForge Nexus · AI safety fabric for industrial operations ·{' '}
        <a href="https://github.com/SagarSwain05/SafeForger" target="_blank" rel="noreferrer" style={{ color: 'var(--c-cyan)' }}>Source on GitHub</a>
        <div style={{ marginTop: 6 }}>Facility names in the site catalogue are used as digital-twin templates only; SafeForge is not affiliated with those operators and their twins show simulated data.</div>
      </footer>
    </div>
  );
}
