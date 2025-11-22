'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireManagerAuth } = require('../middleware/authMiddleware');

/**
 * POST /api/demo/simulate
 *
 * Demo-only endpoint.
 * - Randomly fills some upcoming shifts
 * - Creates a few attendance logs for today
 * - Returns a summary so the UI can show something if needed
 */
router.post('/simulate', requireManagerAuth, async (req, res) => {
  const organisationId = req.user.organisation_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Load some upcoming shifts for this organisation
    const shiftsRes = await client.query(
      `
        SELECT id, shift_ref, ward, role_required,
               number_required, number_filled, status, shift_date
        FROM shifts
        WHERE organisation_id = $1
          AND shift_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 days'
        ORDER BY shift_date ASC
        LIMIT 5
      `,
      [organisationId]
    );

    const shifts = shiftsRes.rows;

    // 2) Load staff so we can assign people
    const staffRes = await client.query(
      `
        SELECT id, name
        FROM staff
        WHERE organisation_id = $1
        ORDER BY id
      `,
      [organisationId]
    );
    const staff = staffRes.rows;

    if (shifts.length === 0 || staff.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Not enough demo data to run simulation. Seed staff and shifts first.',
      });
    }

    // Helper to pick a random staff id
    function randomStaffId() {
      const idx = Math.floor(Math.random() * staff.length);
      return staff[idx].id;
    }

    let shiftsUpdated = 0;
    let assignmentsCreated = 0;
    let attendanceCreated = 0;

    // 3) For each shift, try to fill 1..missing slots
    for (const shift of shifts) {
      const missing = Number(shift.number_required || 0) - Number(shift.number_filled || 0);
      if (missing <= 0) continue;

      const toFill = Math.max(1, Math.min(missing, Math.floor(Math.random() * missing) + 1));

      for (let i = 0; i < toFill; i++) {
        const staffId = randomStaffId();

        // Create assignment
        await client.query(
          `
            INSERT INTO shift_assignments (shift_id, staff_id, accepted_at)
            VALUES ($1, $2, NOW())
          `,
          [shift.id, staffId]
        );
        assignmentsCreated++;
      }

      // Update shift counts + status
      await client.query(
        `
          UPDATE shifts
          SET number_filled = number_filled + $2,
              status = CASE
                         WHEN number_filled + $2 >= number_required THEN 'filled'
                         ELSE status
                       END
          WHERE id = $1
        `,
        [shift.id, toFill]
      );

      shiftsUpdated++;
    }

    // 4) Add a few extra attendance logs for today (random staff)
    const logsToCreate = 3;
    for (let i = 0; i < logsToCreate; i++) {
      const staffId = randomStaffId();

      await client.query(
        `
          INSERT INTO attendance_logs (
            staff_id,
            organisation_id,
            action,
            source,
            occurred_at,
            metadata
          )
          VALUES ($1, $2, 'checkin', 'demo-simulator', NOW(), '{}'::jsonb)
        `,
        [staffId, organisationId]
      );

      attendanceCreated++;
    }

    await client.query('COMMIT');

    return res.json({
      ok: true,
      message: 'Demo simulation completed',
      shiftsUpdated,
      assignmentsCreated,
      attendanceCreated,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DEMO] Error during simulation:', err);
    return res.status(500).json({ error: 'Failed to run demo simulation' });
  } finally {
    client.release();
  }
});

module.exports = router;
