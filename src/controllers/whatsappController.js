const { findRecord, insertRecord, updateRecord, db } = require('../utils/db');
const { sendWhatsAppMessage } = require('../services/twilioService');
const { analyzeTone } = require('../services/openaiService');

/**
 * Handle an incoming WhatsApp message from Twilio.  The payload
 * is expected to contain at least a `Body` field with the text of
 * the message and a `From` field with the sender's phone number.
 *
 * The function parses messages of the form:
 *   ACCEPT SH001
 *   DECLINE SH001
 *
 * If the message contains neither keyword the caller is informed
 * accordingly.  All messages are logged to the wellbeing_logs table
 * along with a simple tone analysis.
 *
 * @param {Object} body - Parsed request body from Twilio
 * @returns {Promise<Object>} - A result object containing a status message
 */
async function handleIncomingMessage(body) {
  const incomingMessage = (body.Body || '').trim();
  // Twilio prefixes WhatsApp numbers with 'whatsapp:'.  Remove it.
  let fromNumber = (body.From || '').toString();
  if (fromNumber.startsWith('whatsapp:')) {
    fromNumber = fromNumber.replace('whatsapp:', '');
  }
  // Trim whitespace that may have been introduced if the '+' sign in the
  // phone number was interpreted as a space in form‑encoded payloads.
  fromNumber = fromNumber.trim();

  // Find or create the staff member by phone number.
  let staff = db.staff.find(s => s.phone_number === fromNumber);
  if (!staff) {
    // If the staff member is not found, we need to associate them with an
    // organisation.  We attempt to infer the organisation from the shift
    // reference provided later.  For now we create a placeholder staff
    // record without an organisation_id.  Once we find the shift we will
    // update this record with the correct organisation_id.
    staff = insertRecord('staff', {
      name: 'Unknown',
      phone_number: fromNumber,
      preferred_shift: 'Unknown',
      wellbeing_score: 0
      // organisation_id will be set once we know the shift context
    });
  }

  // Perform tone analysis on the message and store in wellbeing_logs
  const toneResult = await analyzeTone(incomingMessage);
  insertRecord('wellbeing_logs', {
    staff_id: staff.id,
    message: incomingMessage,
    tone_summary: toneResult.tone_summary,
    score: toneResult.score,
    timestamp: new Date().toISOString()
  });

  // Parse commands (ACCEPT or DECLINE)
  const match = incomingMessage.match(/^(ACCEPT|DECLINE)\s+(\S+)/i);
  if (!match) {
    const reply =
      "Sorry, we couldn't understand your request. Please send 'ACCEPT SH001' or 'DECLINE SH001'.";
    await sendWhatsAppMessage(fromNumber, reply);
    return { message: 'Unrecognised command' };
  }
  const action = match[1].toUpperCase();
  const shiftRef = match[2].toUpperCase();

  // Look up the shift by shift_ref
  const shift = db.shifts.find(sh => sh.shift_ref.toUpperCase() === shiftRef);
  if (!shift) {
    const reply = `Shift ${shiftRef} was not found. Please check the reference and try again.`;
    await sendWhatsAppMessage(fromNumber, reply);
    return { message: 'Shift not found' };
  }

  // Ensure the staff record has the same organisation_id as the shift.  If
  // the staff's organisation_id is undefined (e.g. newly created), set it
  // now to the organisation of the shift.  If it exists and differs
  // from the shift's organisation_id, reject the request as it would
  // cross tenant boundaries.
  if (typeof staff.organisation_id === 'undefined') {
    updateRecord('staff', staff.id, { organisation_id: shift.organisation_id });
    staff.organisation_id = shift.organisation_id;
  } else if (String(staff.organisation_id) !== String(shift.organisation_id)) {
    const reply = `You do not belong to the organisation for shift ${shiftRef}.`;
    await sendWhatsAppMessage(fromNumber, reply);
    return { message: 'Organisation mismatch' };
  }

  if (action === 'ACCEPT') {
    // Ensure shift is not already filled
    if (shift.status === 'Filled') {
      const reply = `Sorry, shift ${shiftRef} has already been filled.`;
      await sendWhatsAppMessage(fromNumber, reply);
      return { message: 'Shift already filled' };
    }
    // Ensure there are still spots available
    if (shift.number_filled >= shift.number_required) {
      const reply = `Shift ${shiftRef} currently has no remaining spots.`;
      await sendWhatsAppMessage(fromNumber, reply);
      return { message: 'Shift full' };
    }
    // Check consecutive shift rule: cannot accept more than 6 consecutive shifts
    const staffAssignments = db.shift_assignments
      .filter(sa => sa.staff_id === staff.id)
      .sort((a, b) => new Date(a.accepted_at) - new Date(b.accepted_at));
    if (staffAssignments.length >= 6) {
      const reply = `You have already accepted 6 recent shifts. Please take a break before accepting another.`;
      await sendWhatsAppMessage(fromNumber, reply);
      return { message: 'Too many consecutive shifts' };
    }
    // Check day/night rule: cannot work day and night consecutively within 12 hours
    if (staffAssignments.length > 0) {
      const lastAssignment = staffAssignments[staffAssignments.length - 1];
      const lastShift = db.shifts.find(sh => sh.id === lastAssignment.shift_id);
      if (lastShift) {
        const lastDate = new Date(lastShift.shift_date);
        const newDate = new Date(shift.shift_date);
        const hoursDifference = Math.abs(newDate - lastDate) / 36e5;
        // Determine if last and current shifts are on opposite halves of the day
        const lastIsDay = lastDate.getUTCHours() < 12;
        const currentIsDay = newDate.getUTCHours() < 12;
        if (hoursDifference < 12 && lastIsDay !== currentIsDay) {
          const reply = `You cannot work both day and night shifts consecutively. Please allow at least 12 hours between shifts.`;
          await sendWhatsAppMessage(fromNumber, reply);
          return { message: 'Day/night conflict' };
        }
      }
    }
    // Record the acceptance in shift_assignments
    insertRecord('shift_assignments', {
      staff_id: staff.id,
      shift_id: shift.id,
      accepted_at: new Date().toISOString(),
      organisation_id: shift.organisation_id
    });
    // Update the shift's filled count and status
    const updatedCount = shift.number_filled + 1;
    updateRecord('shifts', shift.id, {
      number_filled: updatedCount,
      status: updatedCount >= shift.number_required ? 'Filled' : shift.status
    });
    const reply = `Thank you, ${staff.name}. You have been assigned to shift ${shiftRef} on ${shift.shift_date}.`;
    await sendWhatsAppMessage(fromNumber, reply);
    return { message: 'Shift accepted' };
  }
  if (action === 'DECLINE') {
    const reply = `You have declined shift ${shiftRef}. Thank you for letting us know.`;
    await sendWhatsAppMessage(fromNumber, reply);
    return { message: 'Shift declined' };
  }
  // Fallback: should not reach here due to regex
  await sendWhatsAppMessage(fromNumber, 'Unhandled command.');
  return { message: 'Unhandled command' };
}

module.exports = {
  handleIncomingMessage
};