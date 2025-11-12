let twilioClient = null;

function hasTwilio() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

async function sendWhatsApp(to, body) {
  if (!hasTwilio()) {
    console.log(`[twilio-mock] -> ${to}: ${body}`);
    return { sid: 'mock', to, body };
  }
  if (!twilioClient) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  const from = process.env.TWILIO_WHATSAPP_FROM;
  return twilioClient.messages.create({ from, to: `whatsapp:${to}`, body });
}

module.exports = { sendWhatsApp, hasTwilio };
