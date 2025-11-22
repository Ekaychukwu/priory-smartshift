'use strict';

const OpenAI = require('openai');

let client = null;
if (process.env.OPENAI_API_KEY) {
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.warn('[AI-CHATBOT] No OPENAI_API_KEY set – primary AI provider will be disabled. Fallback assistant only.');
}

/**
 * PRIMARY AI PROVIDER
 * -------------------
 * Uses OpenAI (gpt-4o-mini). If anything goes wrong (no key, timeout, error),
 * we throw and let the caller fall back to the secondary assistant.
 */
async function primaryAiReply({ message, from, staff }) {
  if (!client) {
    throw new Error('OpenAI client not initialised (missing OPENAI_API_KEY)');
  }

  const staffName = staff?.name || 'staff member';
  const ward = staff?.ward || 'their ward';

  const systemPrompt =
    'You are the Priory SmartShift WhatsApp assistant. ' +
    'You help healthcare staff understand how to use the SmartShift system ' +
    'and give friendly, clear answers in simple language.\n\n' +
    'Rules:\n' +
    '- If the user is asking about commands, explain commands like MENU, CHECKIN, CHECKOUT, MY SHIFTS, INSIGHT TODAY, ACCEPT, DECLINE, REGISTER.\n' +
    '- Keep answers short (2–5 sentences max).\n' +
    '- If the question is not about SmartShift, rota, shifts, WhatsApp check-ins or attendance, say you only handle SmartShift questions.\n' +
    '- At the end of most answers, suggest: "You can type MENU to see all commands."';

  const userPrompt =
    `Phone: ${from}\n` +
    `Known staff: ${staffName} on ${ward}\n\n` +
    `User message: """${message}"""`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    max_tokens: 220,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error('Empty reply from primary AI');
  }
  return reply;
}

/**
 * SECONDARY AI / RULE-BASED ASSISTANT
 * -----------------------------------
 * This does NOT call any external API.
 * It inspects the message and returns a sensible canned answer.
 * This is the safety net when the primary provider is unavailable.
 */
function secondaryRuleBasedReply({ message }) {
  const text = String(message || '').toLowerCase();

  // Very simple heuristics – you can expand these later.
  if (text.includes('check in') || text.includes('check-in') || text.includes('checkin')) {
    return (
      'To log your attendance, type *CHECKIN* at the start of your shift and *CHECKOUT* at the end.\n\n' +
      'You can also type *MY SHIFTS* to see your upcoming shifts.\n\n' +
      'You can type *MENU* to see all commands.'
    );
  }

  if (text.includes('my shift') || text.includes('next shift') || text.includes('rota')) {
    return (
      'To see your upcoming duties, type *MY SHIFTS* and I\'ll show your next allocated shifts from the rota.\n\n' +
      'You can type *MENU* to see all commands.'
    );
  }

  if (text.includes('insight') || text.includes('wellbeing') || text.includes('forecast')) {
    return (
      'The *INSIGHT TODAY* command gives a quick view of staffing cover, open shifts and basic wellbeing risk for today.\n\n' +
      'Just type *INSIGHT TODAY* and I\'ll send you a snapshot.\n\n' +
      'You can type *MENU* to see all commands.'
    );
  }

  if (text.includes('accept') || text.includes('decline') || text.includes('offer')) {
    return (
      'When you receive a shift offer by WhatsApp you can reply with *ACCEPT* to confirm it, or *DECLINE* if you can\'t work it.\n\n' +
      'You can type *MENU* to see all commands.'
    );
  }

  if (text.includes('register') || text.includes('sign up') || text.includes('set up')) {
    return (
      'To set up your profile, type *REGISTER* and I will ask a few quick questions about your name, role, ward and preferred shift.\n\n' +
      'You can type *MENU* to see all commands.'
    );
  }

  // Generic SmartShift help
  if (text.includes('help') || text.includes('how do i') || text.includes('what can you do')) {
    return (
      'I\'m the Priory SmartShift assistant. I help with WhatsApp check-ins, shift offers and rota visibility.\n\n' +
      'You can use commands like *CHECKIN*, *CHECKOUT*, *MY SHIFTS*, *INSIGHT TODAY*, *ACCEPT*, *DECLINE* and *REGISTER*.\n\n' +
      'Type *MENU* to see all commands.'
    );
  }

  // Non-SmartShift or unknown question
  return (
    'I can help with Priory SmartShift only – things like rota, shift cover, WhatsApp check-ins and attendance.\n\n' +
    'Please ask about your shifts or type *MENU* to see the full list of commands.'
  );
}

/**
 * PUBLIC FUNCTION USED BY whatsappRoutes.js
 * -----------------------------------------
 * Try primary AI first. If it throws, log the error and fall back to the
 * secondary rule-based assistant.
 */
async function getWhatsAppReply(options) {
  try {
    const reply = await primaryAiReply(options);
    console.log('[AI-CHATBOT] Primary AI provider succeeded');
    return reply;
  } catch (err) {
    console.error('[AI-CHATBOT] Primary AI failed, falling back to secondary assistant:', err.message);

    try {
      return secondaryRuleBasedReply(options);
    } catch (fallbackErr) {
      console.error('[AI-CHATBOT] Secondary assistant also failed:', fallbackErr.message);
      return (
        "I'm having trouble generating a full answer right now.\n\n" +
        'You can still type *MENU* to see the main SmartShift commands.'
      );
    }
  }
}

module.exports = {
  getWhatsAppReply,
};
