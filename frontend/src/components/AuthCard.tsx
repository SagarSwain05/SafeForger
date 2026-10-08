'use client';
import { ReactNode } from 'react';

export default function AuthCard({ title, subtitle, children, footer, wide = false }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px' }}>
      <div className="feature" style={{ width: '100%', maxWidth: wide ? 560 : 440, padding: 28 }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>{subtitle}</p>}
        {children}
        {footer && <div style={{ marginTop: 18, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function FormError({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div role="alert" style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--c-red)', fontSize: 13 }}>{msg}</div>;
}

export function FormNote({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(2,132,199,0.08)', border: '1px solid rgba(2,132,199,0.25)', color: 'var(--c-cyan)', fontSize: 13 }}>{msg}</div>;
}
