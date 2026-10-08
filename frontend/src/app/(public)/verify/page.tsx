'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import AuthCard, { FormError, FormNote } from '@/components/AuthCard';

export default function VerifyPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => { setEmail(new URLSearchParams(window.location.search).get('email') || ''); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ token: string; user: User }>('/auth/verify', { method: 'POST', json: { email, code } });
      signIn(r.token, r.user);
      router.push('/dashboard');
    } catch (ex: any) { setErr(ex.message); }
    setBusy(false);
  };

  const resend = async () => {
    setNote(''); setErr('');
    try { await api('/auth/resend', { method: 'POST', json: { email } }); setNote('If the account is awaiting verification, a new code is on its way.'); } catch (ex: any) { setErr(ex.message); }
  };

  return (
    <AuthCard title="Verify your email" subtitle={`Enter the 6-digit code we sent to ${email || 'your inbox'}. It expires in 15 minutes.`}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!email && <label className="field">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
        <label className="field">Verification code
          <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 22, letterSpacing: 8, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }} />
        </label>
        <FormError msg={err} /><FormNote msg={note} />
        <button className="btn-primary" disabled={busy || code.length !== 6} type="submit">{busy ? 'Verifying…' : 'Verify & continue'}</button>
        <button type="button" className="btn-ghost" onClick={resend}>Resend code</button>
      </form>
    </AuthCard>
  );
}
