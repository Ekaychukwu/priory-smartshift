// src/routes/insightRoutes.js — CommonJS version
const express = require('express');
const { generateInsight } = require('../controllers/insightController');

const router = express.Router();

// Define route
router.get('/', async (req, res) => {
  try {
    const result = await generateInsight(req, res);
    if (!res.headersSent) {
      res.json(result);
    }
  } catch (err) {
    console.error('Insight route error:', err);
    res.status(500).json({ error: 'Failed to generate insight' });
  }
});

module.exports = router;
