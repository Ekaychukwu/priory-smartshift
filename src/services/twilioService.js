const https = require('https');

/**
 * Send a WhatsApp message using the Twilio REST API.  This function makes
 * a low-level HTTP request and does not rely on the Twilio SDK.  It
 * requires the following environment variables to be set:
 *
 *  - TWILIO_ACCOUNT_SID
 *  - TWILIO_AUTH_TOKEN
 *  - TWILIO_WHATSAPP_NUMBER
 *
 * The `to` parameter should be in E.164 format without the `whatsapp:` prefix.
 * For example: '+447700900001'.  The `body` is the text of the message.
 *
 * If credentials are missing or invalid the function will log an error and
 * resolve without sending.  In a production environment you may wish to
 * throw instead.
 *
 * @param {string} to - Recipient phone number in international format
 * @param {string} body - Message body
 * @returns {Promise<void>}
 */
function sendWhatsAppMessage(to, body) {
  return new Promise((resolve, reject) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!accountSid || !authToken || !fromNumber) {
      console.warn('Twilio credentials are not configured. Skipping WhatsApp send.');
      resolve();
      return;
    }

    const postData = new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To: `whatsapp:${to}`,
      Body: body
    }).toString();

    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          console.error('Failed to send WhatsApp message', res.statusCode, data);
          resolve();
        }
      });
    });

    req.on('error', err => {
      console.error('Error sending WhatsApp message', err);
      resolve();
    });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  sendWhatsAppMessage
};