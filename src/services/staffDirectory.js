const { pool } = require('../utils/db_postgres');

function normalizePhone(num) {
  if (!num) return '';
  let n = String(num).trim();
  n = n.replace(/^whatsapp:/i, '');
  n = n.replace(/[^\d+]/g, ''); // keep + and digits only
  return n;
}

async function ensureOrganisation(name) {
  const find = await pool.query('SELECT id FROM organisations WHERE name=$1 LIMIT 1', [name]);
  if (find.rows[0]) return find.rows[0].id;
  const ins = await pool.query('INSERT INTO organisations (name) VALUES ($1) RETURNING id', [name]);
  return ins.rows[0].id;
}

async function getOrCreateStaffByPhone({ phone, organisationName = 'Priory Group' }) {
  const normalized = normalizePhone(phone);
  const existing = await pool.query('SELECT * FROM staff WHERE phone_number=$1 LIMIT 1', [normalized]);
  if (existing.rows[0]) return existing.rows[0];

  const orgId = await ensureOrganisation(organisationName);
  const ins = await pool.query(
    `INSERT INTO staff (name, phone_number, preferred_shift, wellbeing_score, organisation_id)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    ['WhatsApp User', normalized, 'Day', 0, orgId]
  );
  return ins.rows[0];
}

module.exports = { normalizePhone, getOrCreateStaffByPhone };
