const express = require('express');
const { pool } = require('../utils/db_postgres');
const { getOrCreateStaffByPhone, normalizePhone } = require('../services/staffDirectory');
const { sendWhatsApp } = require('../services/twilioSender');

const router = express.Router();

/**
 * Helper: build the WhatsApp menu text.
 */
function buildMenuText() {
  return (
    '�� Welcome to Priory SmartShift.\n\n' +
    'Here are some things you can type:\n\n' +
    '*checkin* – record that you have started your shift\n' +
    '*checkout* – record that you have finished your shift\n' +
    '*my shifts* – see your next few shifts\n' +
    '*my week* or *rota* – summary of your upcoming week\n' +
    '*insight today* – wellbeing / staffing insight\n' +
    '*offers* – see your recent shift offers\n' +
    '*last offer* – details of your last offer\n' +
    '*accept* – accept your latest offer\n' +
    '*decline* – decline your latest offer\n'
  );
}

/**
 * WhatsApp webhook (Twilio hits this).
 */
router.post(
  '/webhook',
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const fromRaw = req.body.From || req.body.from || '';
      const bodyRaw = req.body.Body || req.body.body || '';

      const from = normalizePhone(fromRaw);
      const text = String(bodyRaw || '').trim();

      if (!from || !text) {
        return res.status(400).json({ error: 'Missing From or Body' });
      }

      const cmd = text.toLowerCase();

      // Look up or create the staff record for this phone number
      const staff = await getOrCreateStaffByPhone({
        phone: from,
        organisationName: 'Priory Group',
      });
      const orgId = staff.organisation_id;

      // Helper: log attendance in attendance_logs
      async function logAttendance(action) {
        const q = await pool.query(
          `INSERT INTO attendance_logs (staff_id, organisation_id, action, source, metadata)
           VALUES ($1,$2,$3,'whatsapp',$4)
           RETURNING id, occurred_at`,
          [staff.id, orgId, action, JSON.stringify({ via: 'whatsapp' })]
        );
        return q.rows[0];
      }

      // Default reply (if nothing matches)
      let reply =
        "Sorry, I didn't understand that. Type *menu* to see what I can do.";

      // === MENU / HELP ===
      if (cmd === 'menu' || cmd === 'help' || cmd === 'hi' || cmd === 'hello') {
        reply = buildMenuText();

      // === CHECKIN ===
      } else if (cmd === 'checkin') {
        const row = await logAttendance('checkin');
        reply = '✅ Checked in at ' + new Date(row.occurred_at).toLocaleString();

      // === CHECKOUT ===
      } else if (cmd === 'checkout') {
        const row = await logAttendance('checkout');
        reply = '✅ Checked out at ' + new Date(row.occurred_at).toLocaleString();

      // === MY SHIFTS (next 7 days) ===
      } else if (cmd === 'my shifts') {
        const now = new Date();
        const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const result = await pool.query(
          `SELECT
             sa.id AS assignment_id,
             s.shift_ref,
             s.ward,
             s.shift_date
           FROM shift_assignments sa
           JOIN shifts s ON sa.shift_id = s.id
           WHERE sa.staff_id = $1
             AND s.shift_date >= $2
             AND s.shift_date <= $3
           ORDER BY s.shift_date ASC
           LIMIT 5`,
          [staff.id, now.toISOString(), to.toISOString()]
        );

        if (!result.rows.length) {
          reply = '📅 You have no upcoming shifts in the next 7 days.';
        } else {
          const lines = result.rows.map((row) => {
            const when = new Date(row.shift_date).toLocaleString();
            const ward = row.ward || 'Ward not set';
            const ref = row.shift_ref || 'No ref';
            return '• ' + when + ' – ' + ward + ' (' + ref + ')';
          });
          reply = '📅 Your next shifts:\n' + lines.join('\n');
        }

      // === MY WEEK / ROTA (summary style) ===
      } else if (cmd === 'my week' || cmd === 'rota') {
        const now = new Date();
        const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const result = await pool.query(
          `SELECT
             s.shift_date,
             s.ward,
             s.shift_ref
           FROM shift_assignments sa
           JOIN shifts s ON sa.shift_id = s.id
           WHERE sa.staff_id = $1
             AND s.shift_date >= $2
             AND s.shift_date <= $3
           ORDER BY s.shift_date ASC`,
          [staff.id, now.toISOString(), to.toISOString()]
        );

        if (!result.rows.length) {
          reply = '📅 No shifts on your rota for the next 7 days.';
        } else {
          const lines = result.rows.map((row) => {
            const d = new Date(row.shift_date);
            const day = d.toLocaleDateString(undefined, {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
            });
            const ward = row.ward || 'Ward';
            const ref = row.shift_ref || '';
            return `• ${day} – ${ward} ${ref ? '(' + ref + ')' : ''}`;
          });
          reply = '📅 Your rota (next 7 days):\n' + lines.join('\n');
        }

      // === INSIGHT TODAY (from analytics_snapshots JSONB) ===
      } else if (cmd === 'insight today') {
        const result = await pool.query(
          `SELECT data, snapshot_date
           FROM analytics_snapshots
           WHERE organisation_id = $1
           ORDER BY snapshot_date DESC, id DESC
           LIMIT 1`,
          [orgId]
        );

        if (!result.rows.length) {
          reply =
            '📊 No analytics insight available yet. Ask your manager to run the AI dashboard.';
        } else {
          const row = result.rows[0];
          const payload = row.data || {};
          const summary =
            payload.summary ||
            payload.overall ||
            'Wellbeing summary not available yet.';
          const dateLabel = row.snapshot_date
            ? new Date(row.snapshot_date).toLocaleDateString()
            : 'unknown date';

          reply = '📊 ' + summary + '\n\n' + '(last updated: ' + dateLabel + ')';
        }

      // === OFFERS: list recent shift offers for this staff ===
      } else if (cmd === 'offers') {
        const result = await pool.query(
          `SELECT so.id, so.status, so.created_at,
                  s.shift_date, s.ward, s.shift_ref
           FROM shift_offers so
           JOIN shifts s ON so.shift_id = s.id
           WHERE so.staff_id = $1
           ORDER BY so.created_at DESC
           LIMIT 5`,
          [staff.id]
        );

        if (!result.rows.length) {
          reply = '📨 You have no recent shift offers.';
        } else {
          const lines = result.rows.map((row) => {
            const when = new Date(row.shift_date).toLocaleString();
            const ward = row.ward || 'Ward';
            const ref = row.shift_ref || '';
            return (
              `• [${row.status}] ` +
              when +
              ' – ' +
              ward +
              (ref ? ' (' + ref + ')' : '') +
              ' — Offer ID: ' +
              row.id
            );
          });
          reply = '📨 Your recent shift offers:\n' + lines.join('\n');
        }

      // === LAST OFFER: show the most recent offer details ===
      } else if (cmd === 'last offer') {
        const result = await pool.query(
          `SELECT so.id, so.status, so.created_at,
                  s.shift_date, s.ward, s.shift_ref
           FROM shift_offers so
           JOIN shifts s ON so.shift_id = s.id
           WHERE so.staff_id = $1
           ORDER BY so.created_at DESC
           LIMIT 1`,
          [staff.id]
        );

        if (!result.rows.length) {
          reply = '📨 You have no shift offers yet.';
        } else {
          const row = result.rows[0];
          const when = new Date(row.shift_date).toLocaleString();
          const ward = row.ward || 'Ward';
          const ref = row.shift_ref || '';
          reply =
            '📨 Your latest offer:\n' +
            `• ${when} – ${ward}` +
            (ref ? ' (' + ref + ')' : '') +
            `\nStatus: ${row.status}\nOffer ID: ${row.id}`;
        }

      // === ACCEPT: accept the most recent offered shift ===
      } else if (
        cmd === 'accept' ||
        cmd === 'accept shift' ||
        cmd === 'accept offer'
      ) {
        const result = await pool.query(
          `SELECT so.id, so.shift_id, so.status,
                  s.shift_date, s.ward, s.shift_ref
           FROM shift_offers so
           JOIN shifts s ON so.shift_id = s.id
           WHERE so.staff_id = $1
             AND so.status = 'offered'
           ORDER BY so.created_at DESC
           LIMIT 1`,
          [staff.id]
        );

        if (!result.rows.length) {
          reply =
            '❌ You have no pending offers to accept. Type *offers* to see your history.';
        } else {
          const offer = result.rows[0];

          // Mark offer as accepted
          await pool.query(
            `UPDATE shift_offers
             SET status = 'accepted',
                 responded_at = NOW()
             WHERE id = $1`,
            [offer.id]
          );

          // Ensure a shift_assignment exists
          const existing = await pool.query(
            `SELECT id FROM shift_assignments
             WHERE staff_id = $1 AND shift_id = $2
             LIMIT 1`,
            [staff.id, offer.shift_id]
          );

          if (!existing.rows.length) {
            await pool.query(
              `INSERT INTO shift_assignments (staff_id, shift_id)
               VALUES ($1,$2)`,
              [staff.id, offer.shift_id]
            );
          }

          const when = new Date(offer.shift_date).toLocaleString();
          const ward = offer.ward || 'Ward';
          const ref = offer.shift_ref || '';
          reply =
            '✅ You have *accepted* this shift:\n' +
            `• ${when} – ${ward}` +
            (ref ? ' (' + ref + ')' : '') +
            '\n\nYour manager has been notified.';
        }

      // === DECLINE: decline the most recent offered shift ===
      } else if (
        cmd === 'decline' ||
        cmd === 'decline shift' ||
        cmd === 'decline offer'
      ) {
        const result = await pool.query(
          `SELECT so.id, so.shift_id, so.status,
                  s.shift_date, s.ward, s.shift_ref
           FROM shift_offers so
           JOIN shifts s ON so.shift_id = s.id
           WHERE so.staff_id = $1
             AND so.status = 'offered'
           ORDER BY so.created_at DESC
           LIMIT 1`,
          [staff.id]
        );

        if (!result.rows.length) {
          reply =
            '❌ You have no pending offers to decline. Type *offers* to see your history.';
        } else {
          const offer = result.rows[0];

          // Mark offer as declined
          await pool.query(
            `UPDATE shift_offers
             SET status = 'declined',
                 responded_at = NOW()
             WHERE id = $1`,
            [offer.id]
          );

          const when = new Date(offer.shift_date).toLocaleString();
          const ward = offer.ward || 'Ward';
          const ref = offer.shift_ref || '';
          reply =
            '❌ You *declined* this shift:\n' +
            `• ${when} – ${ward}` +
            (ref ? ' (' + ref + ')' : '') +
            '\n\nThank you for responding promptly.';
        }

      // === FALLBACK: unrecognised command ===
      } else {
        // keep default reply already set
      }

      // Send WhatsApp reply
      await sendWhatsApp(from, reply);

      // Respond to Twilio
      return res.json({
        status: 'ok',
        to: from,
        message: reply,
        staff_id: staff.id,
      });
    } catch (err) {
      console.error('WhatsApp webhook error:', err);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

module.exports = router;
