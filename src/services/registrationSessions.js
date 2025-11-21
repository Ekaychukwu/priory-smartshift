// src/services/registrationSessions.js
//
// Simple in-memory store for WhatsApp registration flows.
// Keyed by normalised phone number (e.g. +447979195363).
//
// NOTE: This is fine for dev. In a real production deployment
// you would persist this somewhere (Redis, DB, etc.) so it
// survives restarts.

const sessions = new Map();

/**
 * Start a new registration session for a phone + org.
 * Collects: full_name, role, ward, preferred_shift, contracted_hours_per_week.
 */
function startRegistration(phone, organisationId) {
  const session = {
    phone,
    organisationId,
    step: 1, // 1 = name, 2 = role, 3 = ward, 4 = shift, 5 = hours, 6 = confirm
    data: {
      full_name: null,
      role: null,
      ward: null,
      preferred_shift: null,
      contracted_hours_per_week: null,
    },
  };
  sessions.set(phone, session);
  return session;
}

/**
 * Get the current session for a phone (or null if none).
 */
function getSession(phone) {
  return sessions.get(phone) || null;
}

/**
 * Clear and remove the session for a phone.
 */
function clearSession(phone) {
  sessions.delete(phone);
}

/**
 * Advance the current session with a user's answer.
 *
 * @param {string} phone   - normalised phone number
 * @param {string} message - raw text answer from user
 * @returns {{ done: boolean, session: object|null, error?: string, askAgain?: boolean, restarted?: boolean }}
 */
function advanceSession(phone, message) {
  const session = sessions.get(phone);
  if (!session) {
    return { done: false, session: null, error: 'NO_SESSION' };
  }

  const trimmed = (message || '').trim();

  if (session.step === 1) {
    // Full name
    if (!trimmed) {
      return { done: false, session, askAgain: true };
    }
    session.data.full_name = trimmed;
    session.step = 2;
    return { done: false, session };
  }

  if (session.step === 2) {
    // Role
    if (!trimmed) {
      return { done: false, session, askAgain: true };
    }
    session.data.role = trimmed;
    session.step = 3;
    return { done: false, session };
  }

  if (session.step === 3) {
    // Ward
    if (!trimmed) {
      return { done: false, session, askAgain: true };
    }
    session.data.ward = trimmed;
    session.step = 4;
    return { done: false, session };
  }

  if (session.step === 4) {
    // Preferred shift (1/2/3)
    const choice = trimmed.toLowerCase();
    let value = null;

    if (choice === '1' || choice === 'day' || choice === 'days') {
      value = 'Day';
    } else if (choice === '2' || choice === 'night' || choice === 'nights') {
      value = 'Night';
    } else if (choice === '3' || choice === 'mixed' || choice === 'flexible') {
      value = 'Mixed';
    }

    if (!value) {
      return { done: false, session, askAgain: true };
    }

    session.data.preferred_shift = value;
    session.step = 5;
    return { done: false, session };
  }

  if (session.step === 5) {
    // Contracted hours
    let hours = parseFloat(trimmed.replace(',', '.'));
    if (Number.isNaN(hours) || hours <= 0 || hours > 80) {
      // Default to 37.5 if they send something odd
      hours = 37.5;
    }

    session.data.contracted_hours_per_week = hours;
    session.step = 6;
    return { done: false, session };
  }

  if (session.step === 6) {
    // Confirmation (YES/NO)
    const lower = trimmed.toLowerCase();
    if (lower === 'yes' || lower === 'y') {
      // All done
      return { done: true, session };
    }

    if (lower === 'no' || lower === 'n') {
      // Restart from step 1
      session.step = 1;
      session.data = {
        full_name: null,
        role: null,
        ward: null,
        preferred_shift: null,
        contracted_hours_per_week: null,
      };
      return { done: false, session, restarted: true };
    }

    // Ask again if unrecognised
    return { done: false, session, askAgain: true };
  }

  return { done: false, session, error: 'UNKNOWN_STEP' };
}

module.exports = {
  startRegistration,
  getSession,
  clearSession,
  advanceSession,
};
