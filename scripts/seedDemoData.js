'use strict';

/**
 * Demo data seeding script for Priory SmartShift
 *
 * - Creates a set of demo staff across all wards (including Featherstone)
 * - Creates demo shifts across several days
 * - Creates some shift offers
 * - Creates attendance logs for a few days
 *
 * Safe behaviour:
 * - If a staff member with the same full_name + ward already exists for org 1,
 *   we re-use that record instead of inserting a duplicate.
 * - Shifts are always inserted as new rows (using generated shift_ref codes).
 */

const pool = require('../src/db');

// Organisation we are seeding for
const ORG_ID = 1;

// Wards (including Featherstone as requested)
const WARDS = [
  'Alder',
  'Woodlands',
  'Willows',
  'Fern',
  'Evergreen',
  'Maples',
  'Redwood',
  'Pankhurst',
  'Cedarwood',
  'Elmswood View',
  'Elmswood House',
  'Featherstone',
];

/**
 * Utility: add N days to today and return a 'YYYY-MM-DD' string
 */
function plusDays(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Create or re-use staff records.
 * Returns an array of { id, full_name, ward, role }.
 */
async function seedStaff() {
  console.log('➡️  Seeding demo staff...');

  const demoStaff = [
    { full_name: 'Prince Opara',    ward: 'Woodlands',    role: 'Healthcare Assistant', preferred_shift: 'Day'   },
    { full_name: 'Sidra Khan',      ward: 'Woodlands',    role: 'Healthcare Assistant', preferred_shift: 'Night' },
    { full_name: 'James Taylor',    ward: 'Alder',        role: 'Registered Nurse',     preferred_shift: 'Day'   },
    { full_name: 'Amelia Clarke',   ward: 'Evergreen',    role: 'Healthcare Assistant', preferred_shift: 'Any'   },
    { full_name: 'Michael Brown',   ward: 'Redwood',      role: 'Registered Nurse',     preferred_shift: 'Night' },
    { full_name: 'Chloe Smith',     ward: 'Featherstone', role: 'Healthcare Assistant', preferred_shift: 'Day'   },
  ];

  const results = [];

  for (const s of demoStaff) {
    // Check if staff already exists for this org + name + ward
    const existing = await pool.query(
      `
        SELECT id
        FROM staff
        WHERE organisation_id = $1
          AND full_name = $2
          AND ward = $3
        LIMIT 1
      `,
      [ORG_ID, s.full_name, s.ward]
    );

    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      console.log(`  ✅ Re-using existing staff: ${s.full_name} (${s.ward}) -> id=${id}`);
      results.push({ id, ...s });
      continue;
    }

    // Insert new staff
    // IMPORTANT: this matches your actual table: no display_name, no staff_type
    const { rows } = await pool.query(
      `
        INSERT INTO staff (
          organisation_id,
          full_name,
          is_active,
          ward,
          role,
          preferred_shift,
          wellbeing_score,
          contracted_hours_per_week
        )
        VALUES (
          $1,
          $2,
          true,
          $3,
          $4,
          $5,
          0,
          37.5
        )
        RETURNING id
      `,
      [
        ORG_ID,
        s.full_name,
        s.ward,
        s.role,
        s.preferred_shift,
      ]
    );

    const id = rows[0].id;
    console.log(`  ➕ Created staff: ${s.full_name} (${s.ward}) -> id=${id}`);
    results.push({ id, ...s });
  }

  console.log(`✅ Staff seeding complete (${results.length} records).`);
  return results;
}

/**
 * Seed demo shifts over several days and wards.
 * Returns an array of inserted shift rows (id, ward, role_required, shift_date, status, etc.).
 */
async function seedShifts() {
  console.log('➡️  Seeding demo shifts...');

  // Build some dates relative to today
  const today   = plusDays(0);
  const tomorrow = plusDays(1);
  const in2Days  = plusDays(2);
  const in3Days  = plusDays(3);
  const in4Days  = plusDays(4);

  const demoShifts = [
    {
      ward: 'Alder',
      role_required: 'Registered Nurse',
      gender_required: 'female',
      number_required: 2,
      number_filled: 2,
      status: 'filled',
      shift_date: today,
      start_time: '07:30:00',
      end_time: '19:30:00',
    },
    {
      ward: 'Woodlands',
      role_required: 'Healthcare Assistant',
      gender_required: 'any',
      number_required: 3,
      number_filled: 1,
      status: 'open',
      shift_date: today,
      start_time: '08:00:00',
      end_time: '20:00:00',
    },
    {
      ward: 'Evergreen',
      role_required: 'Healthcare Assistant',
      gender_required: 'male',
      number_required: 2,
      number_filled: 0,
      status: 'open',
      shift_date: tomorrow,
      start_time: '09:00:00',
      end_time: '21:00:00',
    },
    {
      ward: 'Featherstone',
      role_required: 'Registered Nurse',
      gender_required: 'female',
      number_required: 1,
      number_filled: 0,
      status: 'open',
      shift_date: in2Days,
      start_time: '07:00:00',
      end_time: '19:00:00',
    },
    {
      ward: 'Redwood',
      role_required: 'Healthcare Assistant',
      gender_required: 'any',
      number_required: 2,
      number_filled: 1,
      status: 'open',
      shift_date: in3Days,
      start_time: '08:00:00',
      end_time: '20:00:00',
    },
    {
      ward: 'Maples',
      role_required: 'Registered Nurse',
      gender_required: 'any',
      number_required: 1,
      number_filled: 1,
      status: 'filled',
      shift_date: in4Days,
      start_time: '07:30:00',
      end_time: '19:30:00',
    },
  ];

  const results = [];
  let counter = 200; // To generate unique-ish shift_ref codes

  for (const s of demoShifts) {
    const prefix = s.ward.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SHF';
    const shiftRef = `${prefix}-${counter}`;
    counter++;

    const { rows } = await pool.query(
      `
        INSERT INTO shifts (
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
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )
        RETURNING *
      `,
      [
        ORG_ID,
        s.ward,
        s.role_required,
        s.gender_required,
        s.number_required,
        s.number_filled,
        s.status,
        s.shift_date,
        s.start_time,
        s.end_time,
        shiftRef,
      ]
    );

    const row = rows[0];
    console.log(
      `  ➕ Created shift ${row.shift_ref} (${row.ward} – ${row.role_required} on ${row.shift_date.toISOString().slice(0,10)})`
    );
    results.push(row);
  }

  console.log(`✅ Shift seeding complete (${results.length} records).`);
  return results;
}

/**
 * Seed some shift offers for open shifts.
 * Ties offers to the first few demo staff.
 */
async function seedShiftOffers(staff, shifts) {
  console.log('➡️  Seeding demo shift offers...');

  // Filter open shifts
  const openShifts = shifts.filter(s => s.status === 'open');
  if (openShifts.length === 0) {
    console.log('  ⚠️ No open shifts found, skipping offers.');
    return;
  }

  // Use some staff to attach offers
  const staffForOffers = staff.slice(0, 3);
  if (staffForOffers.length === 0) {
    console.log('  ⚠️ No staff found, skipping offers.');
    return;
  }

  let count = 0;

  for (const shift of openShifts) {
    for (const st of staffForOffers) {
      // Only offer if ward roughly matches or is random-ish
      if (st.ward !== shift.ward && Math.random() < 0.5) continue;

      await pool.query(
        `
          INSERT INTO shift_offers (
            shift_id,
            staff_id,
            status,
            offered_at
          )
          VALUES ($1, $2, 'offered', NOW())
        `,
        [shift.id, st.id]
      );

      console.log(`  ➕ Created offer: shift ${shift.shift_ref} -> ${st.full_name}`);
      count++;
    }
  }

  console.log(`✅ Shift offers seeding complete (${count} offers created).`);
}

/**
 * Seed attendance logs for a few days for the first staff record.
 */
async function seedAttendance(staff) {
  console.log('➡️  Seeding demo attendance logs...');

  if (staff.length === 0) {
    console.log('  ⚠️ No staff found, skipping attendance logs.');
    return;
  }

  const primary = staff[0]; // Just use the first staff member
  console.log(`  Using staff for attendance: ${primary.full_name} (id=${primary.id})`);

  const daysBack = [3, 2, 1]; // 3 days ago, 2 days ago, yesterday

  let count = 0;

  for (const n of daysBack) {
    const dateStr = plusDays(-n); // N days in the past

    const checkin = new Date(`${dateStr}T07:30:00Z`);
    const checkout = new Date(`${dateStr}T19:45:00Z`);

    await pool.query(
      `
        INSERT INTO attendance_logs (
          staff_id,
          organisation_id,
          action,
          source,
          occurred_at,
          metadata
        )
        VALUES ($1,$2,'checkin','whatsapp',$3,'{}'::jsonb),
               ($1,$2,'checkout','whatsapp',$4,'{}'::jsonb)
      `,
      [primary.id, ORG_ID, checkin, checkout]
    );

    console.log(`  ➕ Inserted check-in & checkout for ${primary.full_name} on ${dateStr}`);
    count += 2;
  }

  console.log(`✅ Attendance seeding complete (${count} log entries).`);
}

/**
 * Main runner
 */
(async function run() {
  console.log('🚀 Starting Priory SmartShift demo data seeding...');

  try {
    await pool.query('BEGIN');

    const staff = await seedStaff();
    const shifts = await seedShifts();
    await seedShiftOffers(staff, shifts);
    await seedAttendance(staff);

    await pool.query('COMMIT');
    console.log('🎉 Demo data seeding completed successfully.');
  } catch (err) {
    console.error('❌ Error during demo data seeding, rolling back...', err);
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('❌ Error during ROLLBACK:', rollbackErr);
    }
  } finally {
    // Close DB pool cleanly
    await pool.end();
    console.log('🔚 Database connection closed.');
  }
})();
