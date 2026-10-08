'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import AuthCard, { FormError } from '@/components/AuthCard';

const ROLES = ['Plant Manager', 'Safety Manager', 'HSE Officer', 'Shift Supervisor', 'Control Room Operator', 'Site Engineer'];

export default function RegisterPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', role: 'Shift Supervisor', organization: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api<{ emailVerification: boolean }>('/auth/config', { timeoutMs: 75000 }).then(c => setEmailOn(c.emailVerification)).catch(() => {}); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setErr('Passwords do not match'); return; }
    setBusy(true); setErr('');
    try {
      const { confirm, ...body } = f;
      const r = await api<{ verificationRequired: boolean; token?: string; user?: User; email?: string }>('/auth/register', { method: 'POST', json: body, timeoutMs: 75000 });
      if (r.verificationRequired) router.push(`/verify?email=${encodeURIComponent(f.email.trim().toLowerCase())}`);
      else if (r.token && r.user) { signIn(r.token, r.user); router.push('/sites'); }
    } catch (ex: any) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <AuthCard title="Create your account" subtitle={emailOn === false ? 'Email verification is not enabled on this server yet — your account is active immediately.' : 'We will email you a 6-digit code to verify your address.'}
      footer={<>Already registered? <Link href="/login" style={{ color: 'var(--c-cyan)' }}>Sign in</Link></>}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">Full name<input required value={f.name} onChange={set('name')} autoComplete="name" /></label>
        <label className="field">Work email<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">Role<select value={f.role} onChange={set('role')}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
          <label className="field">Phone (optional)<input value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
        </div>
        <label className="field">Organisation / plant<input value={f.organization} onChange={set('organization')} placeholder="e.g. Acme Steel, Unit 2" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">Password<input type="password" required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
          <label className="field">Confirm<input type="password" required minLength={8} value={f.confirm} onChange={set('confirm')} autoComplete="new-password" /></label>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>At least 8 characters with letters and numbers.</div>
        <FormError msg={err} />
        <button className="btn-primary" disabled={busy} type="submit">{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthCard>
  );
}
