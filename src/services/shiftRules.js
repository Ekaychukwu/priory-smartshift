// src/services/shiftRules.js
//
// Pure business-rule helpers for shifts and assignments.
// These functions do NOT talk to the database directly. They just
// work with plain JS objects so they are easy to test and reuse.
//
// Key Priory assumptions:
//   - DAY shift:   07:30–20:00  (same calendar day)
//   - NIGHT shift: 19:30–08:00  (crosses midnight into next day)
//
// UK Working Time style constraints we reflect here:
//   - Hard: no more than 6 consecutive working days (7th blocked).
//   - Hard: minimum rest period between shifts (default 11 hours).
//   - Soft: 48h weekly limit is treated as a WARNING (WTR guidance),
//           not a hard block, but we also support a higher hard cap
//           (e.g. 72h) in line with 6×12h patterns if Priory allows
//           staff to opt out.
//
// These helpers will be called by manager/offer endpoints, e.g.:
//
//   1) Load staff's existing assignments from the database.
//   2) Build plain JS objects for those shifts.
//   3) Construct the new shift object.
//   4) Run these checks before inserting a new assignment.
//

/**
 * Convert a date string and time string into a JavaScript Date.
 *
 * dateStr: e.g. "2025-11-20T00:00:00.000Z" or "2025-11-20"
 * timeStr: e.g. "07:30" or "19:30"
 *
 * If timeStr is missing, we just use whatever time is already inside dateStr.
 */
function toDateTime(dateStr, timeStr) {
  if (!dateStr) return null;

  const base = new Date(dateStr);
  if (Number.isNaN(base.getTime())) return null;

  if (!timeStr) {
    return base;
  }

  const [hh, mm] = String(timeStr).split(':');
  if (hh === undefined || mm === undefined) {
    return base;
  }

  const result = new Date(base);
  result.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
  return result;
}

/**
 * Normalise a shift into a [start, end) range (as Date objects),
 * correctly handling night shifts that cross midnight.
 *
 * Example:
 *   shift_date: "2025-11-20"
 *   start_time: "19:30"
 *   end_time:   "08:00"
 *
 *   => start = 2025-11-20 19:30
 *      end   = 2025-11-21 08:00  (we add 1 day for the end)
 */
function getShiftRange(shift) {
  const start = toDateTime(shift.shift_date, shift.start_time);
  const endRaw = toDateTime(shift.shift_date, shift.end_time);

  if (!start || !endRaw) return { start: null, end: null };

  let end = new Date(endRaw);

  // If end time is <= start time, assume it crosses midnight:
  // e.g. start 19:30, end 08:00 => treat end as next day.
  if (end <= start) {
    end = new Date(end.getTime());
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

/**
 * Estimate the number of hours for a shift.
 * Returns a floating-point number (can be fractional).
 */
function getShiftDurationHours(shift) {
  const { start, end } = getShiftRange(shift);
  if (!start || !end || end <= start) return 0;

  const ms = end.getTime() - start.getTime();
  const hours = ms / (1000 * 60 * 60);
  return hours;
}

/**
 * Determine if a shift is considered a "night" shift.
 *
 * Rules:
 *   - If it crosses midnight (endDate > startDate), treat as night.
 *   - OR, if start is before 06:00, or on/after 20:00, treat as night.
 */
function isNightShift(shift) {
  const { start, end } = getShiftRange(shift);
  if (!start || !end) return false;

  // Crossing midnight?
  if (end.getDate() !== start.getDate()) {
    return true;
  }

  const startHour = start.getHours();

  if (startHour < 6) return true;
  if (startHour >= 20) return true;

  return false;
}

/**
 * Classify a shift as "day", "night" or "unknown".
 *
 * DAY:   mostly between ~06:00 and ~22:00 same day.
 * NIGHT: identified by isNightShift.
 */
function getShiftType(shift) {
  if (isNightShift(shift)) return 'night';

  const { start, end } = getShiftRange(shift);
  if (!start || !end) return 'unknown';

  const startHour = start.getHours();
  const endHour = end.getHours();

  if (startHour >= 6 && endHour <= 22) {
    return 'day';
  }

  return 'unknown';
}

/**
 * Check if two shifts overlap in time.
 *
 * Each shift is treated as a [start, end) interval in actual time,
 * with night shifts correctly extended to the next day.
 *
 * This is the core "no double-booking" rule.
 */
function shiftsOverlap(shiftA, shiftB) {
  const rangeA = getShiftRange(shiftA);
  const rangeB = getShiftRange(shiftB);

  const startA = rangeA.start;
  const endA = rangeA.end;
  const startB = rangeB.start;
  const endB = rangeB.end;

  if (!startA || !endA || !startB || !endB) {
    // If we don't have proper times, assume no overlap for now.
    return false;
  }

  if (endA <= startA || endB <= startB) {
    // Zero or negative length shifts -> ignore
    return false;
  }

  // Overlap exists if each starts before the other ends.
  return startA < endB && startB < endA;
}

/**
 * Compute the total hours worked by a staff member over a list
 * of assignments within a given time window.
 *
 * We count shifts whose START is inside the window.
 */
function calculateTotalHoursInWindow(assignments, windowStart, windowEnd) {
  if (!Array.isArray(assignments) || !windowStart || !windowEnd) {
    return 0;
  }

  let totalHours = 0;

  for (const a of assignments) {
    const { start } = getShiftRange(a);
    if (!start) continue;

    if (start >= windowStart && start <= windowEnd) {
      const hours = getShiftDurationHours(a);
      totalHours += hours;
    }
  }

  return totalHours;
}

/**
 * Weekly hours check with:
 *   - soft WTR warning at 48h
 *   - hard cap (default 72h)
 *
 * Arguments:
 *   assignments: existing assignments for staff
 *   newShift:    the shift we want to add
 *   options: {
 *     softThresholdHours?: number   // default 48
 *     hardCapHours?: number         // default 72
 *   }
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     totalHoursWithNew: number,
 *     legalWarning?: string,
 *     breachedHardCap?: boolean,
 *     reason?: string
 *   }
 */
function checkWeeklyHoursLimit(assignments, newShift, options = {}) {
  const softThreshold = options.softThresholdHours ?? 48; // WTR guidance
  const hardCap = options.hardCapHours ?? 72;             // 6×12h

  const { start: newStart } = getShiftRange(newShift);
  if (!newStart) {
    return {
      ok: true,
      totalHoursWithNew: 0,
      reason: 'New shift has no valid start date/time; skipping weekly hours check',
    };
  }

  const windowEnd = new Date(newStart);
  const windowStart = new Date(newStart);
  windowStart.setDate(windowStart.getDate() - 6); // last 7 days including today

  const existingHours = calculateTotalHoursInWindow(
    assignments,
    windowStart,
    windowEnd
  );

  const newHours = getShiftDurationHours(newShift);
  const total = existingHours + newHours;

  const result = {
    ok: true,
    totalHoursWithNew: total,
  };

  // Hard cap: if we go beyond hardCap, block.
  if (total > hardCap) {
    result.ok = false;
    result.breachedHardCap = true;
    result.reason = `Weekly hours hard cap exceeded: ${total.toFixed(
      1
    )}h > ${hardCap}h`;
    return result;
  }

  // Soft WTR-warning threshold at 48h: allow but flag.
  if (total > softThreshold) {
    result.legalWarning = `Weekly hours above UK WTR guidance (48h). Total with this shift: ${total.toFixed(
      1
    )}h`;
  }

  return result;
}

/**
 * Check a simple night-shift rule over a rolling window.
 *
 * Example rule:
 *   - No more than X night shifts in the last Y days.
 */
function checkNightShiftLimit(assignments, newShift, maxNights = 4, windowDays = 14) {
  const { start: newStart } = getShiftRange(newShift);
  if (!newStart) {
    return {
      ok: true,
      totalNightsWithNew: 0,
      reason: 'New shift has no valid start date/time; skipping night shift check',
    };
  }

  if (!isNightShift(newShift)) {
    // If the new shift is not a night shift, it never violates the night rule.
    return {
      ok: true,
      totalNightsWithNew: 0,
    };
  }

  const windowEnd = new Date(newStart);
  const windowStart = new Date(newStart);
  windowStart.setDate(windowStart.getDate() - (windowDays - 1));

  let nightCount = 0;

  for (const a of assignments) {
    const { start } = getShiftRange(a);
    if (!start) continue;

    if (start >= windowStart && start <= windowEnd && isNightShift(a)) {
      nightCount += 1;
    }
  }

  const totalWithNew = nightCount + 1;

  if (totalWithNew > maxNights) {
    return {
      ok: false,
      totalNightsWithNew: totalWithNew,
      reason: `Night shift limit exceeded: ${totalWithNew} > ${maxNights} in ${windowDays} days`,
    };
  }

  return {
    ok: true,
    totalNightsWithNew: totalWithNew,
  };
}

/**
 * Check if a new shift overlaps with any of the existing assignments.
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     conflictingShift?: object,
 *     reason?: string
 *   }
 */
function checkDoubleBooking(assignments, newShift) {
  for (const a of assignments) {
    if (shiftsOverlap(a, newShift)) {
      return {
        ok: false,
        conflictingShift: a,
        reason: 'New shift overlaps with an existing assignment',
      };
    }
  }

  return { ok: true };
}

/**
 * Check that there is a minimum rest period between the end of any
 * existing shift and the start of the new shift.
 *
 * This supports safe scheduling under UK-style rules: typically
 * 11 hours uninterrupted rest in each 24-hour period.
 *
 * Example:
 *   minRestHours = 11
 */
function checkRestPeriod(assignments, newShift, minRestHours = 11) {
  const { start: newStart } = getShiftRange(newShift);
  if (!newStart) {
    return {
      ok: true,
      reason: 'New shift has no valid start date/time; skipping rest-period check',
    };
  }

  for (const a of assignments) {
    const { start: prevStart, end: prevEnd } = getShiftRange(a);
    if (!prevStart || !prevEnd || prevEnd <= prevStart) continue;

    const gapHours = (newStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60);

    // If new shift starts after previous one
    if (gapHours > 0 && gapHours < minRestHours) {
      const prevType = getShiftType(a);
      const newType = getShiftType(newShift);

      return {
        ok: false,
        reason: `Insufficient rest between shifts (${gapHours.toFixed(
          1
        )}h < ${minRestHours}h). Previous shift type: ${prevType}, new shift type: ${newType}`,
        previousShift: a,
      };
    }
  }

  return { ok: true };
}

/**
 * Helper to normalise a date to YYYY-MM-DD string (no time).
 */
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check that a staff member is not working more than maxDays
 * on consecutive calendar days.
 *
 * This enforces:
 *   - "Staff can work no more than 6 days"
 *
 * With maxDays = 6:
 *   - 1–6 consecutive days => allowed
 *   - 7th day in a row     => blocked
 */
function checkConsecutiveDaysLimit(assignments, newShift, maxDays = 6) {
  const { start: newStart } = getShiftRange(newShift);
  if (!newStart) {
    return {
      ok: true,
      reason: 'New shift has no valid start date/time; skipping consecutive-days check',
    };
  }

  // Build a set of calendar days where the staff already has shifts
  const workedDays = new Set();

  for (const a of assignments) {
    const { start } = getShiftRange(a);
    if (!start) continue;
    workedDays.add(toDateKey(start));
  }

  // Include the new shift day
  workedDays.add(toDateKey(newStart));

  // Starting from the new shift date and going backwards,
  // count how many consecutive days are in the set.
  let streak = 0;
  const cursor = new Date(newStart);

  while (true) {
    const key = toDateKey(cursor);
    if (workedDays.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  if (streak > maxDays) {
    return {
      ok: false,
      streak,
      reason: `Consecutive days limit exceeded: ${streak} > ${maxDays}`,
    };
  }

  return { ok: true, streak };
}

/**
 * Stub rule for training compliance:
 *
 * The system should prevent staff from picking shifts where they have
 * overdue mandatory training, unless a ward manager explicitly overrides.
 *
 * Real implementation will plug in data from the Compliance / Priory Academy
 * integration. For now this just shows how the rule will be called.
 *
 * Arguments:
 *   trainingStatus: object like
 *     {
 *       isCompliant: boolean,
 *       overdueCourses: string[]
 *     }
 *   allowManagerOverride: boolean
 */
function checkMandatoryTraining(trainingStatus, allowManagerOverride = false) {
  if (!trainingStatus) {
    // If we know nothing, allow by default (we will tighten later once data flows).
    return {
      ok: true,
      reason: 'No training data available; defaulting to allow',
    };
  }

  if (trainingStatus.isCompliant) {
    return { ok: true };
  }

  if (allowManagerOverride) {
    return {
      ok: true,
      reason:
        'Mandatory training overdue but manager override is allowed for this operation',
      overdueCourses: trainingStatus.overdueCourses || [],
    };
  }

  return {
    ok: false,
    overdueCourses: trainingStatus.overdueCourses || [],
    reason:
      'Mandatory training overdue; staff cannot take this shift without manager override',
  };
}

module.exports = {
  toDateTime,
  getShiftRange,
  getShiftDurationHours,
  isNightShift,
  getShiftType,
  shiftsOverlap,
  calculateTotalHoursInWindow,
  checkWeeklyHoursLimit,
  checkNightShiftLimit,
  checkDoubleBooking,
  checkRestPeriod,
  checkConsecutiveDaysLimit,
  checkMandatoryTraining,
};
