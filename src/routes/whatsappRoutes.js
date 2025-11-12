const express = require('express');
const { pool } = require('../utils/db_postgres');
const { getOrCreateStaffByPhone, normalizePhone } = require('../services/staffDirectory');
const { sendWhatsApp } = require('../services/twilioSender');

const router = express.Router();

// Signature check skipped in dev (add later if needed)
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const from = normalizePhone(req.body.From || req.body.from || '');
    const text = String(req.body.Body || req.body.body || '').trim().toLowerCase();

    if (!from || !text) {
      return res.status(400).json({ error: 'Missing From or Body' });
    }

    const staff = await getOrCreateStaffByPhone({ phone: from, organisationName: 'Priory Group' });
    const orgId = staff.organisation_id;

    async function logAttendance(action) {
      const q = await pool.query(
        `INSERT INTO attendance_logs (staff_id, organisation_id, action, source, metadata)
         VALUES ($1,$2,$3,'whatsapp',$4) RETURNING id, occurred_at`,
        [staff.id, orgId, action, JSON.stringify({ via: 'whatsapp' })]
      );
      return q.rows[0];
    }

    let reply = "Sorry, I didn't understand that. Try: checkin, checkout, my shifts, insight today.";

    if (text === 'checkin') {
      const row = await logAttendance('checkin');
      reply = `✅ Checked in at ${new Date(row.occurred_at).toLocaleString()}`;
    } else if (text === 'checkout') {
      const row = await logAttendance('checkout');
      reply = `✅ Checked out at ${new Date(row.occurred_at).toLocaleString()}`;
    } else if (text === 'my shifts') {
      reply = `📅 You have X shifts coming up. (MVP placeholder)`;
    } else if (text === 'insight today') {
      reply = `📊 Wellbeing stable. No alerts today. (MVP placeholder)`;
    }

    await sendWhatsApp(from, reply);
    return res.json({ status: 'ok', to: from, message: reply, staff_id: staff.id });
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
