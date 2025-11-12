// src/routes/authRoutes.js (CommonJS, Postgres, bcryptjs)
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../utils/db_postgres'); // <- IMPORTANT: destructure { pool }

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

console.log('✅ Auth routes loaded from', __filename);

// Simple ping so we can confirm the route is mounted
router.get('/ping', (_req, res) => res.json({ ok: true }));

// POST /api/auth/register
router.post('/register', async (req, res) => {
  console.log('📩 /api/auth/register body:', req.body);
  try {
    const { email, password, organisation } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

// Find or create organisation without relying on a UNIQUE constraint
let orgId;
const orgName = organisation || 'Priory Group';

// Try to find an existing org by name
const existingOrg = await pool.query(
  'SELECT id FROM organisations WHERE name = $1 LIMIT 1',
  [orgName]
);

if (existingOrg.rows[0]) {
  orgId = existingOrg.rows[0].id;
} else {
  const insertedOrg = await pool.query(
    'INSERT INTO organisations (name) VALUES ($1) RETURNING id',
    [orgName]
  );
  orgId = insertedOrg.rows[0].id;
}


    // Create user (name = local part of email)
    const userResult = await pool.query(
      `INSERT INTO users (name, email, password_hash, organisation_id, role)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, role`,
      [email.split('@')[0], email.toLowerCase(), hash, orgId, 'staff']
    );

    const user = userResult.rows[0];
    if (!user) {
      // ON CONFLICT happened (email already exists)
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, organisation_id: orgId },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    res.json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  console.log('📩 /api/auth/login body:', req.body?.email);
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const q = await pool.query(
      'SELECT id, email, role, password_hash, organisation_id FROM users WHERE email=$1 LIMIT 1',
      [email.toLowerCase()]
    );
    const user = q.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, organisation_id: user.organisation_id },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

module.exports = router;
