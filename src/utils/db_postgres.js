// src/utils/db_postgres.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function testConnection() {
  const client = await pool.connect();
  const result = await client.query('SELECT NOW()');
  console.log('✅ Database connected at:', result.rows[0].now);
  client.release();
}

module.exports = { pool, testConnection };
