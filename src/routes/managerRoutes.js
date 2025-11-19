'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');

// NOTE: auth is applied globally in index.js:
// app.use('/api/manager', requireManager, managerRoutes);
// so every route below assumes req.user is already set.

// ---------------------------------------------
// GET /api/manager/attendance/today
// Today’s attendance logs for this org
// ---------------------------------------------
router.get('/attendance/today', async (req, res) => {
  try {
    const orgId = req.user.organisation_id;

    const { rows } = await pool.query(
      `
        SELECT
          al.id,
          al.staff_id,
          s.name AS staff_name,
          al.organisation_id,
          al.action,
          al.source,
          al.occurred_at
        FROM attendance_logs al
        LEFT JOIN staff s ON s.id = al.staff_id
        WHERE al.organisation_id = $1
          AND al.occurred_at::date = CURRENT_DATE
        ORDER BY al.occurred_at DESC
      `,
      [orgId]
    );

    res.json({
      organisation_id: orgId,
      date: new Date().toISOString().slice(0, 10),
      total: rows.length,
      items: rows,
    });
  } catch (err) {
    console.error('[MANAGER] Error in /attendance/today:', err);
    res.status(500).json({ error: 'Failed to fetch today attendance logs' });
  }
});

// ---------------------------------------------
// GET /api/manager/attendance/range
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------
router.get('/attendance/range', async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to) {
      return res.status(400).json({
        error:
          'Query parameters "from" and "to" are required, e.g. ?from=2025-11-18&to=2025-11-19',
      });
    }

    const { rows } = await pool.query(
      `
        SELECT
          al.id,
          al.staff_id,
          s.name AS staff_name,
          al.organisation_id,
          al.action,
          al.source,
          al.occurred_at
        FROM attendance_logs al
        LEFT JOIN staff s ON s.id = al.staff_id
        WHERE al.organisation_id = $1
          AND al.occurred_at::date >= $2
          AND al.occurred_at::date <= $3
        ORDER BY al.occurred_at DESC
      `,
      [orgId, from, to]
    );

    res.json({
      organisation_id: orgId,
      from,
      to,
      total: rows.length,
      items: rows,
    });
  } catch (err) {
    console.error('[MANAGER] Error in /attendance/range:', err);
    res.status(500).json({
      error: 'Failed to fetch attendance logs for date range',
    });
  }
});

// ---------------------------------------------
// GET /api/manager/shifts/summary/today
// Today’s shifts and fill status for this org
// ---------------------------------------------
router.get('/shifts/summary/today', async (req, res) => {
  try {
    const orgId = req.user.organisation_id;

    const { rows } = await pool.query(
      `
        SELECT
          id,
          shift_ref,
          ward,
          role_required,
          status,
          shift_date,
          start_time,
          end_time,
          number_required,
          number_filled,
          gender_required
        FROM shifts
        WHERE organisation_id = $1
          AND shift_date = CURRENT_DATE
        ORDER BY shift_date ASC, start_time ASC
      `,
      [orgId]
    );

    res.json({
      organisation_id: orgId,
      date: new Date().toISOString().slice(0, 10),
      total: rows.length,
      items: rows,
    });
  } catch (err) {
    console.error('[MANAGER] Error in /shifts/summary/today:', err);
    res.status(500).json({ error: 'Failed to fetch today shift summary' });
  }
});

// ---------------------------------------------
// GET /api/manager/shifts/summary/range
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------
router.get('/shifts/summary/range', async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to) {
      return res.status(400).json({
        error:
          'Query parameters "from" and "to" are required, e.g. ?from=2025-11-18&to=2025-11-19',
      });
    }

    const { rows } = await pool.query(
      `
        SELECT
          id,
          shift_ref,
          ward,
          role_required,
          status,
          shift_date,
          start_time,
          end_time,
          number_required,
          number_filled,
          gender_required
        FROM shifts
        WHERE organisation_id = $1
          AND shift_date >= $2
          AND shift_date <= $3
        ORDER BY shift_date ASC, start_time ASC
      `,
      [orgId, from, to]
    );

    res.json({
      organisation_id: orgId,
      from,
      to,
      total: rows.length,
      items: rows,
    });
  } catch (err) {
    console.error('[MANAGER] Error in /shifts/summary/range:', err);
    res.status(500).json({
      error: 'Failed to fetch shift summary for date range',
    });
  }
});

module.exports = router;
