'use strict';

const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const apiKeySid = process.env.TWILIO_API_KEY_SID || '';
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || '';
const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

// Decide mode
let USE_MOCK = false;
let client = null;

// If TWILIO_MOCK=true, always mock
if (process.env.TWILIO_MOCK === 'true') {
  USE_MOCK = true;
  console.log('[Twilio] TWILIO_MOCK=true – running in MOCK mode (no real WhatsApp sends).');
} else if (apiKeySid && apiKeySecret && accountSid) {
  // Prefer API key + secret if provided
  try {
    client = twilio(apiKeySid, apiKeySecret, { accountSid });
    console.log(
      '[Twilio] Initialised WhatsApp client with API KEY/SECRET (accountSid only logged length):',
      accountSid ? accountSid.slice(0, 5) + '...' : '(none)'
    );
  } catch (err) {
    console.error('[Twilio] Failed to initialise API KEY client, falling back to MOCK:', err);
    USE_MOCK = true;
  }
} else if (accountSid && authToken) {
  // Fallback to classic SID + Auth Token if available
  try {
    client = twilio(accountSid, authToken);
    console.log(
      '[Twilio] Initialised WhatsApp client with SID + AuthToken (accountSid only logged length):',
      accountSid ? accountSid.slice(0, 5) + '...' : '(none)'
    );
  } catch (err) {
    console.error('[Twilio] Failed to initialise SID/Auth client, falling back to MOCK:', err);
    USE_MOCK = true;
  }
} else {
  // No usable credentials found
  USE_MOCK = true;
  console.log(
    '[Twilio] No usable TWILIO credentials found – running in MOCK mode (no real WhatsApp sends).'
  );
}

/**
 * Send a WhatsApp message.
 *
 * Supports BOTH styles:
 *   sendWhatsAppMessage('+4479...', 'Hello')
 *   sendWhatsAppMessage({ to: '+4479...', body: 'Hello' })
 */
async function sendWhatsAppMessage(toOrPayload, maybeBody) {
  let to = null;
  let body = null;

  if (toOrPayload && typeof toOrPayload === 'object') {
    // { to, body } style
    to = toOrPayload.to;
    body = toOrPayload.body;
  } else {
    // (to, body) style
    to = toOrPayload;
    body = maybeBody;
  }

  const toStr = to ? String(to).trim() : '';
  const bodyStr = body ? String(body).trim() : '';

  if (!toStr || !bodyStr) {
    console.error(
      '[Twilio] Cannot send WhatsApp message – "body" is empty or "to" is missing.',
      { to: toStr }
    );
    return;
  }

  const toWhatsApp = toStr.startsWith('whatsapp:')
    ? toStr
    : `whatsapp:${toStr}`;

  if (USE_MOCK || !client) {
    console.log('MOCK WhatsApp send =>', {
      to: toWhatsApp,
      message: bodyStr,
    });
    return;
  }

  try {
    const result = await client.messages.create({
      from: fromWhatsApp,
      to: toWhatsApp,
      body: bodyStr,
    });

    console.log('[Twilio] WhatsApp message sent:', {
      mode: 'live',
      sid: result.sid,
      to: result.to,
      status: result.status,
    });
  } catch (err) {
    console.error('[Twilio] Error sending WhatsApp message:', err);
    throw err;
  }
}

module.exports = {
  sendWhatsAppMessage,
};
