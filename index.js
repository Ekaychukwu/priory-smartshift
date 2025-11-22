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
// AI INSIGHT (STUB ENDPOINT)
// Dashboard used to call GET /api/test/ai/insight
// (still available if you need it for debugging)
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

// ===============================
// AI SHIFT ASSIGNMENT (MOCK ENDPOINT)
// Used by the Manager Dashboard "AI SHIFT ASSIGNMENT (EXPERIMENTAL)" card
// URL: GET /api/ai/assign-shift/:shiftId
// NOTE: This version uses mock data (no database) just to drive the UI.
// ===============================
app.get('/api/ai/assign-shift/:shiftId', (req, res) => {
  const shiftId = parseInt(req.params.shiftId, 10);
  if (!Number.isInteger(shiftId)) {
    return res.status(400).json({ error: 'Invalid shift id' });
  }

  // In a later milestone we will pull real shift + staff data from Postgres.
  // For now we return a simple, consistent mock so the front-end card works.

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);

  // Very rough mapping just to make it feel real.
  let ward = 'Woodlands';
  let role = 'Healthcare Assistant';
  if (shiftId === 3 || shiftId === 7) ward = 'Evergreen';
  if (shiftId === 5 || shiftId === 2) role = 'Registered Nurse';

  const mockShift = {
    id: shiftId,
    organisation_id: 1,
    shift_ref: `DEMO-${String(shiftId).padStart(3, '0')}`,
    ward,
    role_required: role,
    shift_date: todayISO,
    start_time: '08:00:00',
    end_time: '20:00:00',
    number_required: 2,
    number_filled: 0,
    gender_required: 'any',
  };

  const now = new Date();
  const isoHoursAgo = (hours) =>
    new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  const candidates = [
    {
      staff_id: 3,
      staff_name: 'Prince Opara',
      score: 12,
      last_seen: isoHoursAgo(2),
      total_checkins: 8,
      reasons: ['8 recent check-ins', 'worked very recently'],
    },
    {
      staff_id: 5,
      staff_name: 'Demo Staff RN',
      score: 9,
      last_seen: isoHoursAgo(16),
      total_checkins: 5,
      reasons: ['5 recent check-ins', 'worked within the last day'],
    },
    {
      staff_id: 8,
      staff_name: 'Bank HCA Evergreen',
      score: 7,
      last_seen: isoHoursAgo(36),
      total_checkins: 4,
      reasons: ['4 recent check-ins', 'worked within the last week'],
    },
    {
      staff_id: 11,
      staff_name: 'Agency Backup',
      score: 3,
      last_seen: isoHoursAgo(96),
      total_checkins: 1,
      reasons: ['very few recent check-ins', 'no very recent shifts'],
    },
  ];

  res.json({
    shift: mockShift,
    top: candidates.slice(0, 3),
    all: candidates,
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
