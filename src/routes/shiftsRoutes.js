// src/routes/shiftsRoutes.js
//
// REST API for managing shifts in PostgreSQL.
//
// Endpoints (all under /api/shifts):
//   GET    /         -> list shifts (with optional filters)
//   GET    /:id      -> get single shift by id
//   POST   /         -> create a new shift (manager only)
//   PUT    /:id      -> update an existing shift (manager only)
//   DELETE /:id      -> delete a shift (manager only)
//
// All routes are protected by the global auth middleware in index.js,
// which attaches req.user with { id, email, role, organisation_id }.

const express = require('express');
const { pool } = require('../utils/db_postgres');

const router = express.Router();

/**
 * Only allow manager-like roles to modify shifts.
 * We will still allow any authenticated user to READ shifts.
 */
function requireManager(req, res, next) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!['admin', 'manager', 'super_admin'].includes(user.role)) {
    return res
      .status(403)
      .json({ error: 'Forbidden: manager or admin access only' });
  }
  next();
}

/**
 * Helper to generate a human-readable shift reference if not supplied.
 * For example: "ALDER-20251114-0800"
 */
function generateShiftRef(ward, date) {
  const safeWard = (ward || 'SHIFT')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-') // replace spaces/symbols with dashes
    .replace(/-+/g, '-') // collapse multiple dashes
    .replace(/^-|-$/g, '') // trim leading/trailing dashes
    .slice(0, 10); // keep it short

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  return `${safeWard || 'SHIFT'}-${y}${m}${d}-${hh}${mm}`;
}

/**
 * GET /api/shifts
 *
 * List shifts for the logged-in user's organisation.
 * Optional query parameters:
 *   ?status=Open
 *   ?ward=Alder
 *   ?from=2025-11-01
 *   ?to=2025-11-30
 */
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.organisation_id) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    const orgId = user.organisation_id;
    const { status, ward, from, to } = req.query;

    const params = [orgId];
    let where = 'WHERE organisation_id = $1';

    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    if (ward) {
      // case-insensitive partial match on ward name
      params.push(`%${ward}%`);
      where += ` AND ward ILIKE $${params.length}`;
    }

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        params.push(fromDate.toISOString());
        where += ` AND shift_date >= $${params.length}`;
      }
    }

    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        params.push(toDate.toISOString());
        where += ` AND shift_date <= $${params.length}`;
      }
    }

    const sql = `
      SELECT
        id,
        shift_ref,
        ward,
        role_required,
        status,
        shift_date,
        start_time,
        end_time,
        gender_required,
        number_required,
        number_filled
      FROM shifts
      ${where}
      ORDER BY shift_date ASC
      LIMIT 200
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({
      organisation_id: orgId,
      total: rows.length,
      items: rows,
    });
  } catch (err) {
    console.error('Error in GET /api/shifts:', err);
    return res.status(500).json({ error: 'Failed to list shifts' });
  }
});

/**
 * GET /api/shifts/:id
 *
 * Get a single shift by id for the logged-in user's organisation.
 */
router.get('/:id', async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.organisation_id) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    const orgId = user.organisation_id;

    const shiftId = parseInt(req.params.id, 10);
    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ error: 'Invalid shift id' });
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
        gender_required,
        number_required,
        number_filled,
        organisation_id
      FROM shifts
      WHERE id = $1 AND organisation_id = $2
      LIMIT 1
    `,
      [shiftId, orgId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Error in GET /api/shifts/:id:', err);
    return res.status(500).json({ error: 'Failed to load shift' });
  }
});

/**
 * POST /api/shifts
 *
 * Create a new shift (manager/admin only).
 * Expected JSON body (examples):
 *   {
 *     "ward": "Alder",
 *     "role_required": "Support Worker",
 *     "status": "Open",              // optional, defaults to 'Open'
 *     "shift_date": "2025-11-15T08:00:00.000Z",
 *     "start_time": "08:00",         // optional
 *     "end_time": "20:00",           // optional
 *     "gender_required": "both",     // optional
 *     "number_required": 2           // optional (default 1)
 *   }
 */
router.post('/', requireManager, async (req, res) => {
  try {
    const user = req.user;
    const orgId = user.organisation_id;

    const {
      ward,
      role_required,
      status,
      shift_date,
      start_time,
      end_time,
      gender_required,
      number_required,
      shift_ref,
    } = req.body || {};

    if (!ward || !shift_date) {
      return res.status(400).json({
        error: 'Missing required fields: ward and shift_date are required',
      });
    }

    const dateObj = new Date(shift_date);
    if (isNaN(dateObj.getTime())) {
      return res
        .status(400)
        .json({ error: 'Invalid shift_date. Use a valid date/time.' });
    }

    const finalShiftRef = shift_ref || generateShiftRef(ward, dateObj);

    const numRequired = Number(number_required);
    const numRequiredValue = Number.isNaN(numRequired) ? null : numRequired;

    const insertSql = `
      INSERT INTO shifts (
        shift_ref,
        ward,
        role_required,
        status,
        shift_date,
        start_time,
        end_time,
        gender_required,
        number_required,
        number_filled,
        organisation_id
      )
      VALUES (
        $1, $2, $3, COALESCE($4, 'Open'),
        $5, $6, $7,
        COALESCE($8, 'both'),
        COALESCE($9, 1),
        0,
        $10
      )
      RETURNING
        id,
        shift_ref,
        ward,
        role_required,
        status,
        shift_date,
        start_time,
        end_time,
        gender_required,
        number_required,
        number_filled,
        organisation_id
    `;

    const params = [
      finalShiftRef,
      ward,
      role_required || null,
      status || null,
      dateObj.toISOString(),
      start_time || null,
      end_time || null,
      gender_required || null,
      numRequiredValue,
      orgId,
    ];

    const { rows } = await pool.query(insertSql, params);
    const created = rows[0];

    return res.status(201).json(created);
  } catch (err) {
    console.error('Error in POST /api/shifts:', err);
    return res.status(500).json({ error: 'Failed to create shift' });
  }
});

/**
 * PUT /api/shifts/:id
 *
 * Update an existing shift (manager/admin only).
 * You can send any subset of fields; missing ones will stay unchanged.
 */
router.put('/:id', requireManager, async (req, res) => {
  try {
    const user = req.user;
    const orgId = user.organisation_id;
    const shiftId = parseInt(req.params.id, 10);

    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ error: 'Invalid shift id' });
    }

    const {
      ward,
      role_required,
      status,
      shift_date,
      start_time,
      end_time,
      gender_required,
      number_required,
      number_filled,
    } = req.body || {};

    let shiftDateIso = null;
    if (shift_date) {
      const d = new Date(shift_date);
      if (isNaN(d.getTime())) {
        return res
          .status(400)
          .json({ error: 'Invalid shift_date. Use a valid date/time.' });
      }
      shiftDateIso = d.toISOString();
    }

    const numRequired = Number(number_required);
    const numRequiredValue = Number.isNaN(numRequired) ? null : numRequired;

    const numFilled = Number(number_filled);
    const numFilledValue = Number.isNaN(numFilled) ? null : numFilled;

    const updateSql = `
      UPDATE shifts
      SET
        ward = COALESCE($3, ward),
        role_required = COALESCE($4, role_required),
        status = COALESCE($5, status),
        shift_date = COALESCE($6, shift_date),
        start_time = COALESCE($7, start_time),
        end_time = COALESCE($8, end_time),
        gender_required = COALESCE($9, gender_required),
        number_required = COALESCE($10, number_required),
        number_filled = COALESCE($11, number_filled)
      WHERE id = $1 AND organisation_id = $2
      RETURNING
        id,
        shift_ref,
        ward,
        role_required,
        status,
        shift_date,
        start_time,
        end_time,
        gender_required,
        number_required,
        number_filled,
        organisation_id
    `;

    const params = [
      shiftId,
      orgId,
      ward || null,
      role_required || null,
      status || null,
      shiftDateIso,
      start_time || null,
      end_time || null,
      gender_required || null,
      numRequiredValue,
      numFilledValue,
    ];

    const { rows } = await pool.query(updateSql, params);

    if (!rows.length) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Error in PUT /api/shifts/:id:', err);
    return res.status(500).json({ error: 'Failed to update shift' });
  }
});

/**
 * DELETE /api/shifts/:id
 *
 * Delete a shift (manager/admin only).
 * NOTE: In a real system we might "soft delete" or mark as cancelled,
 * but for now we perform a hard delete.
 */
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const user = req.user;
    const orgId = user.organisation_id;
    const shiftId = parseInt(req.params.id, 10);

    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ error: 'Invalid shift id' });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM shifts WHERE id = $1 AND organisation_id = $2',
      [shiftId, orgId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Error in DELETE /api/shifts/:id:', err);
    return res.status(500).json({ error: 'Failed to delete shift' });
  }
});

module.exports = router;
