const { analyzeTone } = require('../services/openaiService');

/**
 * Handle GET /api/wellbeing/analyze.  Accepts a `text` query parameter
 * and returns the tone analysis.  If no text is provided, returns
 * an error message.
 *
 * @param {string} text - Text to analyze
 * @returns {Promise<Object>} - Tone analysis result
 */
async function analyzeText(text) {
  if (!text || text.trim().length === 0) {
    return { error: 'No text provided' };
  }
  const result = await analyzeTone(text);
  return result;
}

module.exports = {
  analyzeText
};