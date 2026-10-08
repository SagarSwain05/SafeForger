import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider, themeBootScript } from '@/lib/theme';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'SafeForge Nexus — Industrial Safety Intelligence',
  description: 'Real-time AI for factories: PPE compliance and fire/smoke detection from CCTV, compound-risk prediction across sensors, permits and people, and autonomous emergency response.',
  keywords: ['industrial safety', 'PPE detection', 'fire detection', 'smoke detection', 'compound risk', 'CCTV AI', 'permit-to-work'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>" />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
