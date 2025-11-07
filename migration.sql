-- Migration script to enable multi‑tenant support for Priory SmartShift.
-- Execute this on your PostgreSQL database before running the server
-- in multi‑tenant mode.  Adjust data types and constraints as needed.

-- Create organisations table
CREATE TABLE IF NOT EXISTS organisations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  address TEXT,
  contact_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create organisation_billing table
CREATE TABLE IF NOT EXISTS organisation_billing (
  organisation_id INTEGER PRIMARY KEY REFERENCES organisations(id),
  plan_type TEXT NOT NULL DEFAULT 'basic',
  active_users INTEGER DEFAULT 0,
  monthly_hours_logged INTEGER DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  next_billing_date DATE
);

-- Add organisation_id column to existing tables.  You may need to
-- define appropriate foreign key constraints if your database
-- enforces referential integrity.  Here we simply add the column
-- without constraints for demonstration.

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS organisation_id INTEGER;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS organisation_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation_id INTEGER;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS organisation_id INTEGER;
ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS organisation_id INTEGER;

-- After running this migration, update existing records to assign a
-- default organisation (e.g. id=1) before enabling multi‑tenant mode.