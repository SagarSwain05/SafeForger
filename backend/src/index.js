// SafeForge Nexus backend — entry point.
const config = require('./config');
const llm = require('./services/llm');
const notifier = require('./services/notifier');
const { createPlatform } = require('./platform');

const platform = createPlatform();

platform.start(config.port).then((port) => {
  const ch = notifier.channels();
  console.log(`
SafeForge Nexus backend online
  HTTP / WebSocket : :${port}  (CORS: ${config.corsOrigins.length ? config.corsOrigins.join(', ') : '*'})
  MQTT broker      : ${config.mqtt.enabled ? `:${config.mqtt.port}` : 'disabled'}
  LLM              : ${llm.isConfigured() ? `${config.llm.keys.length} Gemini key(s) — ${config.llm.fastModels[0]} / ${config.llm.qualityModels[0]}` : 'not configured (rule-based fallbacks)'}
  Alert channels   : dashboard, sms(simulated)${ch.telegram ? ', telegram' : ''}${ch.webhook ? ', webhook' : ''}
  Vision ingest    : POST /api/vision/detections`);
});

const shutdown = (sig) => {
  console.log(`${sig} received — shutting down`);
  platform.stop().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

module.exports = platform;
