'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import AuthCard, { FormError } from '@/components/AuthCard';
import PlantPicker, { type PlantChoice } from '@/components/PlantPicker';

const ROLES = ['Plant Manager', 'Safety Manager', 'HSE Officer', 'Shift Supervisor', 'Control Room Operator', 'Site Engineer'];

export default function RegisterPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', role: 'Shift Supervisor', organization: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [plant, setPlant] = useState<PlantChoice | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api<{ emailVerification: boolean }>('/auth/config', { timeoutMs: 75000 }).then(c => setEmailOn(c.emailVerification)).catch(() => {}); }, []);

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setErr('Passwords do not match'); return; }
    setErr(''); setStep(2);
  };

  const submit = async () => {
    if (!plant) { setErr('Choose your plant, or add it if it is not listed'); return; }
    setBusy(true); setErr('');
    try {
      const { confirm, ...rest } = f;
      const body = { ...rest, plant: 'newPlant' in plant ? { newPlant: plant.newPlant } : { directoryId: plant.directoryId } };
      const r = await api<{ verificationRequired: boolean; token?: string; user?: User; email?: string }>('/auth/register', { method: 'POST', json: body, timeoutMs: 75000 });
      if (r.verificationRequired) router.push(`/verify?email=${encodeURIComponent(f.email.trim().toLowerCase())}`);
      else if (r.token && r.user) { signIn(r.token, r.user); router.push('/dashboard'); }
    } catch (ex: any) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <AuthCard wide title="Create your account" subtitle={emailOn === false ? 'Email verification is not enabled on this server yet — your account is active immediately.' : 'We will email you a 6-digit code to verify your address.'}
      footer={<>Already registered? <Link href="/login" style={{ color: 'var(--c-cyan)' }}>Sign in</Link></>}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['1. Your account', '2. Your plant'].map((t, i) => (
          <span key={t} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, background: step === i + 1 ? 'var(--accent)' : 'var(--bg-subtle)', color: step === i + 1 ? '#fff' : 'var(--text-secondary)' }}>{t}</span>
        ))}
      </div>
      {step === 2 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>Find the plant you work at. Your account is linked to it: the first person from a plant becomes its owner, and colleagues who join later are approved by the owner.</p>
          <PlantPicker value={plant} onChange={setPlant} />
          <FormError msg={err} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <button type="button" className="btn-primary" style={{ flex: 1 }} disabled={busy || !plant} onClick={submit}>{busy ? 'Creating account…' : 'Create account'}</button>
          </div>
        </div>
      ) : (
      <form onSubmit={next} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <button className="btn-primary" type="submit">Next: find your plant →</button>
      </form>
      )}
    </AuthCard>
  );
}
