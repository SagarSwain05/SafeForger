'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import AuthCard, { FormError, FormNote } from '@/components/AuthCard';

export default function ForgotPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [stage, setStage] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/auth/forgot', { method: 'POST', json: { email } }); setStage('reset'); setNote('If an account exists for that email, a reset code has been sent.'); }
    catch (ex: any) { setErr(ex.message); }
    setBusy(false);
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api<{ token: string; user: User }>('/auth/reset', { method: 'POST', json: { email, code, password } });
      signIn(r.token, r.user); router.push('/sites');
    } catch (ex: any) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <AuthCard title="Reset password" subtitle="We'll email you a code to set a new password." footer={<Link href="/login" style={{ color: 'var(--c-cyan)' }}>Back to sign in</Link>}>
      {stage === 'request' ? (
        <form onSubmit={request} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <FormError msg={err} />
          <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
        </form>
      ) : (
        <form onSubmit={reset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormNote msg={note} />
          <label className="field">Code<input inputMode="numeric" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          <label className="field">New password<input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
          <FormError msg={err} />
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
        </form>
      )}
    </AuthCard>
  );
}
