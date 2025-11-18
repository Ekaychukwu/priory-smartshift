// scripts/runMigrations.js
//
// Simple migration runner for PostgreSQL.
//
// It does TWO things in order:
//
//   1) If there is a root-level "migration.sql" file, it runs that first.
//      This usually contains the BASE schema (tables like staff, shifts, users, etc).
//
//   2) Then it runs EVERY .sql file in the "migrations" folder in alphabetical order.
//      These are your later phases: phase6, phase7, shift offers, etc.
//
// This script uses the existing PostgreSQL pool from src/utils/db_postgres.js
// and the DATABASE_URL from your .env file.

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { pool } = require('../src/utils/db_postgres');

async function runMigrations() {
  try {
    // 1) Run root-level migration.sql FIRST (if it exists)
    const rootMigrationPath = path.join(__dirname, '..', 'migration.sql');

    if (fs.existsSync(rootMigrationPath)) {
      console.log('>>> Running base migration: migration.sql');
      const baseSql = fs.readFileSync(rootMigrationPath, 'utf8');
      await pool.query(baseSql);
      console.log('<<< Completed base migration: migration.sql\n');
    } else {
      console.log('No root migration.sql found, skipping base schema step.\n');
    }

    // 2) Now run all .sql files in /migrations in alphabetical order
    const migrationsDir = path.join(__dirname, '..', 'migrations');

    let files = [];
    try {
      files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort(); // alphabetical order
    } catch (err) {
      console.log('No /migrations directory found or unable to read it.');
      files = [];
    }

    if (files.length === 0) {
      console.log('No .sql migration files found in /migrations');
      console.log('All migrations completed (only base migration, if any, was run).');
      process.exit(0);
    }

    console.log('Running migrations in order:');
    for (const file of files) {
      console.log(`- ${file}`);
    }

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      console.log(`\n>>> Running migration: ${file}`);
      await pool.query(sql);
      console.log(`<<< Completed migration: ${file}`);
    }

    console.log('\nAll migrations completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('\nMigration failed:', err);
    process.exit(1);
  }
}

runMigrations();