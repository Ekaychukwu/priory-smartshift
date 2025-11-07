const https = require('https');

// Default system prompt instructs the model to perform a basic sentiment
// analysis on the provided text.  It asks the model to respond in a JSON
// object containing two fields: `tone_summary` (a brief description of the
// emotional tone) and `score` (a number between 1 and 10 representing the
// intensity of the sentiment).  This prompt can be overridden by
// specifying the `OPENAI_TONE_PROMPT` environment variable.
const defaultPrompt = `
You are a wellbeing assistant analysing the emotional tone of staff messages.
Given a short message from a healthcare worker, determine the overall tone in
a few words and assign a wellbeing score from 1 (very negative) to 10 (very
positive).  Respond with a JSON object with two keys:

  tone_summary: a concise description of the tone (e.g. "stressed", "happy")
  score: a number between 1 and 10

Do not include any additional keys or commentary.  Example response:

{"tone_summary": "relieved", "score": 7}`;

// Perform a tone analysis using the OpenAI Chat Completion endpoint.  If no
// API key is configured the function returns a neutral response.  On
// successful API call it returns the parsed JSON from the model's reply.
function analyzeTone(text) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Without an API key we cannot call OpenAI.  Return a stub response.
      resolve({ tone_summary: 'neutral', score: 5 });
      return;
    }
    const prompt = process.env.OPENAI_TONE_PROMPT || defaultPrompt;
    const postData = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: text }
      ],
      max_tokens: 50,
      temperature: 0.2
    });
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${apiKey}`
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const message = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
          if (!message) {
            resolve({ tone_summary: 'unknown', score: 5 });
            return;
          }
          // Expect the model to return a JSON string.  Attempt to parse it.
          let parsed;
          try {
            parsed = JSON.parse(message);
          } catch (err) {
            // If parsing fails, default to unknown tone.
            parsed = { tone_summary: message.trim().slice(0, 30), score: 5 };
          }
          resolve(parsed);
        } catch (err) {
          console.error('Error parsing OpenAI response', err);
          resolve({ tone_summary: 'unknown', score: 5 });
        }
      });
    });
    req.on('error', err => {
      console.error('Error calling OpenAI API', err);
      resolve({ tone_summary: 'unknown', score: 5 });
    });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  analyzeTone
};