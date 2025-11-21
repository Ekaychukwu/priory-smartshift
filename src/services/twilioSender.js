'use strict';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

// If this is set to "true" in .env, we do NOT call the real Twilio API.
// Instead, we just log the message for local development.
const TWILIO_DISABLED = String(process.env.TWILIO_DISABLED || '').toLowerCase() === 'true';

let twilioClient = null;
if (!TWILIO_DISABLED) {
  if (!accountSid || !authToken) {
    console.warn(
      '[Twilio] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set. ' +
        'WhatsApp sending will fail until these are configured.'
    );
  } else {
    twilioClient = require('twilio')(accountSid, authToken);
    console.log('[Twilio] Client initialised (live mode).');
  }
} else {
  console.log('[Twilio] Running in DEV MOCK mode (TWILIO_DISABLED=true). No real messages will be sent.');
}

/**
 * Send a WhatsApp message.
 *
 * In live mode:
 *   - Uses Twilio API.
 * In dev/mock mode (TWILIO_DISABLED=true):
 *   - Logs the message to the console and returns a fake response.
 */
async function sendWhatsAppMessage({ to, body }) {
  const toSafe = String(to || '').trim();
  const bodySafe = String(body || '').trim();

  if (!toSafe || !bodySafe) {
    console.error('[Twilio] Missing "to" or "body" when trying to send WhatsApp message:', {
      to: toSafe,
      bodyLength: bodySafe.length,
    });
    return null;
  }

  if (TWILIO_DISABLED) {
    // Dev/mock mode: just log what we *would* send.
    console.log('[Twilio:DEV MOCK] Would send WhatsApp message:', {
      from: whatsappFrom,
      to: toSafe,
      body: bodySafe,
    });

    // Return a fake Twilio-like response object so callers don't crash.
    return {
      sid: 'DEV-MOCK-SID',
      status: 'mocked',
      to: toSafe,
      from: whatsappFrom,
      body: bodySafe,
    };
  }

  if (!twilioClient) {
    console.error('[Twilio] Client not initialised. Cannot send WhatsApp message.');
    return null;
  }

  try {
    const msg = await twilioClient.messages.create({
      from: whatsappFrom,
      to: toSafe,
      body: bodySafe,
    });

    console.log('[Twilio] WhatsApp message sent:', {
      sid: msg.sid,
      to: msg.to,
      status: msg.status,
    });

    return msg;
  } catch (err) {
    console.error('[Twilio] Error sending WhatsApp message:', err);

    // Special handling for daily limit / rate limit
    if (err && err.code === 63038) {
      console.error(
        '[Twilio] Daily WhatsApp message limit hit (code 63038). ' +
          'Messages will not be delivered until Twilio resets the quota.'
      );
    }

    throw err;
  }
}

module.exports = {
  sendWhatsAppMessage,
};
