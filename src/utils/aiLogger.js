// =======================================
// src/utils/aiLogger.js
// =======================================

const fs = require("fs");
const path = require("path");

// Path to the log file
const LOG_PATH = path.join(__dirname, "../../logs/ai_insight_log.json");

/**
 * Append a new AI provider usage log.
 * @param {string} provider - "openai" | "gemini" | "deepseek" | "fallback"
 * @param {string} summary - The wellbeing summary text
 * @param {string} status - "success" or "error"
 * @param {string} [errorMessage] - optional error text
 */
exports.logAIUsage = function (provider, summary, status, errorMessage = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    provider,
    status,
    summary,
    error: errorMessage,
  };

  let logs = [];
  try {
    if (fs.existsSync(LOG_PATH)) {
      const existing = fs.readFileSync(LOG_PATH, "utf8");
      logs = existing ? JSON.parse(existing) : [];
    }
  } catch {
    logs = [];
  }

  logs.push(entry);

  // Limit to last 100 entries
  if (logs.length > 100) logs = logs.slice(-100);

  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
};
