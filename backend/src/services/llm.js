// LLM gateway — Gemini over REST with key rotation, model fallback, timeouts and a small cache.
// Every caller has a deterministic fallback, so the platform stays fully functional without keys.
const config = require('../config');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const cache = new Map();          // prompt → { text, at }
const CACHE_TTL_MS = 5 * 60 * 1000;
let keyIndex = 0;
const stats = { calls: 0, failures: 0, lastModel: null, lastError: null, lastLatencyMs: null };

const isConfigured = () => config.llm.keys.length > 0;

async function callModel(model, key, prompt, { temperature = 0.3, maxOutputTokens = 1024 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
  try {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate text. opts.tier = 'fast' (default) | 'quality'.
 * Returns null when no key is configured or every model/key fails —
 * callers must then use their rule-based fallback.
 */
async function generate(prompt, opts = {}) {
  if (!isConfigured()) return null;
  const hit = cache.get(prompt);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  const keys = config.llm.keys;
  const models = opts.tier === 'quality' ? config.llm.qualityModels : config.llm.fastModels;
  for (const model of models) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[keyIndex++ % keys.length];
      const t0 = Date.now();
      stats.calls++;
      try {
        const text = await callModel(model, key, prompt, opts);
        Object.assign(stats, { lastModel: model, lastError: null, lastLatencyMs: Date.now() - t0 });
        cache.set(prompt, { text, at: Date.now() });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        return text;
      } catch (err) {
        stats.failures++;
        stats.lastError = `${model}: ${err.message}`;
        // 404 model gone / 503 overloaded → next model; 400 bad request → give up; else try next key
        if (err.status === 404 || err.status === 503) break;
        if (err.status === 400) return null;
      }
    }
  }
  console.warn('[LLM] All models/keys failed:', stats.lastError);
  return null;
}

module.exports = { generate, isConfigured, stats };
