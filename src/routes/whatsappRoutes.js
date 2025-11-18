'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getOrCreateStaffByPhone } = require('../services/staffDirectory');
const twilioSender = require('../services/twilioSender');

// -------------------------
// Helpers
// -------------------------

function normaliseWhatsAppNumber(fromRaw) {
  if (!fromRaw) return '';
  const s = String(fromRaw).trim();
  // Twilio usually sends "whatsapp:+4479..."
  return s.replace(/^whatsapp:/i, '');
}

async function replyWhatsApp(toPhone, message) {
  const phone = String(toPhone || '').trim();
  const body = String(message || '').trim();

  if (!phone || !body) {
    console.error('[Twilio] Cannot send WhatsApp message – missing phone or body', {
      toPhone: phone,
      bodyLength: body.length,
    });
    return;
  }

  try {
    await twilioSender.sendWhatsAppMessage({
      to: `whatsapp:${phone}`,
      body,
    });
    console.log('[Twilio] WhatsApp message sent via API helper');
  } catch (err) {
    console.error('[Twilio] Failed to send WhatsApp reply:', err);
  }
}

function formatShiftDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// -------------------------
// Command Handlers
// -------------------------

async function handleMenuCommand(fromPhone) {
  const menuText =
    '📱 *Priory SmartShift – WhatsApp menu*\n\n' +
    'Type any of the following commands:\n' +
    '• 🧾 *MENU* or *HELP* – show this list\n' +
    '• 🕒 *CHECKIN* – log your attendance at the start of a shift\n' +
    '• 🏁 *CHECKOUT* – log your attendance at the end of a shift\n' +
    '• 📅 *MY SHIFTS* – see your upcoming shifts\n' +
    '• 📊 *INSIGHT TODAY* – staffing & wellbeing insight\n' +
    '• ✅ *ACCEPT* – accept your latest shift offer\n' +
    '• ❌ *DECLINE* – decline your latest shift offer\n';

  await replyWhatsApp(fromPhone, menuText);
}

async function handleCheckinCommand(fromPhone, organisationId) {
  console.log('[CHECKIN] Start for', fromPhone, 'org', organisationId);

  const staff = await getOrCreateStaffByPhone(fromPhone, organisationId);
  console.log('[CHECKIN] Staff record:', staff);

  const { rows } = await pool.query(
    `
      SELECT id, staff_id, organisation_id, action, source, occurred_at
      FROM attendance_logs
      WHERE staff_id = $1 AND organisation_id = $2
      ORDER BY occurred_at DESC
      LIMIT 1
    `,
    [staff.id, organisationId]
  );

  const last = rows[0] || null;
  console.log('[CHECKIN] Last log for staff', staff.id, last);

  if (last && last.action === 'checkin') {
    const msg =
      '⚠️ You are already *checked in* for your current shift.\n\n' +
      'If this seems wrong, please speak with your ward manager.';
    await replyWhatsApp(fromPhone, msg);
    return;
  }

  await pool.query(
    `
      INSERT INTO attendance_logs (staff_id, organisation_id, action, source, occurred_at, metadata)
      VALUES ($1, $2, 'checkin', 'whatsapp', NOW(), '{}'::jsonb)
    `,
    [staff.id, organisationId]
  );

  const msg =
    `✅ Thank you *${staff.name}*, your *check-in* has been recorded.\n\n` +
    '🩺 Have a safe and productive shift.';
  await replyWhatsApp(fromPhone, msg);
}

async function handleCheckoutCommand(fromPhone, organisationId) {
  console.log('[CHECKOUT] Start for', fromPhone, 'org', organisationId);

  const staff = await getOrCreateStaffByPhone(fromPhone, organisationId);
  console.log('[CHECKOUT] Staff record:', staff);

  const { rows } = await pool.query(
    `
      SELECT id, staff_id, organisation_id, action, source, occurred_at
      FROM attendance_logs
      WHERE staff_id = $1 AND organisation_id = $2
      ORDER BY occurred_at DESC
      LIMIT 1
    `,
    [staff.id, organisationId]
  );

  const last = rows[0] || null;
  console.log('[CHECKOUT] Last log for staff', staff.id, last);

  if (!last || last.action !== 'checkin') {
    const msg =
      "⚠️ You don't appear to be *currently checked in*.\n\n" +
      'If this seems wrong, please speak with your ward manager.';
    await replyWhatsApp(fromPhone, msg);
    return;
  }

  await pool.query(
    `
      INSERT INTO attendance_logs (staff_id, organisation_id, action, source, occurred_at, metadata)
      VALUES ($1, $2, 'checkout', 'whatsapp', NOW(), '{}'::jsonb)
    `,
    [staff.id, organisationId]
  );

  const msg =
    `✅ Thank you *${staff.name}*, your *checkout* has been recorded.\n\n` +
    '😌 Have a good rest after your shift.';
  await replyWhatsApp(fromPhone, msg);
}

async function handleMyShiftsCommand(fromPhone, organisationId) {
  const staff = await getOrCreateStaffByPhone(fromPhone, organisationId);
  console.log('[MY SHIFTS] Staff record:', staff);

  const { rows } = await pool.query(
    `
      SELECT
        s.shift_date,
        s.start_time,
        s.end_time,
        s.ward,
        s.role_required,
        s.status,
        s.gender_required
      FROM shift_assignments sa
      JOIN shifts s ON s.id = sa.shift_id
      WHERE sa.staff_id = $1
      ORDER BY s.shift_date ASC, s.start_time ASC
      LIMIT 5
    `,
    [staff.id]
  );

  if (rows.length === 0) {
    const msg =
      '📅 You have *no upcoming shifts* recorded in Priory SmartShift.\n\n' +
      'If you believe this is wrong, please speak with your ward manager.';
    await replyWhatsApp(fromPhone, msg);
    return;
  }

  let text = `📅 *Here are your next ${rows.length} shift(s):*\n\n`;

  for (const r of rows) {
    const dateLabel = formatShiftDate(r.shift_date);
    const start = String(r.start_time || '').slice(0, 5);
    const end = String(r.end_time || '').slice(0, 5);

    let genderLabel = '';
    if (r.gender_required === 'male') {
      genderLabel = '♂️ Male only';
    } else if (r.gender_required === 'female') {
      genderLabel = '♀️ Female only';
    } else {
      genderLabel = '⚧ Any gender';
    }

    text +=
      `• ${dateLabel}\n` +
      `  🏥 ${r.ward}\n` +
      `  👩‍⚕️ ${r.role_required}\n` +
      `  ⏰ ${start}–${end}\n` +
      `  ⚧ ${genderLabel}  •  📌 ${r.status}\n\n`;
  }

  await replyWhatsApp(fromPhone, text.trim());
}

async function handleAcceptCommand(fromPhone, organisationId) {
  const staff = await getOrCreateStaffByPhone(fromPhone, organisationId);
  console.log('[ACCEPT] Staff record:', staff);

  const { rows } = await pool.query(
    `
      SELECT *
      FROM shift_offers
      WHERE staff_id = $1
        AND status = 'offered'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [staff.id]
  );

  const offer = rows[0];

  if (!offer) {
    const msg =
      "ℹ️ I couldn't find any *pending shift offers* for you right now.\n\n" +
      'If you believe this is wrong, please speak with your ward manager.';
    await replyWhatsApp(fromPhone, msg);
    return;
  }

  console.log('[ACCEPT] Latest offer row:', offer);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE shift_offers
        SET status = 'accepted',
            responded_at = NOW()
        WHERE id = $1
      `,
      [offer.id]
    );

    await client.query(
      `
        INSERT INTO shift_assignments (shift_id, staff_id, accepted_at)
        VALUES ($1, $2, NOW())
      `,
      [offer.shift_id, staff.id]
    );

    await client.query(
      `
        UPDATE shifts
        SET number_filled = number_filled + 1
        WHERE id = $1
      `,
      [offer.shift_id]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ACCEPT] Error in transaction:', err);
    const msg =
      '❌ Something went wrong while confirming your shift.\n\n' +
      'Please try again or speak with your ward manager.';
    await replyWhatsApp(fromPhone, msg);
    return;
  } finally {
    client.release();
  }

  const msg =
    `✅ Thank you *${staff.name}*, your shift has been *confirmed*.\n\n` +
    'If your availability changes, please inform your ward manager as soon as possible.';
  await replyWhatsApp(fromPhone, msg);
}

async function handleDeclineCommand(fromPhone, organisationId) {
  const staff = await getOrCreateStaffByPhone(fromPhone, organisationId);
  console.log('[DECLINE] Staff record:', staff);

  const { rows } = await pool.query(
    `
      SELECT *
      FROM shift_offers
      WHERE staff_id = $1
        AND status = 'offered'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [staff.id]
  );

  const offer = rows[0];

  if (!offer) {
    const msg =
      "ℹ️ I couldn't find any *pending shift offers* for you right now.\n\n" +
      'If you believe this is wrong, please speak with your ward manager.';
    await replyWhatsApp(fromPhone, msg);
    return;
  }

  await pool.query(
    `
      UPDATE shift_offers
      SET status = 'declined',
          responded_at = NOW()
      WHERE id = $1
    `,
    [offer.id]
  );

  const msg =
    `❌ Thanks *${staff.name}*, we've recorded that you *cannot work* this shift.\n\n` +
    'Your manager may offer this shift to other staff.';
  await replyWhatsApp(fromPhone, msg);
}

async function handleInsightTodayCommand(fromPhone, organisationId) {
  console.log('[INSIGHT TODAY] Start for', fromPhone, 'org', organisationId);

  try {
    // Ward-level view
    const wardRes = await pool.query(
      `
        SELECT
          ward,
          SUM(number_required) AS total_required,
          SUM(number_filled)   AS total_filled
        FROM shifts
        WHERE organisation_id = $1
        GROUP BY ward
        ORDER BY ward
        LIMIT 5
      `,
      [organisationId]
    );

    // Overall coverage
    const overallRes = await pool.query(
      `
        SELECT
          SUM(number_required) AS total_required,
          SUM(number_filled)   AS total_filled
        FROM shifts
        WHERE organisation_id = $1
      `,
      [organisationId]
    );

    // Today’s check-ins
    const attendanceRes = await pool.query(
      `
        SELECT COUNT(*) AS checkins_today
        FROM attendance_logs
        WHERE organisation_id = $1
          AND action = 'checkin'
          AND occurred_at::date = CURRENT_DATE
      `,
      [organisationId]
    );

    const wards = wardRes.rows;
    const overall = overallRes.rows[0] || { total_required: 0, total_filled: 0 };
    const checkinsToday = Number(attendanceRes.rows[0]?.checkins_today || 0);

    const required = Number(overall.total_required || 0);
    const filled = Number(overall.total_filled || 0);
    const remaining = required - filled;

    let text = '📊 *Priory SmartShift – Today’s staffing snapshot*\n\n';

    // Ward-level bullets
    if (wards.length > 0) {
      text += '🏥 *Ward coverage (top 5):*\n';
      for (const w of wards) {
        const req = Number(w.total_required || 0);
        const fil = Number(w.total_filled || 0);
        const rem = req - fil;
        const statusEmoji =
          rem <= 0 ? '✅' : rem <= 2 ? '🟡' : '🔴';

        text +=
          `• ${statusEmoji} *${w.ward}* – req ${req}, filled ${fil}, remaining ${rem < 0 ? 0 : rem}\n`;
      }
      text += '\n';
    } else {
      text += '🏥 No shifts found yet for today.\n\n';
    }

    // Overall picture
    text +=
      '📦 *Overall cover (all wards):*\n' +
      `• Required: ${required}\n` +
      `• Filled:   ${filled}\n` +
      `• Remaining: ${remaining < 0 ? 0 : remaining}\n\n`;

    // Attendance
    text +=
      '🕒 *Attendance (today):*\n' +
      `• WhatsApp check-ins recorded: ${checkinsToday}\n\n`;

    text +=
      '_Note: This is a demo snapshot. The full version will include burnout risk and agency-spend forecasts._';

    await replyWhatsApp(fromPhone, text);
  } catch (err) {
    console.error('[INSIGHT TODAY] Error building insight:', err);
    const msg =
      '❌ Something went wrong while generating today’s insight.\n\n' +
      'Please try again later or speak with your manager.';
    await replyWhatsApp(fromPhone, msg);
  }
}

// -------------------------
// Webhook route
// -------------------------

// IMPORTANT: this MUST be "/webhook" because index.js mounts this router at "/api/whatsapp"
// so the full path is "/api/whatsapp/webhook" which matches your Twilio config.
router.post('/webhook', async (req, res) => {
  const fromRaw = req.body.From || req.body.from || '';
  const bodyRaw = req.body.Body || req.body.body || '';

  console.log('Incoming WhatsApp:', {
    from: fromRaw,
    bodyRaw,
  });

  const from = normaliseWhatsAppNumber(fromRaw);
  const organisationId = 1;

  const command = String(bodyRaw || '').trim();
  const upper = command.toUpperCase();

  console.log('[WEBHOOK] Normalised command:', upper);

  // Respond 200 quickly so Twilio is happy
  res.status(200).send('OK');

  try {
    if (!from) {
      console.error('[WEBHOOK] Missing from phone number');
      return;
    }

    if (!command) {
      await replyWhatsApp(
        from,
        '❓ Sorry, I did not receive any command.\n\nPlease type *MENU* to see options.'
      );
      return;
    }

    if (upper === 'MENU' || upper === 'HELP') {
      await handleMenuCommand(from);
    } else if (upper === 'CHECKIN') {
      await handleCheckinCommand(from, organisationId);
    } else if (upper === 'CHECKOUT') {
      await handleCheckoutCommand(from, organisationId);
    } else if (upper === 'MY SHIFTS') {
      await handleMyShiftsCommand(from, organisationId);
    } else if (upper === 'INSIGHT TODAY') {
      await handleInsightTodayCommand(from, organisationId);
    } else if (upper === 'ACCEPT') {
      await handleAcceptCommand(from, organisationId);
    } else if (upper === 'DECLINE') {
      await handleDeclineCommand(from, organisationId);
    } else {
      const msg =
        "🤔 Sorry, I didn't understand that.\n\n" +
        'Please type *MENU* to see the list of available commands.';
      await replyWhatsApp(from, msg);
    }
  } catch (err) {
    console.error('Error in WhatsApp webhook handler:', err);
    const msg =
      '❌ Something went wrong while processing your request.\n\n' +
      'Please try again or speak with your ward manager.';
    try {
      if (from) {
        await replyWhatsApp(from, msg);
      }
    } catch (e2) {
      console.error('Failed to send error reply to WhatsApp:', e2);
    }
  }
});

module.exports = router;
