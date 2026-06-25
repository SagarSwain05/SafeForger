import type { Metadata } from 'next';
import './globals.css';
import { SocketProvider } from '@/lib/socket';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'SafeForger — Industrial Safety Intelligence Platform',
  description: 'AI-powered compound risk detection for industrial safety. Multi-agent system for IoT sensors, SCADA, permits, and CCTV integration.',
  keywords: ['industrial safety', 'compound risk', 'IoT', 'SCADA', 'AI safety', 'permit-to-work'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
        </SocketProvider>
      </body>
    </html>
  );
}
