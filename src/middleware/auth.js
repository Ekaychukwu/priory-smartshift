const jwt = require('jsonwebtoken');
const { pool } = require('../utils/db_postgres');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

/**
 * Decide which routes are PUBLIC (no JWT needed).
 */
function isPublic(req) {
  const path = req.path || req.url || '';

  // Auth endpoints stay public
  if (path.startsWith('/api/auth')) return true;

  // WhatsApp webhook must stay open for Twilio
  if (path === '/api/whatsapp/webhook' || path.startsWith('/api/whatsapp/webhook')) {
    return true;
  }

  // Health/root & static assets
  if (path === '/' || path.startsWith('/public')) return true;

  return false;
}

/**
 * JWT authentication middleware
 * - Skips public routes
 * - For protected routes, reads Bearer token
 * - Verifies JWT
 * - Loads full user (including role, organisation_id) from Postgres
 * - Attaches req.user
 */
module.exports = async function authMiddleware(req, res, next) {
  try {
    if (isPublic(req)) {
      return next();
    }

    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    }

    const token = authHeader.slice(7); // drop 'Bearer '
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error('JWT verify error:', err.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Load the latest user data (role, organisation_id etc.) from DB
    const { rows } = await pool.query(
      'SELECT id, email, role, organisation_id FROM users WHERE id = $1 LIMIT 1',
      [payload.id]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    req.user = rows[0];
    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Auth middleware failed' });
  }
};
