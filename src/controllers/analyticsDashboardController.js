// =======================================
// src/controllers/analyticsDashboardController.js
// =======================================

require("dotenv").config();
const { Pool } = require("pg");

// --- Connect to PostgreSQL ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === Return summarized stats (provider rows) ===
// This matches what your public/dashboard.html expects: an array of rows
// [ { provider, total_calls, success_count, error_count, avg_response_time }, ... ]
exports.getSummary = async function () {
  try {
    const result = await pool.query(`
      SELECT 
        provider,
        COUNT(*) AS total_calls,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_count,
        ROUND(AVG(response_time_ms), 2) AS avg_response_time
      FROM ai_insight_logs
      GROUP BY provider
      ORDER BY provider;
    `);

    return result.rows;
  } catch (err) {
    console.error("Dashboard summary error:", err);
    // Return a safe shape so the frontend never breaks
    return [{ provider: "N/A", total_calls: 0, success_count: 0, error_count: 0, avg_response_time: 0 }];
  }
};

// === Serve the dashboard HTML from /public/dashboard.html ===
const fs = require("fs");
const path = require("path");

exports.getHTML = function () {
  const htmlPath = path.join(__dirname, "../../public/dashboard.html");

  try {
    if (!fs.existsSync(htmlPath)) {
      console.error("⚠️ Dashboard HTML not found:", htmlPath);
      return "<h3>Dashboard file missing.</h3>";
    }
    return fs.readFileSync(htmlPath, "utf8");
  } catch (err) {
    console.error("Error reading dashboard HTML:", err);
    return "<h3>Dashboard loading error.</h3>";
  }
};
