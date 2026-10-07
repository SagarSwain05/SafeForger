import type { Metadata } from 'next';
import './globals.css';
import { SocketProvider } from '@/lib/socket';
import Sidebar from '@/components/Sidebar';
import AlertToaster from '@/components/AlertToaster';

export const metadata: Metadata = {
  title: 'SafeForge Nexus — Industrial Safety Intelligence',
  description: 'Real-time AI for factories: PPE compliance and fire/smoke detection from CCTV, compound-risk prediction across sensors, permits and people, and autonomous emergency response.',
  keywords: ['industrial safety', 'PPE detection', 'fire detection', 'smoke detection', 'compound risk', 'CCTV AI', 'permit-to-work'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>" />
      </head>
      <body>
        <SocketProvider>
          <div style={{ display: 'flex', minHeight: '100vh', position: 'relative', zIndex: 1 }}>
            <Sidebar />
            <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
              {children}
            </main>
          </div>
          <AlertToaster />
        </SocketProvider>
      </body>
    </html>
  );
}
