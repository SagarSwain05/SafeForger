// Transactional email through Brevo (https://developers.brevo.com/reference/sendtransacemail).
const config = require('../config');

const enabled = () => !!(config.email.brevoKey && config.email.from);

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#0b1530;padding:18px 24px;color:#fff;font-weight:800;letter-spacing:1px">SAFE<span style="color:#ff4d4d">FORGE</span> <span style="font-weight:400;opacity:.7">Nexus</span></div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${title}</h2>${body}</div>
    <div style="padding:14px 24px;background:#f8fafc;font-size:12px;color:#64748b">Industrial safety intelligence · this is an automated message.</div>
  </div></body></html>`;
}

async function send(to, name, subject, html) {
  if (!enabled()) return { sent: false, reason: 'email-disabled' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'api-key': config.email.brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: config.email.from, name: config.email.fromName }, to: [{ email: to, name: name || to }], subject, htmlContent: html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[Email] Brevo rejected message:', res.status, body.slice(0, 300));
      return { sent: false, reason: `brevo-${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('[Email] Brevo request failed:', err.message);
    return { sent: false, reason: 'network' };
  } finally {
    clearTimeout(t);
  }
}

const codeBlock = (code) => `<div style="font-size:30px;font-weight:800;letter-spacing:8px;background:#f1f5f9;border-radius:8px;padding:14px;text-align:center;margin:16px 0">${code}</div>`;

module.exports = {
  enabled,
  sendVerification: (to, name, code) => send(to, name, 'Verify your SafeForge account',
    layout('Confirm your email', `<p>Hi ${name || ''}, use this code to verify your SafeForge account. It expires in 15 minutes.</p>${codeBlock(code)}<p style="font-size:13px;color:#64748b">If you didn't sign up, ignore this email.</p>`)),
  sendPasswordReset: (to, name, code) => send(to, name, 'Reset your SafeForge password',
    layout('Password reset', `<p>Use this code to set a new password. It expires in 15 minutes.</p>${codeBlock(code)}<p style="font-size:13px;color:#64748b">If you didn't request this, you can ignore this email.</p>`)),
};
