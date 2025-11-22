// index.js — Priory SmartShift Express Server

'use strict';

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// CORE MIDDLEWARE
// ===============================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// STATIC ASSETS (PUBLIC FOLDER)
// ===============================
//
// 1) /public/...  → e.g. /public/manager-dashboard.html
// 2) root ...     → e.g. /manager-dashboard.html
//
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// ===============================
// AUTH ROUTES (PUBLIC)
// ===============================
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/auth', authRoutes);

// ===============================
// DEV-ONLY TEST TOKEN ROUTE
// ===============================
app.get('/api/debug/test-token', (req, res) => {
  try {
    const secret = process.env.JWT_SECRET || 'dev-secret';

    const payload = {
      id: 999,
      email: 'test.manager@priory-smartshift.local',
      role: 'manager',
      organisation_id: 1,
    };

    const token = jwt.sign(payload, secret, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });

    return res.json({
      info:
        'DEV-ONLY token for testing protected endpoints. Do NOT use in production.',
      token,
      payload,
    });
  } catch (err) {
    console.error('Error generating test token:', err);
    return res.status(500).json({ error: 'Failed to generate test token' });
  }
});

// ===============================
// GLOBAL AUTH MIDDLEWARE
// (must come AFTER public/static routes)
// ===============================
const authMiddleware = require('./src/middleware/auth');
app.use(authMiddleware);

// ===============================
// WHATSAPP ROUTES
// ===============================
const whatsappRoutes = require('./src/routes/whatsappRoutes');
app.use('/api/whatsapp', whatsappRoutes);

// ===============================
// MANAGER ROUTES
// ===============================
const managerRoutes = require('./src/routes/managerRoutes');
app.use('/api/manager', managerRoutes);

// ===============================
// SHIFT ROUTES
// ===============================
const shiftsRoutes = require('./src/routes/shiftsRoutes');
app.use('/api/shifts', shiftsRoutes);

// ===============================
// SHIFT ASSIGNMENT ENGINE ROUTES
// (NEW — required for next milestones)
// ===============================
const assignmentRoutes = require('./src/routes/managerAssignmentRoutes');
app.use('/api/manager/assign', assignmentRoutes);

// ===============================
// DEBUG JWT-PROTECTED ROUTE
// ===============================
app.get('/api/ai/insight', (req, res) => {
  res.json({
    message: 'JWT-protected insight route working',
    user: req.user || null,
  });
});

// ===============================
// HEALTH CHECK
// ===============================
app.get('/', (_req, res) => {
  res.json({ message: 'Priory SmartShift Express API running' });
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// ===============================
// AI INSIGHT (STUB ENDPOINT)
// Dashboard calls GET /api/test/ai/insight
// ===============================
function todayISOForInsight() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

app.get('/api/test/ai/insight', (req, res) => {
  const payload = {
    summary: 'neutral',
    details: {
      forecast_date: todayISOForInsight(),
      expected_open_shifts: 7,
      burnout_alerts: [],
    },
  };

  res.json(payload);
});