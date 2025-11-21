// Simple AI Insight stub service for Priory SmartShift.
// Runs on http://localhost:4000 and exposes:
//   GET /api/test/ai/insight
//
// This DOES NOT touch your main backend (index.js).
// It just returns a deterministic JSON insight for now.

const express = require("express");

const app = express();

// Very small CORS middleware so the dashboard on port 3000 can call this.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

// Helper to format today's date as YYYY-MM-DD
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// GET /api/test/ai/insight
// For now this is a deterministic stub. Later we can plug in real models.
app.get("/api/test/ai/insight", (req, res) => {
  const forecastDate = todayISO();

  const payload = {
    summary: "neutral", // "neutral" | "warning" | "critical" (for now)
    details: {
      forecast_date: forecastDate,
      expected_open_shifts: 7,
      burnout_alerts: [], // e.g. ["Alder", "Woodlands"] in future
    },
  };

  res.json(payload);
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(
    `AI insight test server listening on http://localhost:${PORT}/api/test/ai/insight`
  );
});
