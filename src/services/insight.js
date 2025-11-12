// =======================================
// src/services/insight.js  (Hybrid AI + Local Fallback + DB Logging)
// =======================================

require("dotenv").config();
const OpenAI = require("openai");
const axios = require("axios");
const { Pool } = require("pg");

// --- Database connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- AI Clients ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Gemini official v1 REST endpoint (works regardless of SDK)
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

// === MAIN FUNCTION ===
exports.getAIInsight = async function () {
  // Example stats: later fetch from DB
  const staffStats = {
    totalStaff: 40,
    available: 35,
    onLeave: 2,
    sick: 3,
    burnoutRisk: "low",
  };

  const prompt = `
You are an HR wellbeing assistant.
Based on these stats:
Total staff: ${staffStats.totalStaff}
Available: ${staffStats.available}
On leave: ${staffStats.onLeave}
Sick: ${staffStats.sick}
Burnout risk: ${staffStats.burnoutRisk}

Write a single concise HR wellbeing sentence like:
"Staff wellbeing remains stable with minimal burnout risk."
Avoid emojis. Do not add bullet points or extra text.
`;

  const started = Date.now();

  // --- 1) Gemini (primary) ---
  try {
    const geminiResponse = await axios.post(
      GEMINI_API_URL,
      { contents: [{ parts: [{ text: prompt }] }] },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        timeout: 10_000,
      }
    );

    const summary =
      geminiResponse?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (summary) {
      await logToDB("gemini", "success", summary, null, Date.now() - started);
      return formatResponse(summary);
    } else {
      throw new Error("Empty Gemini response");
    }
  } catch (err) {
    await logToDB("gemini", "error", null, cleanErr(err), Date.now() - started);
  }

  // --- 2) OpenAI (secondary) ---
  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      timeout: 10_000,
    });

    const summary = (aiResponse?.choices?.[0]?.message?.content || "").trim();
    if (summary) {
      await logToDB("openai", "success", summary, null, Date.now() - started);
      return formatResponse(summary);
    } else {
      throw new Error("Empty OpenAI response");
    }
  } catch (err) {
    await logToDB("openai", "error", null, cleanErr(err), Date.now() - started);
  }

  // --- 3) DeepSeek (tertiary) ---
  try {
    const dsResponse = await axios.post(
      DEEPSEEK_URL,
      {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      }
    );

    const summary = (dsResponse?.data?.choices?.[0]?.message?.content || "").trim();
    if (summary) {
      await logToDB("deepseek", "success", summary, null, Date.now() - started);
      return formatResponse(summary);
    } else {
      throw new Error("Empty DeepSeek response");
    }
  } catch (err) {
    await logToDB("deepseek", "error", null, cleanErr(err), Date.now() - started);
  }

  // --- 4) Local AI-Lite fallback (no internet / no credits) ---
  try {
    const summary = localWellbeingSummary(staffStats);
    await logToDB("local-fallback", "success", summary, null, Date.now() - started);
    return formatResponse(summary);
  } catch (err) {
    await logToDB("local-fallback", "error", null, cleanErr(err), Date.now() - started);
  }

  // --- Final safe fallback (should rarely hit) ---
  const msg = "AI temporarily unavailable — using fallback mode.";
  await logToDB("fallback", "error", msg, "All providers failed", Date.now() - started);
  return formatResponse(msg);
};

// === HELPERS ===
function todayISO() {
  // Always YYYY-MM-DD with leading zeros
  return new Date().toISOString().split("T")[0];
}

function formatResponse(summary) {
  // Ensure punctuation + trimmed
  let clean = (summary || "").trim();
  if (clean && !/[.!?]$/.test(clean)) clean += ".";
  return {
    summary: clean,
    details: {
      forecast_date: todayISO(),
      expected_open_shifts: 7,
      burnout_alerts: [],
      cost_forecast: 0,
    },
  };
}

function localWellbeingSummary(stats) {
  // Simple, human-sounding rule-based generator
  const { totalStaff, available, onLeave, sick, burnoutRisk } = stats;
  const availability = totalStaff > 0 ? Math.round((available / totalStaff) * 100) : 0;

  // Risk wording
  const riskWord =
    (burnoutRisk || "").toLowerCase() === "high"
      ? "elevated"
      : (burnoutRisk || "").toLowerCase() === "medium"
      ? "moderate"
      : "minimal";

  if (availability >= 85 && sick <= 3 && riskWord === "minimal") {
    return `Staff wellbeing remains stable with ${availability}% availability and ${riskWord} burnout risk`;
  }

  if (availability < 70 || sick > 5 || riskWord === "elevated") {
    return `Wellbeing signals show strain — availability ${availability}%, sick ${sick}, burnout risk ${riskWord}; consider rota balance and brief recovery breaks`;
  }

  return `Wellbeing is steady overall — availability ${availability}%, sick ${sick}, and ${riskWord} burnout risk`;
}

async function logToDB(provider, status, summary, error, timeMs) {
  try {
    await pool.query(
      `INSERT INTO ai_insight_logs (provider, status, summary, error, response_time_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [provider, status, summary || null, error || null, timeMs || null]
    );
    console.log(`🗂️  Logged ${provider} (${status}) → DB`);
  } catch (dbErr) {
    console.error("❌ DB log failed:", dbErr.message);
  }
}

function cleanErr(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.response && err.response.status) {
    const body = typeof err.response.data === "string" ? err.response.data : JSON.stringify(err.response.data);
    return `HTTP ${err.response.status}: ${body}`;
  }
  return err.message || "Unknown error";
}
