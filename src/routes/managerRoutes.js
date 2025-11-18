// src/routes/managerRoutes.js
//
// Manager-facing APIs for Priory SmartShift.
//
// Provides:
//   - GET  /api/manager/shifts/:id/candidates
//       -> Returns a list of candidate staff for a shift with a simple ai_score.
//   - POST /api/manager/shifts/:id/assign
//       -> Direct manager assignment with scheduling rules and auto-fill status.
//   - POST /api/manager/shifts/:id/offer
//       -> Plan and create shift offers, capped by remaining slots.
//   - GET  /api/manager/shifts/:id/offers
//       -> List offers for a shift (with staff details).
//   - POST /api/manager/offers/:id/cancel
//       -> Cancel an offer safely (uses 'declined', not 'cancelled').
//
// NOTE: This file assumes there is global JWT auth in index.js so that
//       req.user is populated with: { id, email, role, organisation_id, ... }

const express = require('express');
const router = express.Router();

const { pool } = require('../utils/db_postgres');
const shiftRules = require('../services/shiftRules');

// ---- Helper: ensure user is manager/admin/super_admin -----------------------

function ensureManager(req, res, next) {
  const role = req.user && req.user.role;
  const allowed = ['manager', 'admin', 'super_admin'];

  if (!role || !allowed.includes(role)) {
    return res
      .status(403)
      .json({ error: 'Forbidden: manager or admin role required' });
  }

  next();
}

// ---- Helper: load a shift and check organisation ----------------------------

async function loadShiftForOrg(shiftId, organisationId) {
  const result = await pool.query(
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
    `,
    [shiftId, organisationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

// ---- Helper: build a "plain" shift object for rules engine ------------------

function buildRuleShiftFromRow(row) {
  return {
    shift_date: row.shift_date,
    start_time: row.start_time,
    end_time: row.end_time,
    ward: row.ward,
    role_required: row.role_required,
  };
}

// ---- GET /api/manager/shifts/:id/candidates ---------------------------------
//
// Simple AI-style candidate list for a given shift.

router.get('/shifts/:id/candidates', ensureManager, async (req, res) => {
  const orgId = req.user.organisation_id;
  const shiftId = parseInt(req.params.id, 10);

  if (!orgId || Number.isNaN(shiftId)) {
    return res
      .status(400)
      .json({ error: 'Invalid organisation or shift id in request' });
  }

  try {
    const shift = await loadShiftForOrg(shiftId, orgId);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found for organisation' });
    }

    const staffResult = await pool.query(
      `
        SELECT
          id,
          name,
          phone_number,
          preferred_shift,
          contracted_hours_per_week
        FROM staff
        WHERE organisation_id = $1
      `,
      [orgId]
    );

    const staffRows = staffResult.rows || [];
    const shiftType = shiftRules.getShiftType(buildRuleShiftFromRow(shift)); // 'day' | 'night' | 'unknown'

    const candidates = staffRows.map((s) => {
      let aiScore = 100;
      const pref = (s.preferred_shift || '').toLowerCase();

      if (shiftType === 'day' && pref === 'day') aiScore += 10;
      else if (shiftType === 'night' && pref === 'night') aiScore += 10;
      else if (pref === 'both' || pref === 'flexible') aiScore += 5;

      return {
        staff_id: s.id,
        name: s.name,
        phone_number: s.phone_number,
        preferred_shift: s.preferred_shift,
        contracted_hours_per_week: s.contracted_hours_per_week,
        shifts_last7: 0,
        shifts_next7: 0,
        ai_score: aiScore,
      };
    });

    candidates.sort((a, b) => b.ai_score - a.ai_score);

    return res.json({
      shift,
      candidates,
    });
  } catch (err) {
    console.error('Error in GET /api/manager/shifts/:id/candidates:', err);
    return res.status(500).json({ error: 'Failed to load shift candidates' });
  }
});

// ---- POST /api/manager/shifts/:id/assign ------------------------------------
//
// Assign a staff member to a shift, applying scheduling rules.
// Also increments number_filled and auto-sets status to 'Filled' when full.

router.post('/shifts/:id/assign', ensureManager, async (req, res) => {
  const orgId = req.user.organisation_id;
  const shiftId = parseInt(req.params.id, 10);
  const staffId = parseInt(req.body.staff_id, 10);
  const allowTrainingOverride = !!req.body.allowTrainingOverride;

  if (!orgId || Number.isNaN(shiftId) || Number.isNaN(staffId)) {
    return res.status(400).json({
      error:
        'organisation_id, shift id, and staff_id are required and must be numbers',
    });
  }

  try {
    const shiftRow = await loadShiftForOrg(shiftId, orgId);
    if (!shiftRow) {
      return res.status(404).json({ error: 'Shift not found for organisation' });
    }

    const assignmentsResult = await pool.query(
      `
        SELECT
          s.id,
          s.ward,
          s.role_required,
          s.shift_date,
          s.start_time,
          s.end_time,
          s.organisation_id
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        WHERE sa.staff_id = $1
          AND s.organisation_id = $2
      `,
      [staffId, orgId]
    );

    const existingAssignments = (assignmentsResult.rows || []).map((row) => ({
      shift_date: row.shift_date,
      start_time: row.start_time,
      end_time: row.end_time,
      ward: row.ward,
      role_required: row.role_required,
    }));

    const newShift = buildRuleShiftFromRow(shiftRow);

    // ---- Apply rules --------------------------------------------------------

    const doubleBooking = shiftRules.checkDoubleBooking(
      existingAssignments,
      newShift
    );
    if (!doubleBooking.ok) {
      return res.status(400).json({
        ok: false,
        rule: 'double_booking',
        reason: doubleBooking.reason,
        conflictingShift: doubleBooking.conflictingShift || null,
      });
    }

    const rest = shiftRules.checkRestPeriod(existingAssignments, newShift, 11);
    if (!rest.ok) {
      return res.status(400).json({
        ok: false,
        rule: 'rest_period',
        reason: rest.reason,
        previousShift: rest.previousShift || null,
      });
    }

    const consecutive = shiftRules.checkConsecutiveDaysLimit(
      existingAssignments,
      newShift,
      6
    );
    if (!consecutive.ok) {
      return res.status(400).json({
        ok: false,
        rule: 'consecutive_days',
        reason: consecutive.reason,
        streak: consecutive.streak,
      });
    }

    const weekly = shiftRules.checkWeeklyHoursLimit(
      existingAssignments,
      newShift,
      {
        softThresholdHours: 48,
        hardCapHours: 72,
      }
    );
    if (!weekly.ok) {
      return res.status(400).json({
        ok: false,
        rule: 'weekly_hours',
        reason: weekly.reason,
        totalHoursWithNew: weekly.totalHoursWithNew,
        breachedHardCap: weekly.breachedHardCap || false,
      });
    }

    const nightLimit = shiftRules.checkNightShiftLimit(
      existingAssignments,
      newShift
    );
    if (!nightLimit.ok) {
      return res.status(400).json({
        ok: false,
        rule: 'night_shift_limit',
        reason: nightLimit.reason,
        totalNightsWithNew: nightLimit.totalNightsWithNew,
      });
    }

    const trainingStatus = null; // TODO: real training data later
    const training = shiftRules.checkMandatoryTraining(
      trainingStatus,
      allowTrainingOverride
    );
    if (!training.ok) {
      return res.status(400).json({
        ok: false,
        rule: 'mandatory_training',
        reason: training.reason,
        overdueCourses: training.overdueCourses || [],
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const assignmentResult = await client.query(
        `
          INSERT INTO shift_assignments (shift_id, staff_id, accepted_at)
          VALUES ($1, $2, NOW())
          RETURNING id, shift_id, staff_id, accepted_at
        `,
        [shiftId, staffId]
      );

      const assignment = assignmentResult.rows[0];

      const shiftUpdateResult = await client.query(
        `
          UPDATE shifts
          SET
            number_filled = LEAST(number_required, number_filled + 1),
            status = CASE
              WHEN (number_filled + 1) >= number_required THEN 'Filled'
              ELSE status
            END
          WHERE id = $1
          RETURNING id, status, number_required, number_filled
        `,
        [shiftId]
      );

      const updatedShift = shiftUpdateResult.rows[0];

      await client.query('COMMIT');

      return res.json({
        ok: true,
        assignment,
        shift: updatedShift,
        rules: {
          weeklyHours: {
            totalHoursWithNew: weekly.totalHoursWithNew,
            legalWarning: weekly.legalWarning || null,
          },
          consecutiveDays: {
            streak: consecutive.streak,
          },
          nightShift: {
            totalNightsWithNew: nightLimit.totalNightsWithNew || 0,
          },
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error assigning shift inside transaction:', err);
      return res
        .status(500)
        .json({ error: 'Failed to assign shift (transaction error)' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error in POST /api/manager/shifts/:id/assign:', err);
    return res.status(500).json({ error: 'Failed to assign shift' });
  }
});

// ---- POST /api/manager/shifts/:id/offer ------------------------------------
//
// Plan and create shift offers for a given shift.
//   - Caps offers by remaining slots.
//   - Does NOT over-offer when shift is full.

router.post('/shifts/:id/offer', ensureManager, async (req, res) => {
  const orgId = req.user.organisation_id;
  const shiftId = parseInt(req.params.id, 10);

  if (!orgId || Number.isNaN(shiftId)) {
    return res
      .status(400)
      .json({ error: 'Invalid organisation or shift id in request' });
  }

  const maxOffersRequested = parseInt(req.body.maxOffers, 10) || 5;

  try {
    const shift = await loadShiftForOrg(shiftId, orgId);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found for organisation' });
    }

    const remainingSlots =
      (shift.number_required || 0) - (shift.number_filled || 0);

    if (remainingSlots <= 0) {
      return res.status(400).json({
        error: 'This shift is already fully staffed. No more offers can be sent.',
        shift,
      });
    }

    const staffResult = await pool.query(
      `
        SELECT
          id,
          name,
          phone_number,
          preferred_shift,
          contracted_hours_per_week
        FROM staff
        WHERE organisation_id = $1
      `,
      [orgId]
    );

    const staffRows = staffResult.rows || [];
    const shiftType = shiftRules.getShiftType(buildRuleShiftFromRow(shift));

    const scored = staffRows.map((s) => {
      let aiScore = 100;
      const pref = (s.preferred_shift || '').toLowerCase();

      if (shiftType === 'day' && pref === 'day') aiScore += 10;
      else if (shiftType === 'night' && pref === 'night') aiScore += 10;
      else if (pref === 'both' || pref === 'flexible') aiScore += 5;

      return {
        staff_id: s.id,
        name: s.name,
        phone_number: s.phone_number,
        ai_score: aiScore,
      };
    });

    scored.sort((a, b) => b.ai_score - a.ai_score);

    const maxOffers = Math.min(maxOffersRequested, remainingSlots, scored.length);
    const selected = scored.slice(0, maxOffers);

    if (selected.length === 0) {
      return res.status(400).json({
        error: 'No suitable staff available to offer this shift.',
        shift,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const offers = [];

      for (const [index, c] of selected.entries()) {
        const offerRef = `S${shiftId}U${c.staff_id}-${Math.random()
          .toString(36)
          .substring(2, 7)
          .toUpperCase()}`;

        const insertResult = await client.query(
          `
            INSERT INTO shift_offers (
              staff_id,
              organisation_id,
              shift_id,
              status,
              source,
              created_at,
              ai_score,
              broadcast_group
            )
            VALUES ($1, $2, $3, 'offered', 'whatsapp', NOW(), $4, $5)
            RETURNING id
          `,
          [c.staff_id, orgId, shiftId, c.ai_score, null]
        );

        const offerId = insertResult.rows[0].id;
        const shiftTypeLabel =
          shiftType === 'night' ? 'Night 19:30–08:00' : 'Day 07:30–20:00';

        const genderLabel =
  shift.gender_required === 'male'
    ? '♂️ Male only'
    : shift.gender_required === 'female'
    ? '♀️ Female only'
    : '⚧ Any gender';

const offerMessage =
  '📢 *Priory SmartShift – Shift Offer*\n\n' +
  `🏥 *Ward*: ${shift.ward}\n` +
  `👩‍⚕️ *Role*: ${shift.role_required}\n` +
  `⚧ *Gender requirement*: ${genderLabel}\n` +
  `📅 *Date*: ${dateLabel}\n` +
  `⏰ *Time*: ${shiftTypeLabel} ${startLabel}–${endLabel}\n\n` +
  `🔐 *Offer reference*: ${offerRef}\n\n` +
  'If you are available, reply:\n' +
  '  ✅ *ACCEPT* – to confirm this shift\n' +
  '  ❌ *DECLINE* – if you cannot work this shift';

offer.message_preview = offerMessage; // whatever variable you already use


        offers.push({
          id: offerId,
          staff_id: c.staff_id,
          name: c.name,
          phone_number: c.phone_number,
          ai_score: c.ai_score,
          rank: index + 1,
          offer_ref: offerRef,
          message_preview: msg,
        });
      }

      await client.query('COMMIT');

      return res.json({
        shift,
        remaining_slots: remainingSlots - offers.length,
        max_offers_requested: maxOffersRequested,
        offers,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error creating shift offers transaction:', err);
      return res.status(500).json({ error: 'Failed to create shift offers' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error in POST /api/manager/shifts/:id/offer:', err);
    return res.status(500).json({ error: 'Failed to plan shift offers' });
  }
});

// ---- GET /api/manager/shifts/:id/offers ------------------------------------
//
// Returns a shift plus all its offers for that organisation.

router.get('/shifts/:id/offers', ensureManager, async (req, res) => {
  const orgId = req.user.organisation_id;
  const shiftId = parseInt(req.params.id, 10);

  if (!orgId || Number.isNaN(shiftId)) {
    return res
      .status(400)
      .json({ error: 'Invalid organisation or shift id in request' });
  }

  try {
    const shift = await loadShiftForOrg(shiftId, orgId);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found for organisation' });
    }

    const offersResult = await pool.query(
      `
        SELECT
          so.id,
          so.staff_id,
          so.organisation_id,
          so.shift_id,
          so.status,
          so.source,
          so.created_at,
          so.responded_at,
          so.ai_score,
          so.broadcast_group,
          so.suggested_rate,
          st.name AS staff_name,
          st.phone_number AS staff_phone
        FROM shift_offers so
        LEFT JOIN staff st ON so.staff_id = st.id
        WHERE so.shift_id = $1
          AND so.organisation_id = $2
        ORDER BY so.id
      `,
      [shiftId, orgId]
    );

    return res.json({
      shift,
      offers: offersResult.rows || [],
    });
  } catch (err) {
    console.error('Error in GET /api/manager/shifts/:id/offers:', err);
    return res.status(500).json({ error: 'Failed to load shift offers' });
  }
});

// ---- POST /api/manager/offers/:id/cancel -----------------------------------
//
// Safely cancel an offer. We **never** set status = 'cancelled' because
// the DB constraint allows only: 'offered', 'accepted', 'declined'.
// Behaviour:
//   - If already 'declined' -> error explaining it's terminal.
//   - If 'offered' -> mark 'declined'.
//   - If 'accepted' -> mark 'declined', remove assignment, decrement number_filled.

router.post('/offers/:id/cancel', ensureManager, async (req, res) => {
  const orgId = req.user.organisation_id;
  const offerId = parseInt(req.params.id, 10);

  if (!orgId || Number.isNaN(offerId)) {
    return res.status(400).json({ error: 'Invalid offer id or organisation' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const offerResult = await client.query(
      `
        SELECT
          so.id,
          so.staff_id,
          so.shift_id,
          so.organisation_id,
          so.status,
          so.responded_at,
          s.number_required,
          s.number_filled
        FROM shift_offers so
        JOIN shifts s ON so.shift_id = s.id
        WHERE so.id = $1
          AND so.organisation_id = $2
      `,
      [offerId, orgId]
    );

    if (offerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Offer not found for organisation' });
    }

    const offer = offerResult.rows[0];

    if (offer.status === 'declined') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:
          "Offer is already in terminal status 'declined' and cannot be cancelled",
      });
    }

    let wasAccepted = false;
    let unassignedAssignments = 0;

    if (offer.status === 'accepted') {
      wasAccepted = true;

      const deleteResult = await client.query(
        `
          DELETE FROM shift_assignments
          WHERE shift_id = $1
            AND staff_id = $2
        `,
        [offer.shift_id, offer.staff_id]
      );

      unassignedAssignments = deleteResult.rowCount || 0;

      await client.query(
        `
          UPDATE shifts
          SET number_filled = GREATEST(number_filled - $1, 0),
              status = CASE
                WHEN number_filled - $1 < number_required AND status = 'Filled'
                  THEN 'Open'
                ELSE status
              END
          WHERE id = $2
        `,
        [unassignedAssignments, offer.shift_id]
      );
    }

    const updatedOfferResult = await client.query(
      `
        UPDATE shift_offers
        SET status = 'declined',
            responded_at = NOW()
        WHERE id = $1
        RETURNING id, staff_id, shift_id, status, responded_at
      `,
      [offerId]
    );

    const updatedOffer = updatedOfferResult.rows[0];

    await client.query('COMMIT');

    return res.json({
      ok: true,
      offer: updatedOffer,
      override: {
        wasAccepted,
        unassignedAssignments,
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('Error in POST /api/manager/offers/:id/cancel:', err);
    return res.status(500).json({ error: 'Failed to cancel offer' });
  } finally {
    client.release();
  }
});

module.exports = router;