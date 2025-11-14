const express = require('express');
const { pool } = require('../utils/db_postgres');

const router = express.Router();

/**
 * GET /api/staff/:id/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns upcoming shifts for a staff member by joining:
 *   shift_assignments → shifts
 */
router.get('/:id/shifts', async (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'Invalid staff id' });
    }

    const { from, to } = req.query;

    // Default: from now to 7 days ahead
    const now = new Date();
    const defaultTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const fromDate = from ? new Date(from) : now;
    const toDate = to ? new Date(to) : defaultTo;

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'Invalid from/to dates' });
    }

    const q = await pool.query(
      `SELECT
         sa.id AS assignment_id,
         s.id AS shift_id,
         s.shift_ref,
         s.ward,
         s.role_required,
         s.status,
         s.shift_date
       FROM shift_assignments sa
       JOIN shifts s ON sa.shift_id = s.id
       WHERE sa.staff_id = $1
         AND s.shift_date >= $2
         AND s.shift_date <= $3
       ORDER BY s.shift_date ASC
       LIMIT 50`,
      [staffId, fromDate.toISOString(), toDate.toISOString()]
    );

    const items = q.rows.map(row => ({
      assignment_id: row.assignment_id,
      shift_id: row.shift_id,
      shift_ref: row.shift_ref,
      ward: row.ward,
      role_required: row.role_required,
      status: row.status,
      shift_date: row.shift_date,
    }));

    res.json({
      staff_id: staffId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      total: items.length,
      items,
    });
  } catch (err) {
    console.error('Error in GET /api/staff/:id/shifts:', err);
    res.status(500).json({ error: 'Failed to load shifts' });
  }
});

module.exports = router;
