// src/utils/db_postgres.js
const { Pool } = require('pg');
require('dotenv').config();

const isLocal = process.env.NODE_ENV !== 'production';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/priory',
  ssl: isLocal
    ? false
    : {
        rejectUnauthorized: false, // allows SSL in production
      },
});

async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected:', res.rows[0].now);
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
  }
}

module.exports = { pool, testConnection };
