// Central runtime configuration — every knob comes from the environment with a safe default.
require('dotenv').config();

const list = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  port: Number(process.env.PORT) || 5001,
  env: process.env.NODE_ENV || 'development',
  // Comma-separated list of allowed dashboard origins; empty = allow all (dev / demo)
  corsOrigins: list(process.env.FRONTEND_URL),
  mqtt: {
    enabled: process.env.MQTT_ENABLED !== 'false',
    port: Number(process.env.MQTT_PORT) || 1883,
  },
  llm: {
    keys: [1, 2, 3, 4, 5].map(i => process.env[`GEMINI_KEY_${i}`]).concat(list(process.env.GEMINI_API_KEYS)).filter(Boolean),
    // fast: real-time advice (risk, permits) · quality: reports, RAG answers. Each list is a fallback chain.
    fastModels: list(process.env.GEMINI_FAST_MODELS).length ? list(process.env.GEMINI_FAST_MODELS)
      : ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'],
    qualityModels: list(process.env.GEMINI_MODELS).length ? list(process.env.GEMINI_MODELS)
      : ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'],
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 20000,
  },
  alerts: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    webhookUrl: process.env.ALERT_WEBHOOK_URL || '',       // Slack / Discord / Teams / generic JSON webhook
    dashboardUrl: process.env.PUBLIC_DASHBOARD_URL || '',
    cooldownMs: Number(process.env.ALERT_COOLDOWN_MS) || 60000,
  },
  vision: {
    staleMs: 30000,
    autoEmergencyOnFire: process.env.AUTO_EMERGENCY_ON_FIRE !== 'false',
  },
  auth: {
    // Set JWT_SECRET in production so sessions survive restarts; a random one is used otherwise
    jwtSecret: process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex'),
    jwtSecretIsEphemeral: !process.env.JWT_SECRET,
    demoEmail: (process.env.DEMO_EMAIL || 'safeforgerdemo@gmail.com').toLowerCase(),
    demoPassword: process.env.DEMO_PASSWORD || 'Safeforger@20226',
  },
  email: {
    brevoKey: process.env.BREVO_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'SafeForge Nexus',
  },
  store: {
    mongoUri: process.env.MONGO_URI || process.env.MONGODB_URI || '',
    mongoDb: process.env.MONGO_DB || 'safeforge',
    dataDir: process.env.DATA_DIR || require('path').join(__dirname, '..', 'data'),
  },
  runtime: {
    idleStopMs: Number(process.env.SITE_IDLE_STOP_MS) || 15 * 60000,
  },
  simulation: {
    sensorMs: 2000,
    workerMs: 1500,
    scadaMs: 3000,
  },
};
