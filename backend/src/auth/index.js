// Accounts: register → email OTP verification (Brevo) → login (JWT). Password reset via OTP.
// The demo account is (re)seeded at every boot so the public demo login always works.
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const email = require('./email');
const { hashPassword, verifyPassword, signToken, verifyToken, newOtp, hashOtp } = require('./crypto');

const ROLES = ['Plant Manager', 'Safety Manager', 'HSE Officer', 'Shift Supervisor', 'Control Room Operator', 'Site Engineer'];
const OTP_TTL_MS = 15 * 60000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, organization: u.organization, phone: u.phone || '',
  verified: u.verified, isDemo: !!u.isDemo, createdAt: u.createdAt,
});

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}

class AuthService {
  constructor(store) { this.store = store; }

  async seedDemo() {
    const e = config.auth.demoEmail;
    const existing = await this.store.findOne('users', { email: e });
    const doc = {
      email: e, name: 'Demo Supervisor', role: 'Safety Manager', organization: 'SafeForge Demo',
      passwordHash: hashPassword(config.auth.demoPassword), verified: true, isDemo: true,
    };
    if (existing) await this.store.updateOne('users', { email: e }, doc);
    // Stable id: demo sessions stay valid across restarts even when storage is ephemeral
    else await this.store.insertOne('users', { id: 'usr_demo', createdAt: new Date().toISOString(), ...doc });
  }

  token(user) { return signToken({ sub: user.id, email: user.email, role: user.role }, config.auth.jwtSecret); }

  async userFromToken(token) {
    const claims = verifyToken(token, config.auth.jwtSecret);
    if (!claims) return null;
    const u = await this.store.findOne('users', { id: claims.sub });
    return u && u.verified ? u : null;
  }

  async issueOtp(user, purpose) {
    const { code, hash } = newOtp();
    await this.store.updateOne('users', { id: user.id }, { otp: { hash, purpose, expires: Date.now() + OTP_TTL_MS, attempts: 0 } });
    const r = purpose === 'verify' ? await email.sendVerification(user.email, user.name, code) : await email.sendPasswordReset(user.email, user.name, code);
    return r;
  }

  async checkOtp(user, purpose, code) {
    const o = user.otp;
    if (!o || o.purpose !== purpose) return 'No code requested — ask for a new one';
    if (Date.now() > o.expires) return 'Code expired — request a new one';
    if (o.attempts >= 5) return 'Too many attempts — request a new code';
    if (hashOtp(String(code).trim()) !== o.hash) {
      await this.store.updateOne('users', { id: user.id }, { otp: { ...o, attempts: o.attempts + 1 } });
      return 'Incorrect code';
    }
    return null;
  }
}

/** Express middleware: attaches req.user from a Bearer token. */
function requireAuth(auth) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const user = token ? await auth.userFromToken(token).catch(() => null) : null;
    if (!user) return res.status(401).json({ error: 'Sign in required' });
    req.user = user;
    next();
  };
}

function authRouter(auth, limiter) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  r.get('/config', (req, res) => res.json({
    emailVerification: email.enabled(), roles: ROLES,
    demo: { email: config.auth.demoEmail, password: config.auth.demoPassword },
  }));

  r.post('/register', limiter, wrap(async (req, res) => {
    const { name, email: rawEmail, password, role, organization, phone } = req.body || {};
    const e = String(rawEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required' });
    const pwErr = passwordProblem(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const existing = await auth.store.findOne('users', { email: e });
    if (existing && existing.verified) return res.status(409).json({ error: 'An account with this email already exists — sign in instead' });

    const doc = {
      name: String(name).trim().slice(0, 80), email: e, passwordHash: hashPassword(password),
      role: ROLES.includes(role) ? role : 'Shift Supervisor', organization: String(organization || '').slice(0, 120),
      phone: String(phone || '').slice(0, 30), verified: !email.enabled(),
    };
    let user;
    if (existing) user = await auth.store.updateOne('users', { email: e }, doc);
    else user = await auth.store.insertOne('users', { id: `usr_${crypto.randomBytes(6).toString('hex')}`, createdAt: new Date().toISOString(), ...doc });

    if (!email.enabled()) {
      return res.json({ verificationRequired: false, token: auth.token(user), user: publicUser(user), notice: 'Email verification is not configured on this server; your account is active.' });
    }
    const sent = await auth.issueOtp(user, 'verify');
    if (!sent.sent) return res.status(502).json({ error: 'Could not send the verification email. Try again shortly.' });
    res.json({ verificationRequired: true, email: e });
  }));

  r.post('/verify', limiter, wrap(async (req, res) => {
    const e = String(req.body?.email || '').trim().toLowerCase();
    const user = await auth.store.findOne('users', { email: e });
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.verified) return res.json({ token: auth.token(user), user: publicUser(user) });
    const err = await auth.checkOtp(user, 'verify', req.body?.code);
    if (err) return res.status(400).json({ error: err });
    const updated = await auth.store.updateOne('users', { id: user.id }, { verified: true, otp: null, lastLoginAt: new Date().toISOString() });
    res.json({ token: auth.token(updated), user: publicUser(updated) });
  }));

  r.post('/resend', limiter, wrap(async (req, res) => {
    const e = String(req.body?.email || '').trim().toLowerCase();
    const user = await auth.store.findOne('users', { email: e });
    if (user && !user.verified) await auth.issueOtp(user, 'verify');
    res.json({ ok: true });   // never reveal whether an account exists
  }));

  r.post('/login', limiter, wrap(async (req, res) => {
    const e = String(req.body?.email || '').trim().toLowerCase();
    const user = await auth.store.findOne('users', { email: e });
    if (!user || !verifyPassword(String(req.body?.password || ''), user.passwordHash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    if (!user.verified) {
      if (email.enabled()) await auth.issueOtp(user, 'verify');
      return res.status(403).json({ error: 'Email not verified — we sent you a new code', verificationRequired: true, email: e });
    }
    await auth.store.updateOne('users', { id: user.id }, { lastLoginAt: new Date().toISOString() });
    res.json({ token: auth.token(user), user: publicUser(user) });
  }));

  r.post('/forgot', limiter, wrap(async (req, res) => {
    const e = String(req.body?.email || '').trim().toLowerCase();
    const user = await auth.store.findOne('users', { email: e });
    if (!email.enabled()) return res.status(503).json({ error: 'Password reset by email is not configured on this server' });
    if (user && !user.isDemo) await auth.issueOtp(user, 'reset');
    res.json({ ok: true });
  }));

  r.post('/reset', limiter, wrap(async (req, res) => {
    const e = String(req.body?.email || '').trim().toLowerCase();
    const user = await auth.store.findOne('users', { email: e });
    if (!user) return res.status(400).json({ error: 'Incorrect code' });
    const pwErr = passwordProblem(req.body?.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const err = await auth.checkOtp(user, 'reset', req.body?.code);
    if (err) return res.status(400).json({ error: err });
    const updated = await auth.store.updateOne('users', { id: user.id }, { passwordHash: hashPassword(req.body.password), otp: null, verified: true });
    res.json({ token: auth.token(updated), user: publicUser(updated) });
  }));

  r.get('/me', requireAuth(auth), (req, res) => res.json({ user: publicUser(req.user) }));

  r.patch('/me', requireAuth(auth), wrap(async (req, res) => {
    if (req.user.isDemo) return res.status(403).json({ error: 'The shared demo profile cannot be edited' });
    const { name, role, organization, phone } = req.body || {};
    const patch = {};
    if (name) patch.name = String(name).slice(0, 80);
    if (ROLES.includes(role)) patch.role = role;
    if (organization !== undefined) patch.organization = String(organization).slice(0, 120);
    if (phone !== undefined) patch.phone = String(phone).slice(0, 30);
    const u = await auth.store.updateOne('users', { id: req.user.id }, patch);
    res.json({ user: publicUser(u) });
  }));

  return r;
}

module.exports = { AuthService, authRouter, requireAuth, publicUser, ROLES };
