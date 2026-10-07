// Notification channels for alerts. Dashboard push is always on; Telegram and a generic
// webhook (Slack / Discord / Teams compatible) activate when configured; SMS is simulated
// and recorded in the alert's delivery log so the demo shows exactly who would be paged.
const config = require('../config');

const SEVERITY_ICON = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵' };

function formatText(alert) {
  const lines = [
    `${SEVERITY_ICON[alert.severity] || '⚠️'} SafeForge ${alert.severity}: ${alert.title}`,
    `Location: ${alert.zoneName || alert.zone || 'Plant-wide'}${alert.zone ? ` (${alert.zone})` : ''}${alert.cameraId ? ` · camera ${alert.cameraId}` : ''}`,
    alert.message,
  ];
  if (alert.recommendedActions?.length) lines.push(`Action: ${alert.recommendedActions[0]}`);
  if (alert.regulations?.length) lines.push(`Ref: ${alert.regulations.slice(0, 2).join('; ')}`);
  if (config.alerts.dashboardUrl) lines.push(`${config.alerts.dashboardUrl.replace(/\/$/, '')}/alerts?id=${alert.id}`);
  return lines.filter(Boolean).join('\n');
}

async function withTimeout(promise, ms = 8000) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

async function sendTelegram(alert) {
  const { telegramToken: token, telegramChatId: chat } = config.alerts;
  const base = `https://api.telegram.org/bot${token}`;
  const text = formatText(alert);
  if (alert.evidence?.startsWith('data:image/')) {
    const [meta, b64] = alert.evidence.split(',');
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', text.slice(0, 1000));
    form.append('photo', new Blob([Buffer.from(b64, 'base64')], { type: meta.slice(5, meta.indexOf(';')) }), 'evidence.jpg');
    const res = await withTimeout(fetch(`${base}/sendPhoto`, { method: 'POST', body: form }));
    if (!res.ok) throw new Error(`Telegram ${res.status}`);
    return;
  }
  const res = await withTimeout(fetch(`${base}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }));
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
}

async function sendWebhook(alert) {
  const text = formatText(alert);
  const { evidence, ...rest } = alert;
  const res = await withTimeout(fetch(config.alerts.webhookUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // 'text' → Slack/Teams, 'content' → Discord; full alert for custom receivers
    body: JSON.stringify({ text, content: text.slice(0, 1900), alert: { ...rest, hasEvidence: !!evidence } }),
  }));
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
}

function channels() {
  return {
    dashboard: true,
    sms: 'simulated',
    telegram: !!(config.alerts.telegramToken && config.alerts.telegramChatId),
    webhook: !!config.alerts.webhookUrl,
  };
}

/** Deliver an alert to every external channel; returns a delivery log. Never throws. */
async function dispatch(alert) {
  const log = [];
  const at = () => new Date().toISOString();
  const recipients = (alert.recipients || []).map(r => `${r.name} (${r.role})`);
  log.push({ channel: 'sms', status: 'simulated', to: recipients, at: at() });
  const ch = channels();
  const jobs = [];
  if (ch.telegram) jobs.push(sendTelegram(alert).then(() => ({ channel: 'telegram', status: 'sent' })));
  if (ch.webhook) jobs.push(sendWebhook(alert).then(() => ({ channel: 'webhook', status: 'sent' })));
  const results = await Promise.allSettled(jobs);
  results.forEach((r, i) => {
    const channel = (ch.telegram && i === 0) ? 'telegram' : 'webhook';
    log.push(r.status === 'fulfilled' ? { ...r.value, at: at() } : { channel, status: 'failed', error: r.reason?.message, at: at() });
  });
  return log;
}

module.exports = { dispatch, channels, formatText };
