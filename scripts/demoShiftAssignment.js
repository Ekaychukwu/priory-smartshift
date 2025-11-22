'use strict';

/**
 * Priory SmartShift – Demo: Shift Assignment Engine
 *
 * This script:
 *  1) Connects to the Postgres DB
 *  2) Loads the NEXT upcoming shift for organisation 1
 *  3) Loads all staff for organisation 1
 *  4) Builds a basic context (recent work stats)
 *  5) Calls the shiftAssignmentEngine
 *  6) Prints a ranked list of recommendations
 */

const pool = require('../src/db');
const {
  recommendStaffForShift,
  pickTopEligible,
} = require('../src/services/shiftAssignmentEngine');

const ORG_ID = 1;

/**
 * Load the next upcoming shift for the organisation.
 */
async function loadNextShift() {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM shifts
      WHERE organisation_id = $1
        AND shift_date >= CURRENT_DATE
      ORDER BY shift_date ASC, start_time ASC
      LIMIT 1
    `,
    [ORG_ID]
  );

  return rows[0] || null;
}

/**
 * Load all staff for the organisation.
 */
async function loadStaff() {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM staff
      WHERE organisation_id = $1
      ORDER BY id ASC
    `,
    [ORG_ID]
  );

  return rows;
}

/**
 * Build a basic context object for the assignment engine.
 *
 * For now we will:
 *  - Use attendance_logs to estimate days worked in last 7 days
 *  - Use check-ins as a proxy for days worked
 *
 * You can make this smarter later (e.g. pair check-in/checkout to get real hours).
 */
async function buildContext() {
  const context = {
    statsByStaffId: {},
    statusByStaffId: {},
    recentShiftsByStaffId: {},
    trainingByStaffId: {},
    reliabilityByStaffId: {},
    staffTypeByStaffId: {},
    contractHoursByStaffId: {},
  };

  // 1) Approx stats from attendance_logs
  const statsRes = await pool.query(
    `
      SELECT
        staff_id,
        COUNT(*) FILTER (
          WHERE action = 'checkin'
            AND occurred_at >= (CURRENT_DATE - INTERVAL '7 days')
        ) AS checkins_last7
      FROM attendance_logs
      WHERE organisation_id = $1
      GROUP BY staff_id
    `,
    [ORG_ID]
  );

  for (const row of statsRes.rows) {
    const staffId = row.staff_id;
    const checkinsLast7 = Number(row.checkins_last7 || 0);

    context.statsByStaffId[staffId] = {
      // Very rough: assume 1 check-in = 1 worked day and 12h shift
      daysWorkedLast7: checkinsLast7,
      hoursThisWeek: checkinsLast7 * 12,
    };
  }

  // 2) For now, mark everyone as "free" in status
  // (Later: wire this to live observation data)
  // We'll fill this dynamically when we know staff IDs.
  // For now we just return the context object; caller can still use it.

  return context;
}

/**
 * Pretty-print recommendations in a readable format.
 */
function printRecommendations(shift, recommendations, topOnly) {
  const date = new Date(shift.shift_date);
  const dateLabel = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  console.log('\n==============================');
  console.log(' Shift assignment demo result ');
  console.log('==============================\n');
  console.log(
    `Shift: ${shift.shift_ref || '(no ref)'} | ` +
      `${shift.ward} | ${shift.role_required} | ${dateLabel} ` +
      `(${String(shift.start_time).slice(0, 5)}–${String(shift.end_time).slice(0, 5)})`
  );
  console.log('');

  const list = topOnly || recommendations;

  if (!list || list.length === 0) {
    console.log('No staff found.');
    return;
  }

  list.forEach((item, index) => {
    const rank = index + 1;
    const badge = item.eligible ? '✅ Eligible' : '�� Ineligible';
    console.log(
      `${rank}. ${item.staffName} (id=${item.staffId}) – score: ${item.score} | ${badge}`
    );

    if (!item.eligible) {
      console.log('   Reasons:');
      for (const r of item.eligibilityReasons || []) {
        console.log(`     • ${r}`);
      }
    } else {
      console.log('   Why chosen:');
      for (const reason of item.breakdown || []) {
        console.log(`     • ${reason}`);
      }
    }
    console.log('');
  });
}

/**
 * Main runner
 */
async function run() {
  console.log('🧠 Priory SmartShift – Demo shift assignment\n');

  try {
    const shift = await loadNextShift();
    if (!shift) {
      console.log('⚠️ No upcoming shifts found for organisation 1.');
      return;
    }

    console.log(
      `➡️ Using next upcoming shift id=${shift.id} (${shift.ward} – ${shift.role_required} on ${shift.shift_date})`
    );

    const staffList = await loadStaff();
    console.log(`➡️ Loaded ${staffList.length} staff for organisation 1`);

    const context = await buildContext();

    // Call the engine
    const recommendations = recommendStaffForShift(shift, staffList, context);
    const top5 = pickTopEligible(recommendations, 5);

    console.log('\n⭐ Top recommended staff (eligible only):');
    printRecommendations(shift, top5);

    console.log('\n📊 Full ranked list (including ineligible):');
    printRecommendations(shift, recommendations);
  } catch (err) {
    console.error('❌ Error running demo assignment script:', err);
  } finally {
    await pool.end();
    console.log('\n🔚 Database connection closed.');
  }
}

// Execute if run directly
if (require.main === module) {
  run();
}

