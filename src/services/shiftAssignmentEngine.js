'use strict';

/**
 * Priory SmartShift – Shift Assignment Engine
 *
 * This service scores staff for a given shift using HR-safe logic:
 * - Hard constraints:
 *   - Must belong to the same organisation
 *   - Must have completed mandatory training
 * - Contract / fairness:
 *   - Prioritise permanent staff until their weekly contract is fulfilled
 *   - Then bank staff, then agency
 *   - Avoid > 6 days per week and excessive weekly hours
 * - Clinical / operational:
 *   - Prefer staff whose home ward matches the shift ward
 *   - Use shift preference (Day / Night / Any)
 */

const pool = require('../db');

// -------------------------
// Helpers
// -------------------------

/**
 * Get a single shift by id, ensuring it belongs to the organisation.
 */
async function getShiftById(shiftId, organisationId) {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        organisation_id,
        ward,
        role_required,
        gender_required,
        number_required,
        number_filled,
        status,
        shift_date,
        start_time,
        end_time,
        shift_ref
      FROM shifts
      WHERE id = $1 AND organisation_id = $2
      LIMIT 1
    `,
    [shiftId, organisationId]
  );

  return rows[0] || null;
}

/**
 * Load all staff for an organisation.
 * We rely only on columns we know exist in your DB.
 */
async function getStaffForOrganisation(organisationId) {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        name,
        ward,
        organisation_id,
        preferred_shift,
        wellbeing_score,
        contracted_hours_per_week,
        staff_type,
        mandatory_training_complete
      FROM staff
      WHERE organisation_id = $1
    `,
    [organisationId]
  );

  return rows.map((row) => {
    const contractHours =
      row.contracted_hours_per_week != null
        ? parseFloat(String(row.contracted_hours_per_week))
        : 37.5;

    const staffType = row.staff_type || 'permanent';

    return {
      id: row.id,
      name: row.name || 'Unknown',
      ward: row.ward || null,
      organisation_id: row.organisation_id,
      preferred_shift: row.preferred_shift || 'Day',
      wellbeing_score: row.wellbeing_score || 0,
      contracted_hours_per_week: isNaN(contractHours) ? 37.5 : contractHours,
      staff_type: staffType,
      mandatory_training_complete:
        row.mandatory_training_complete === null
          ? true
          : !!row.mandatory_training_complete,
    };
  });
}

/**
 * Compute the Monday–Sunday window containing a given date.
 */
function getWeekWindowAround(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun,1=Mon,...
  // Make Monday = start of week
  const diffToMonday = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6

  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diffToMonday);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return { start, end };
}

/**
 * For a set of staff IDs, compute how many hours they are already
 * scheduled/assigned this week (based on shift_assignments + shifts).
 *
 * IMPORTANT FIX:
 * We now correctly use s.organisation_id instead of sa.organisation_id.
 */
async function getWeeklyHoursForStaff(organisationId, staffIds, referenceDate) {
  if (!staffIds || staffIds.length === 0) {
    return {};
  }

  const { start, end } = getWeekWindowAround(referenceDate);

  const { rows } = await pool.query(
    `
      SELECT
        sa.staff_id,
        COALESCE(
          SUM(
            EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0
          ),
          0
        ) AS hours
      FROM shift_assignments sa
      JOIN shifts s ON s.id = sa.shift_id
      WHERE
        s.organisation_id = $1
        AND sa.staff_id = ANY($2::int[])
        AND s.shift_date BETWEEN $3::date AND $4::date
      GROUP BY sa.staff_id
    `,
    [organisationId, staffIds, start.toISOString(), end.toISOString()]
  );

  const result = {};
  for (const row of rows) {
    result[row.staff_id] = parseFloat(row.hours) || 0;
  }
  return result;
}

/**
 * Sometimes we also want how many distinct days the staff already works
 * this week (for "no more than 6 days" rules). We can approximate that.
 */
async function getWeeklyDaysWorkedForStaff(organisationId, staffIds, referenceDate) {
  if (!staffIds || staffIds.length === 0) {
    return {};
  }

  const { start, end } = getWeekWindowAround(referenceDate);

  const { rows } = await pool.query(
    `
      SELECT
        sa.staff_id,
        COUNT(DISTINCT s.shift_date) AS days_worked
      FROM shift_assignments sa
      JOIN shifts s ON s.id = sa.shift_id
      WHERE
        s.organisation_id = $1
        AND sa.staff_id = ANY($2::int[])
        AND s.shift_date BETWEEN $3::date AND $4::date
      GROUP BY sa.staff_id
    `,
    [organisationId, staffIds, start.toISOString(), end.toISOString()]
  );

  const result = {};
  for (const row of rows) {
    result[row.staff_id] = parseInt(row.days_worked, 10) || 0;
  }
  return result;
}

/**
 * Estimate the duration of a shift in hours.
 */
function estimateShiftHours(shift) {
  if (!shift.start_time || !shift.end_time) {
    // Fallback for typical 12h shifts
    return 12;
  }
  const [sh, sm] = String(shift.start_time).split(':').map((x) => parseInt(x, 10) || 0);
  const [eh, em] = String(shift.end_time).split(':').map((x) => parseInt(x, 10) || 0);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  let diffMinutes = endMinutes - startMinutes;
  if (diffMinutes <= 0) {
    diffMinutes += 24 * 60; // cross-midnight
  }
  return diffMinutes / 60;
}

// -------------------------
// Scoring logic
// -------------------------

/**
 * Calculate a score for one staff member for a specific shift.
 */
function scoreStaffForShift(staff, shift, weeklyHoursMap, weeklyDaysMap) {
  let score = 0;
  const reasons = [];
  let eligible = true;

  const shiftHours = estimateShiftHours(shift);
  const weeklyHours = weeklyHoursMap[staff.id] || 0;
  const weeklyDays = weeklyDaysMap[staff.id] || 0;
  const totalIfAssigned = weeklyHours + shiftHours;

  const contractHours = staff.contracted_hours_per_week || 37.5;

  // 1) Hard filters / disqualifiers

  // Mandatory training
  if (!staff.mandatory_training_complete) {
    eligible = false;
    reasons.push('Excluded: mandatory training not complete.');
  }

  // No more than 6 days per week
  if (weeklyDays >= 6) {
    eligible = false;
    reasons.push('Excluded: already at 6 days this week.');
  }

  // Very high hours (hard stop at 60h/week)
  if (weeklyHours >= 60) {
    eligible = false;
    reasons.push(
      `Excluded: already at or above 60 hours this week (${weeklyHours.toFixed(1)}h).`
    );
  }

  // If already ineligible, we still continue scoring lightly so it appears in "full ranked"
  // but managers see clearly that it's not eligible.

  // 2) Staff type priority (permanent > bank > agency)
  if (staff.staff_type === 'permanent') {
    score += 40;
    reasons.push('Staff type: Permanent +40');
  } else if (staff.staff_type === 'bank') {
    score += 20;
    reasons.push('Staff type: Bank +20');
  } else if (staff.staff_type === 'agency') {
    score += 5;
    reasons.push('Staff type: Agency +5');
  } else {
    reasons.push('Staff type: Unknown +0');
  }

  // 3) Home ward familiarity
  if (staff.ward && shift.ward && staff.ward.toLowerCase() === shift.ward.toLowerCase()) {
    score += 30;
    reasons.push(`Home ward match (${shift.ward}) +30`);
  } else if (staff.ward) {
    score += 5;
    reasons.push(`Different ward (home: ${staff.ward}, shift: ${shift.ward || 'n/a'}) +5`);
  }

  // 4) Shift preference
  const pref = (staff.preferred_shift || 'Day').toLowerCase();
  const shiftLabel =
    shift.start_time && parseInt(String(shift.start_time).slice(0, 2), 10) >= 18
      ? 'night'
      : 'day';

  if (pref === 'any') {
    score += 10;
    reasons.push('Flexible shift preference (Any) +10');
  } else if (pref === shiftLabel) {
    score += 15;
    reasons.push(`Shift preference match (${pref}) +15`);
  } else {
    score -= 5;
    reasons.push(`Shift preference mismatch (prefers ${pref}, shift is ${shiftLabel}) -5`);
  }

  // 5) Contract hours fairness
  if (staff.staff_type === 'permanent') {
    const utilisation = totalIfAssigned / (contractHours || 37.5);

    if (utilisation < 0.5) {
      score += 35;
      reasons.push(
        `Contract hours under 50% (${weeklyHours.toFixed(
          1
        )}/${contractHours} after shift) +35`
      );
    } else if (utilisation <= 1.0) {
      score += 20;
      reasons.push(
        `Contract hours between 50–100% (${weeklyHours.toFixed(
          1
        )}/${contractHours} after shift) +20`
      );
    } else {
      score -= 10;
      reasons.push(
        `Already at/over contract hours (${weeklyHours.toFixed(
          1
        )}/${contractHours} before shift) -10`
      );
    }
  } else {
    // Bank / agency – no contract, but we can still gently reward low overall hours
    if (weeklyHours < 24) {
      score += 10;
      reasons.push(`Low hours this week (${weeklyHours.toFixed(1)}h) +10`);
    } else if (weeklyHours > 48) {
      score -= 10;
      reasons.push(`High hours this week (${weeklyHours.toFixed(1)}h) -10`);
    } else {
      reasons.push(`Moderate hours this week (${weeklyHours.toFixed(1)}h) +0`);
    }
  }

  // 6) Burnout / wellbeing (simple placeholder)
  // wellbeing_score assumed 0–100, higher = better.
  if (staff.wellbeing_score <= 0) {
    // neutral
  } else if (staff.wellbeing_score < 30) {
    score -= 5;
    reasons.push(
      `Low wellbeing score (${staff.wellbeing_score}) -5 (avoid overloading this staff).`
    );
  } else if (staff.wellbeing_score > 70) {
    score += 5;
    reasons.push(
      `Good wellbeing score (${staff.wellbeing_score}) +5 (more resilient to extra shifts).`
    );
  }

  return { score, reasons, eligible };
}

// -------------------------
// Public API
// -------------------------

/**
 * Main entry point: compute best staff for a specific shift.
 *
 * Returns:
 * {
 *   shift: { ... },
 *   topRecommendations: [...],
 *   allRanked: [...]
 * }
 */
async function getBestStaffForShift(shiftId, organisationId, options = {}) {
  const client = await pool.connect();
  try {
    const limit = options.limit && options.limit > 0 ? options.limit : 5;

    // 1) Load shift
    const shift = await getShiftById(shiftId, organisationId);
    if (!shift) {
      throw new Error(`Shift ${shiftId} not found for organisation ${organisationId}`);
    }

    // 2) Load staff in org
    const staffList = await getStaffForOrganisation(organisationId);
    if (staffList.length === 0) {
      throw new Error(`No staff found for organisation ${organisationId}`);
    }

    const staffIds = staffList.map((s) => s.id);
    const referenceDate = shift.shift_date || new Date().toISOString().slice(0, 10);

    // 3) Load weekly hours & days
    const [weeklyHoursMap, weeklyDaysMap] = await Promise.all([
      getWeeklyHoursForStaff(organisationId, staffIds, referenceDate),
      getWeeklyDaysWorkedForStaff(organisationId, staffIds, referenceDate),
    ]);

    // 4) Score each staff
    const ranked = staffList.map((staff) => {
      const { score, reasons, eligible } = scoreStaffForShift(
        staff,
        shift,
        weeklyHoursMap,
        weeklyDaysMap
      );

      return {
        staff_id: staff.id,
        staff_name: staff.name,
        staff_type: staff.staff_type,
        ward: staff.ward,
        preferred_shift: staff.preferred_shift,
        contract_hours: staff.contracted_hours_per_week,
        mandatory_training_complete: staff.mandatory_training_complete,
        weekly_hours: weeklyHoursMap[staff.id] || 0,
        weekly_days: weeklyDaysMap[staff.id] || 0,
        score,
        eligible,
        reasons,
      };
    });

    // 5) Sort by score descending
    ranked.sort((a, b) => b.score - a.score);

    // 6) Top N eligible
    const topEligible = ranked.filter((r) => r.eligible).slice(0, limit);

    return {
      shift,
      topRecommendations: topEligible,
      allRanked: ranked,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getBestStaffForShift,
};
