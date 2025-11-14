const express = require('express');
const { pool } = require('../utils/db_postgres');

const router = express.Router();

/**
 * Only allow manager-like roles.
 */
function requireManager(req, res, next) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!['admin', 'manager', 'super_admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Forbidden: manager access only' });
  }
  next();
}

/**
 * GET /api/manager/shifts/:id/candidates
 *
 * Returns:
 * {
 *   shift: { ... },
 *   candidates: [
 *     {
 *       staff_id, name, phone_number, preferred_shift,
 *       shifts_last7, shifts_next7, ai_score
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/shifts/:id/candidates', requireManager, async (req, res) => {
  try {
    const shiftId = parseInt(req.params.id, 10);
    if (!shiftId || Number.isNaN(shiftId)) {
      return res.status(400).json({ error: 'Invalid shift id' });
    }

    // 1) Load the shift
    const shiftResult = await pool.query(
      `SELECT id, ward, role_required, shift_date, organisation_id, shift_ref
       FROM shifts
       WHERE id = $1
       LIMIT 1`,
      [shiftId]
    );

    if (!shiftResult.rows.length) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const shift = shiftResult.rows[0];
    const orgId = shift.organisation_id;

    // 2) Get all staff in this organisation
    const staffResult = await pool.query(
      `SELECT id, name, phone_number, preferred_shift
       FROM staff
       WHERE organisation_id = $1
       ORDER BY id`,
      [orgId]
    );

    const staffRows = staffResult.rows;

    if (!staffRows.length) {
      return res.json({
        shift,
        candidates: [],
        message: 'No staff found for this organisation.',
      });
    }

    // 3) Load workload stats (shifts in last 7 days, next 7 days)
    const workloadResult = await pool.query(
      `
      WITH last7 AS (
        SELECT sa.staff_id, COUNT(*) AS shifts_last7
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        WHERE s.shift_date >= NOW() - INTERVAL '7 days'
          AND s.shift_date <= NOW()
        GROUP BY sa.staff_id
      ),
      next7 AS (
        SELECT sa.staff_id, COUNT(*) AS shifts_next7
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        WHERE s.shift_date >= NOW()
          AND s.shift_date <= NOW() + INTERVAL '7 days'
        GROUP BY sa.staff_id
      )
      SELECT
        st.id AS staff_id,
        COALESCE(l7.shifts_last7, 0) AS shifts_last7,
        COALESCE(n7.shifts_next7, 0) AS shifts_next7
      FROM staff st
      LEFT JOIN last7 l7 ON l7.staff_id = st.id
      LEFT JOIN next7 n7 ON n7.staff_id = st.id
      WHERE st.organisation_id = $1
      `,
      [orgId]
    );

    const workloadMap = new Map();
    for (const row of workloadResult.rows) {
      workloadMap.set(row.staff_id, {
        shifts_last7: parseInt(row.shifts_last7, 10) || 0,
        shifts_next7: parseInt(row.shifts_next7, 10) || 0,
      });
    }

    // 4) Compute a simple AI-style "score" in JS
    const candidates = staffRows.map((st) => {
      const wl = workloadMap.get(st.id) || {
        shifts_last7: 0,
        shifts_next7: 0,
      };

      // Lower workload = higher score
      // Prefer staff whose preferred_shift matches the shift time (very simplified)
      const workloadPenalty = wl.shifts_last7 + wl.shifts_next7 * 2;

      let base = 100;
      base -= workloadPenalty * 5;

      let fitBonus = 0;
      if (st.preferred_shift) {
        const prefLower = st.preferred_shift.toLowerCase();
        const shiftHour = new Date(shift.shift_date).getHours();
        const isDay = shiftHour >= 6 && shiftHour < 18;

        if (isDay && prefLower.includes('day')) fitBonus += 10;
        if (!isDay && prefLower.includes('night')) fitBonus += 10;
      }

      const ai_score = Math.max(0, base + fitBonus);

      return {
        staff_id: st.id,
        name: st.name,
        phone_number: st.phone_number,
        preferred_shift: st.preferred_shift,
        shifts_last7: wl.shifts_last7,
        shifts_next7: wl.shifts_next7,
        ai_score,
      };
    });

    // 5) Sort highest score first
    candidates.sort((a, b) => b.ai_score - a.ai_score);

    return res.json({
      shift,
      candidates,
    });
  } catch (err) {
    console.error('Manager candidates error:', err);
    return res.status(500).json({
      error: 'Failed to compute candidates',
      details: err.message,
    });
  }
});

module.exports = router;
