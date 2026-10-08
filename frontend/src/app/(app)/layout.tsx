'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { SocketProvider } from '@/lib/socket';
import Sidebar from '@/components/Sidebar';
import AlertToaster from '@/components/AlertToaster';
import SirenController from '@/components/SirenController';
import AppTopBar from '@/components/AppTopBar';

/** Authenticated shell: requires a signed-in user and (outside /sites) a selected site. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, user, siteId, site } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const onSitePicker = pathname === '/sites';

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!siteId && !onSitePicker) router.replace('/sites');
  }, [ready, user, siteId, onSitePicker, pathname, router]);

  if (!ready || !user || (!siteId && !onSitePicker)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
        {ready ? 'Redirecting…' : 'Connecting to SafeForge… (the free server tier can take up to a minute to wake)'}
      </div>
    );
  }

  if (onSitePicker) {
    return (
      <div style={{ minHeight: '100vh', position: 'relative', zIndex: 1 }}>
        <AppTopBar />
        {children}
      </div>
    );
  }

  return (
    <SocketProvider key={siteId}>
      <div style={{ display: 'flex', minHeight: '100vh', position: 'relative', zIndex: 1 }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {site ? children : <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Loading site…</div>}
        </main>
      </div>
      <AlertToaster />
      <SirenController />
    </SocketProvider>
  );
}
