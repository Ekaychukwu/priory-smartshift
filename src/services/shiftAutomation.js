const { pool } = require('../utils/db_postgres');
const { sendWhatsApp } = require('./twilioSender');

/**
 * Determine if this is a day or night shift based on start_time.
 */
function getShiftType(shift) {
  if (!shift.start_time) return 'Unknown';
  const hour = parseInt(shift.start_time.substring(0, 2), 10);
  return hour < 14 ? 'Day Shift' : 'Night Shift';
}

/**
 * Format the shift alert message using your Priory-style template.
 */
function formatShiftAlertMessage({ shift, staff, siteInfo, shiftType }) {
  const d = new Date(shift.shift_date);
  const dateLabel = d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const start = shift.start_time ? shift.start_time.substring(0, 5) : 'TBC';
  const end   = shift.end_time ? shift.end_time.substring(0, 5) : 'TBC';
  const role  = shift.role_required || 'Support Worker';
  const gender = shift.gender_required || 'both';
  const needed = shift.number_required || 1;

  const companyName = siteInfo.companyName || 'The Priory Group';
  const siteName    = siteInfo.siteName    || 'The Priory Hospital Cheadle Royal';
  const postcode    = siteInfo.postcode    || 'SK8 3DG';

  return (
    '🚨 *SHIFT ALERT* 🚨\n' +
    `*${companyName} – ${siteName}*\n` +
    `�� ${postcode}\n\n` +
    'Hi All,\n\n' +
    `I require a *${role}* for the below:\n\n` +
    `• ${dateLabel} – ${shiftType}\n` +
    `• *Time:* ${start} – ${end}\n` +
    `• *Staff Needed:* ${needed} (${gender})\n\n` +
    'Reply *ACCEPT* to take this shift or *DECLINE* if unavailable.'
  );
}

/**
 * Compute AI-style scores for each staff member for a given shift.
 * Lower recent workload + matching preferred_shift = higher score.
 */
async function computeStaffScoresForShift(organisationId, shiftId) {
  const { rows: [shift] } = await pool.query(
    `SELECT id, organisation_id, ward, shift_date, shift_ref,
            start_time, end_time, role_required, gender_required, number_required
     FROM shifts
     WHERE id = $1 AND organisation_id = $2`,
    [shiftId, organisationId]
  );

  if (!shift) {
    throw new Error('Shift not found for this organisation');
  }

  // All staff in the org with a WhatsApp-capable phone number
  const { rows: staffList } = await pool.query(
    `SELECT id, name, phone_number, preferred_shift
     FROM staff
     WHERE organisation_id = $1
       AND phone_number IS NOT NULL
       AND phone_number <> ''`,
    [organisationId]
  );

  if (!staffList.length) {
    return { shift, scores: [] };
  }

  const since7DaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to7DaysAhead  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const scores = [];

  for (const staff of staffList) {
    const { rows: [row] } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM shift_assignments sa
          JOIN shifts s ON sa.shift_id = s.id
          WHERE sa.staff_id = $1
            AND s.shift_date >= $2
            AND s.shift_date <= NOW()) AS shifts_last7,
         (SELECT COUNT(*) FROM shift_assignments sa2
          JOIN shifts s2 ON sa2.shift_id = s2.id
          WHERE sa2.staff_id = $1
            AND s2.shift_date > NOW()
            AND s2.shift_date <= $3) AS shifts_next7`,
      [staff.id, since7DaysAgo, to7DaysAhead]
    );

    const last7 = parseInt(row.shifts_last7 ?? 0, 10) || 0;
    const next7 = parseInt(row.shifts_next7 ?? 0, 10) || 0;

    let base = 100;
    base -= last7 * 8;   // penalise heavy recent workload
    base -= next7 * 5;   // penalise lots of upcoming shifts

    const shiftType = getShiftType(shift);
    const pref = (staff.preferred_shift || '').toLowerCase();

    if (shiftType === 'Day Shift' && pref.includes('day')) {
      base += 10;
    } else if (shiftType === 'Night Shift' && pref.includes('night')) {
      base += 10;
    }

    scores.push({
      staff,
      score: base,
      last7,
      next7,
      shiftType,
    });
  }

  scores.sort((a, b) => b.score - a.score);

  return { shift, scores };
}

/**
 * Create offers for the top N staff, insert into shift_offers and send WhatsApp alerts.
 */
async function offerShiftToTopStaff({
  organisationId,
  shiftId,
  maxOffers = 3,
  suggestedRate = null,
  siteInfo = {},
}) {
  const { shift, scores } = await computeStaffScoresForShift(organisationId, shiftId);

  if (!scores.length) {
    return { shift, offers: [], message: 'No staff with WhatsApp numbers found.' };
  }

  const broadcastGroup = `shift-${shiftId}-${Date.now()}`;
  const top = scores.slice(0, maxOffers);
  const offers = [];

  for (const item of top) {
    const staff = item.staff;
    const aiScore = item.score;
    const shiftType = item.shiftType;

    const { rows: [offer] } = await pool.query(
      `INSERT INTO shift_offers
         (staff_id, organisation_id, shift_id, status, ai_score, broadcast_group, suggested_rate)
       VALUES ($1,$2,$3,'offered',$4,$5,$6)
       RETURNING id`,
      [staff.id, organisationId, shiftId, aiScore, broadcastGroup, suggestedRate]
    );

    const message = formatShiftAlertMessage({ shift, staff, siteInfo, shiftType });

    const toPhone = staff.phone_number.replace(/^whatsapp:/, '');

    await sendWhatsApp(toPhone, message);

    offers.push({
      offer_id: offer.id,
      staff_id: staff.id,
      staff_name: staff.name,
      phone_number: staff.phone_number,
      ai_score: aiScore,
    });
  }

  return {
    shift: {
      id: shift.id,
      ward: shift.ward,
      shift_date: shift.shift_date,
      shift_ref: shift.shift_ref,
    },
    broadcast_group: broadcastGroup,
    offers,
  };
}

module.exports = {
  computeStaffScoresForShift,
  offerShiftToTopStaff,
};
