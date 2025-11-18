// src/utils/db_postgres.js
//
// Central place to configure the PostgreSQL connection for Priory SmartShift.
//
// This version is VERY simple and always uses the DATABASE_URL from .env.
// It does NOT hard-code any username like "smartshift".
// It also loads .env itself, so it works no matter when it is imported.

require('dotenv').config();
const { Pool } = require('pg');

// Read the connection string from the environment.
// Example (in .env):
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/priory_smartshift
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL is not set in .env');
  throw new Error('DATABASE_URL is required for PostgreSQL connection');
}

// Optional SSL support (useful if you later deploy to a cloud DB that needs SSL).
// For local Docker Postgres, DB_SSL should be unset or "false".
const useSsl = process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString,
  ssl: useSsl
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = {
  pool,
};