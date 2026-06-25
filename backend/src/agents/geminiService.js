// Gemini AI Service with API key rotation
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEYS = [
  process.env.GEMINI_KEY_1,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_3,
  process.env.GEMINI_KEY_4,
  process.env.GEMINI_KEY_5,
].filter(Boolean);

let currentKeyIndex = 0;

function getNextClient() {
  const key = API_KEYS[currentKeyIndex % API_KEYS.length];
  currentKeyIndex++;
  return new GoogleGenerativeAI(key);
}

async function generateWithFallback(prompt, retries = API_KEYS.length) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const genAI = getNextClient();
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      console.warn(`Gemini key attempt ${attempt + 1} failed:`, err.message);
      if (attempt === retries - 1) {
        console.error('All Gemini keys exhausted, using fallback response');
        return null;
      }
    }
  }
  return null;
}

module.exports = { generateWithFallback };
