const fs = require('fs');
const path = require('path');

// Path where data will be stored
const dbPath = path.join(__dirname, '../../database.json');

// Default empty data structure
const defaultData = {
  shifts: [],
  staff: [],
  users: [],
  organisation_billing: [],
  organisations: [],
  wellbeing_logs: [],
  wellbeing_summaries: [],
  shift_assignments: [],
  payroll_records: [],
  performance_metrics: [],
  reports: [],
  analytics_snapshots: []
};

let db = {};

// Load database from disk or create a new one
function load() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2));
    db = { ...defaultData };
  } else {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
}

// Save any updates back to disk
function save() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// Initialize on startup
load();

// Export for use in other files
module.exports = { db, save };
