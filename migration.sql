-- ====================================================================
-- Priory SmartShift: Initial Schema for Multi-Tenant AI Shift System
-- ====================================================================

-- === ORGANISATIONS ===
CREATE TABLE IF NOT EXISTS organisations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  address TEXT,
  contact_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- === ORGANISATION BILLING ===
CREATE TABLE IF NOT EXISTS organisation_billing (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id),
  plan_type TEXT NOT NULL DEFAULT 'basic',
  active_users INTEGER DEFAULT 0,
  monthly_hours_logged INTEGER DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  next_billing_date DATE
);

-- === SHIFTS ===
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  shift_ref TEXT UNIQUE NOT NULL,
  ward TEXT,
  role_required TEXT,
  status TEXT DEFAULT 'Open',
  shift_date TIMESTAMP WITH TIME ZONE,
  number_required INTEGER DEFAULT 1,
  number_filled INTEGER DEFAULT 0,
  organisation_id INTEGER REFERENCES organisations(id)
);

-- === STAFF ===
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT,
  preferred_shift TEXT,
  wellbeing_score NUMERIC DEFAULT 0,
  contracted_hours_per_week NUMERIC DEFAULT 37.5,
  organisation_id INTEGER REFERENCES organisations(id)
);

-- === USERS ===
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT CHECK (role IN ('super_admin','admin','manager','staff')),
  staff_id INTEGER REFERENCES staff(id),
  organisation_id INTEGER REFERENCES organisations(id)
);

-- === SHIFT ASSIGNMENTS ===
CREATE TABLE IF NOT EXISTS shift_assignments (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER REFERENCES shifts(id),
  staff_id INTEGER REFERENCES staff(id),
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- === WELLBEING LOGS ===
CREATE TABLE IF NOT EXISTS wellbeing_logs (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id),
  mood_score INTEGER,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- === WELLBEING SUMMARIES ===
CREATE TABLE IF NOT EXISTS wellbeing_summaries (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id),
  summary TEXT,
  score NUMERIC,
  date DATE DEFAULT CURRENT_DATE
);

-- === PAYROLL RECORDS ===
CREATE TABLE IF NOT EXISTS payroll_records (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id),
  organisation_id INTEGER REFERENCES organisations(id),
  hours_worked NUMERIC,
  pay_rate NUMERIC,
  overtime_hours NUMERIC,
  total_pay NUMERIC,
  pay_period_start DATE,
  pay_period_end DATE
);

-- === PERFORMANCE METRICS ===
CREATE TABLE IF NOT EXISTS performance_metrics (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id),
  organisation_id INTEGER REFERENCES organisations(id),
  metric_date DATE,
  score NUMERIC,
  notes TEXT
);

-- === REPORTS ===
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id),
  type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB
);

-- === ANALYTICS SNAPSHOTS ===
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id),
  snapshot_date DATE DEFAULT CURRENT_DATE,
  data JSONB
);

-- === Seed Base Organisation ===
INSERT INTO organisations (name, subdomain, address, contact_email)
VALUES ('Priory Group', 'priory', '123 Priory Road, London', 'admin@priory.com')
ON CONFLICT DO NOTHING;

-- === Seed Base Users ===
INSERT INTO staff (name, phone_number, preferred_shift, organisation_id)
VALUES
('Alice Example', '+447700900001', 'Day', 1),
('Bob Example', '+447700900002', 'Night', 1)
ON CONFLICT DO NOTHING;

INSERT INTO users (name, email, role, staff_id, organisation_id)
VALUES
('Alice Admin', 'admin@example.com', 'admin', 1, 1),
('Bob Staff', 'staff@example.com', 'staff', 2, 1)
ON CONFLICT DO NOTHING;
