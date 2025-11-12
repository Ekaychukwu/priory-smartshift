// scripts/check-env.js
require('dotenv').config();

function mask(v, keep = 6) {
  if (!v) return '❌ MISSING';
  const head = v.slice(0, keep);
  return `✅ SET (${head}… length=${v.length})`;
}

const keys = [
  'JWT_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  // add any others you want to check:
  // 'DATABASE_URL',
  // 'OPENAI_API_KEY',
  // 'GEMINI_API_KEY',
  // 'DEEPSEEK_API_KEY',
];

console.log('--- Env check (safe, masked) ---');
for (const k of keys) {
  const v = process.env[k];
  console.log(`${k.padEnd(24)} => ${mask(v)}`);
}


