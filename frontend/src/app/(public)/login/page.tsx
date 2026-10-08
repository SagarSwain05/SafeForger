'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import AuthCard, { FormError } from '@/components/AuthCard';

const DEMO = { email: 'safeforgerdemo@gmail.com', password: 'Safeforger@20226' };

export default function LoginPage() {
  const { signIn, user, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [next, setNext] = useState('/sites');

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('next');
    if (n && n.startsWith('/') && !n.startsWith('//')) setNext(n);
  }, []);
  useEffect(() => { if (ready && user) router.replace(next); }, [ready, user, next, router]);

  const submit = async (e?: React.FormEvent, creds = { email, password }) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', json: creds, timeoutMs: 75000 });
      signIn(r.token, r.user);
      router.replace(next);
    } catch (ex: any) {
      if (ex.body?.verificationRequired) { router.push(`/verify?email=${encodeURIComponent(creds.email)}`); return; }
      setErr(ex.message);
    }
    setBusy(false);
  };

  return (
    <AuthCard title="Sign in" subtitle="Supervisors and managers sign in to monitor their sites."
      footer={<>New to SafeForge? <Link href="/register" style={{ color: 'var(--c-cyan)' }}>Create an account</Link></>}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <FormError msg={err} />
        <button className="btn-primary" disabled={busy} type="submit">{busy ? 'Signing in… (the server may take a minute to wake)' : 'Sign in'}</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <Link href="/forgot" style={{ color: 'var(--text-secondary)' }}>Forgot password?</Link>
        </div>
      </form>
      <div style={{ marginTop: 18, padding: 12, borderRadius: 10, background: 'var(--bg-subtle)', border: '1px dashed var(--border-subtle)', fontSize: 12, color: 'var(--text-secondary)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Demo account</div>
        <div>{DEMO.email} · {DEMO.password}</div>
        <button type="button" className="btn-ghost" style={{ marginTop: 8, width: '100%' }} disabled={busy}
          onClick={() => { setEmail(DEMO.email); setPassword(DEMO.password); submit(undefined, DEMO); }}>Sign in with the demo account</button>
      </div>
    </AuthCard>
  );
}
