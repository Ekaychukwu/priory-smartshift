let twilioClient = null;

function hasTwilio() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_API_KEY &&
    process.env.TWILIO_API_SECRET &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

async function sendWhatsApp(to, body) {
  // If Twilio creds missing, keep mock behaviour for dev
  if (!hasTwilio()) {
    console.log('[twilio-mock] -> ' + to + ': ' + body);
    return { sid: 'mock', to, body, mode: 'mock' };
  }

  try {
    if (!twilioClient) {
      const twilio = require('twilio');
      twilioClient = twilio(
        process.env.TWILIO_API_KEY,
        process.env.TWILIO_API_SECRET,
        { accountSid: process.env.TWILIO_ACCOUNT_SID }
      );
    }

    const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
    const toWhatsApp = to.startsWith('whatsapp:') ? to : 'whatsapp:' + to;

    console.log('[twilio] sending WhatsApp', {
      from: from,
      to: toWhatsApp,
      preview: body.slice(0, 80),
    });

    const result = await twilioClient.messages.create({
      from: from,
      to: toWhatsApp,
      body: body,
    });

    console.log('[twilio] message sent OK', { sid: result.sid, to: result.to });
    return result;
  } catch (err) {
    console.error('[twilio] sendWhatsApp error:', {
      message: err.message,
      code: err.code,
      moreInfo: err.moreInfo,
      status: err.status,
    });
    throw err;
  }
}

module.exports = { sendWhatsApp, hasTwilio };
