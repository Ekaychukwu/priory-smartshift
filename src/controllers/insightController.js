// =======================================
// src/controllers/insightController.js
// CommonJS version (compatible with index.js)
// =======================================

const { getAIInsight } = require("../services/insight");

exports.generateInsight = async function (req, res) {
  try {
    // Call the AI service
    const result = await getAIInsight();

    // Send the AI's response back to the browser
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("Error in insightController:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to generate AI insight" }));
  }
};
