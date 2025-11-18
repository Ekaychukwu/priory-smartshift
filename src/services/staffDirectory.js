'use strict';

const pool = require('../db');

/**
 * Get or create a staff record for a given phone + organisation.
 * 
 * @param {string} phoneNumber - Normalised phone number, e.g. "+447979195363"
 * @param {number} organisationId - Organisation ID (for now we use 1 in dev)
 * @returns {Promise<object>} staff row
 */
async function getOrCreateStaffByPhone(phoneNumber, organisationId) {
  const normalised = String(phoneNumber).trim();

  console.log('[staffDirectory] Looking up staff by phone:', {
    normalised,
    organisationId,
  });

  const selectSql = `
    SELECT id,
           name,
           phone_number,
           preferred_shift,
           wellbeing_score,
           contracted_hours_per_week,
           organisation_id
    FROM staff
    WHERE phone_number = $1
      AND organisation_id = $2
    LIMIT 1
  `;

  const { rows } = await pool.query(selectSql, [normalised, organisationId]);
  if (rows.length > 0) {
    console.log('[staffDirectory] Found existing staff for phone:', {
      staff_id: rows[0].id,
      name: rows[0].name,
      phone_number: rows[0].phone_number,
    });
    return rows[0];
  }

  console.log('[staffDirectory] No staff found, creating WhatsApp staff record');

  const insertSql = `
    INSERT INTO staff (
      name,
      phone_number,
      preferred_shift,
      wellbeing_score,
      contracted_hours_per_week,
      organisation_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id,
              name,
              phone_number,
              preferred_shift,
              wellbeing_score,
              contracted_hours_per_week,
              organisation_id
  `;

  const { rows: inserted } = await pool.query(insertSql, [
    'WhatsApp User',
    normalised,
    'Day',
    0,
    37.5,
    organisationId,
  ]);

  console.log('[staffDirectory] Created staff:', {
    id: inserted[0].id,
    name: inserted[0].name,
    phone_number: inserted[0].phone_number,
  });

  return inserted[0];
}

module.exports = {
  getOrCreateStaffByPhone,
};
