const http = require('http');
const url = require('url');
const { parse } = require('querystring');
const fs = require('fs');
const path = require('path');

// Lightweight .env loader.  Parses key=value pairs from a `.env` file in
// the project root and assigns them to `process.env` if not already set.
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error('Error loading .env file', err);
  }
})();

const whatsappController = require('./src/controllers/whatsappController');
const shiftController = require('./src/controllers/shiftController');
const wellbeingController = require('./src/controllers/wellbeingController');
const authController = require('./src/controllers/authController');
const staffController = require('./src/controllers/staffController');
const aiController = require('./src/controllers/aiController');
const payrollController = require('./src/controllers/payrollController');
const performanceController = require('./src/controllers/performanceController');
const reportController = require('./src/controllers/reportController');
const analyticsController = require('./src/controllers/analyticsController');
const { verifyJwt } = require('./src/utils/auth');
const { db } = require('./src/utils/db');

const PORT = process.env.PORT || 3000;

// Utility to collect the body of a request.  Returns a promise that resolves
// with the raw body string.  Supports text/plain, application/json and
// application/x-www-form-urlencoded payloads.
function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      // Reject requests that are too large to prevent DoS attacks.  The limit
      // here is arbitrary; adjust as needed for your expected payload sizes.
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', err => reject(err));
  });
}

// Main HTTP server.  Routes requests based on pathname and HTTP method.
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  // Add CORS headers to allow the frontend to call the API from a different
  // origin during development.  In production you may want to restrict
  // Access-Control-Allow-Origin to your deployed frontend domain.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const pathname = parsedUrl.pathname;
  const method = req.method;
  // Split path into segments (excluding empty strings)
  const segments = pathname.split('/').filter(Boolean);
  // Determine if this is an organisation‑scoped route.  If the second
  // segment exists and is not one of the unscoped prefixes (auth,
  // whatsapp, billing, admin), we treat it as the organisation id.
  let orgIdParam = null;
  if (segments.length >= 2 && segments[0] === 'api') {
    const candidate = segments[1];
    if (!['auth','whatsapp','billing','admin'].includes(candidate)) {
      orgIdParam = candidate;
    }
  }

  try {
    // Handle webhook from Twilio for WhatsApp messages.  Twilio will send
    // application/x-www-form-urlencoded by default.
    if (pathname === '/api/whatsapp/webhook' && method === 'POST') {
      const bodyData = await collectRequestBody(req);
      const contentType = req.headers['content-type'] || '';
      let body = {};
      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(bodyData);
        } catch (e) {
          console.error('Invalid JSON payload', e);
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        body = parse(bodyData);
      } else if (contentType.includes('text/plain')) {
        body = { Body: bodyData };
      }
      const result = await whatsappController.handleIncomingMessage(body);
      // Twilio expects a 200 OK even if we are not sending a TwiML response.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Helper to enforce organisation scope on a request.  If orgIdParam is
    // present, authenticate the user and ensure their organisation matches.
    async function enforceOrgScope() {
      if (!orgIdParam) return { user: null };
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return null;
      }
      // Allow super_admin to access any org
      if (user.role !== 'super_admin' && String(user.organisation_id) !== String(orgIdParam)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return null;
      }
      req.user = user;
      req.orgId = orgIdParam;
      return { user };
    }

    // Authentication helper: decode JWT and attach user to request
    async function authenticate() {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
      if (!token) return null;
      const payload = verifyJwt(token, process.env.JWT_SECRET || 'secret');
      if (!payload) return null;
      const user = db.users.find(u => u.id === payload.id);
      return user || null;
    }

    // Public authentication endpoints
    if (pathname === '/api/auth/register' && method === 'POST') {
      const bodyData = await collectRequestBody(req);
      let body;
      try { body = JSON.parse(bodyData || '{}'); } catch (e) { body = {}; }
      const result = await authController.register(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const bodyData = await collectRequestBody(req);
      let body;
      try { body = JSON.parse(bodyData || '{}'); } catch (e) { body = {}; }
      const result = await authController.login(body);
      res.writeHead(result.error ? 401 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    if (pathname === '/api/auth/profile' && method === 'GET') {
      const user = await authenticate();
      req.user = user;
      const result = authController.profile(req);
      res.writeHead(result.error ? 401 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    if (pathname === '/api/auth/password-reset' && method === 'POST') {
      const bodyData = await collectRequestBody(req);
      let body;
      try { body = JSON.parse(bodyData || '{}'); } catch (e) { body = {}; }
      const result = await authController.resetPassword(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // ---- Super Admin and Billing (global or semi‑global) ----
    // Billing summary: /api/billing/summary/:orgId
    if (segments[0] === 'api' && segments[1] === 'billing' && segments[2] === 'summary' && method === 'GET') {
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return;
      }
      // Only super_admin or matching organisation admin can view billing
      const targetOrgId = segments[3];
      if (!targetOrgId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Organisation required' }));
        return;
      }
      if (user.role !== 'super_admin' && String(user.organisation_id) !== String(targetOrgId)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      // Find billing record
      const rec = db.organisation_billing.find(b => String(b.organisation_id) === String(targetOrgId));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rec || {}));
      return;
    }
    // Billing plan update (placeholder)
    if (segments[0] === 'api' && segments[1] === 'billing' && segments[2] === 'update-plan' && method === 'POST') {
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return;
      }
      // Only super_admin may change plan (for now)
      if (user.role !== 'super_admin') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const bodyData = await collectRequestBody(req);
      let body;
      try { body = JSON.parse(bodyData || '{}'); } catch (e) { body = {}; }
      const { organisation_id, plan_type } = body;
      const rec = db.organisation_billing.find(b => String(b.organisation_id) === String(organisation_id));
      if (rec) {
        rec.plan_type = plan_type || rec.plan_type;
        save();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Plan updated' }));
      return;
    }

    // Protected: Shifts list and accept require authentication
    if (orgIdParam && segments[2] === 'shifts' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const filters = parsedUrl.query;
      const shifts = shiftController.listShifts(filters, orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(shifts));
      return;
    }

    if (orgIdParam && segments[2] === 'shifts' && segments[4] === 'accept' && method === 'POST') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const shiftId = segments[3];
      const result = shiftController.acceptShiftById(shiftId, req.user, orgIdParam);
      const status = result.error ? 400 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Protected: Wellbeing analysis endpoint (requires login)
    if (orgIdParam && segments[2] === 'wellbeing' && segments[3] === 'analyze' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const text = parsedUrl.query.text || '';
      const analysis = await wellbeingController.analyzeText(text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(analysis));
      return;
    }

    // Protected: Staff dashboard
    if (orgIdParam && segments[2] === 'staff' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const staffId = segments[3];
      const result = staffController.getStaffDashboard(req, staffId, orgIdParam);
      const status = result.error ? (result.error === 'Forbidden' ? 403 : 400) : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Protected: AI wellbeing summary generator (admin or manager only)
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'generate-summaries' && method === 'POST') {
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return;
      }
      if (user.role !== 'admin' && user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const result = await aiController.generateSummaries();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Protected: Get today's wellbeing summaries
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'wellbeing' && segments[4] === 'today' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const data = aiController.getTodaySummaries(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // -------- Payroll routes --------
    // List payroll records
    if (orgIdParam && segments[2] === 'payroll' && method === 'GET' && segments.length === 3) {
      const scope = await enforceOrgScope();
      if (!scope) return;
      // Only admin or manager can view payroll for their org
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const filters = parsedUrl.query;
      const records = payrollController.listPayroll(filters, orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(records));
      return;
    }
    // Get single payroll record
    if (orgIdParam && segments[2] === 'payroll' && segments.length === 4 && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const id = segments[3];
      const record = payrollController.getPayroll(id, orgIdParam);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      // Only admin or manager can view others' payroll; staff can view own
      if (req.user.role === 'staff' && String(record.staff_id) !== String(req.user.staff_id)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(record));
      return;
    }
    // Manual generate payroll
    if (orgIdParam && segments[2] === 'payroll' && segments[3] === 'generate' && method === 'POST') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const newRecords = payrollController.generatePayroll(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ created: newRecords.length, records: newRecords }));
      return;
    }
    // Payroll summary
    if (orgIdParam && segments[2] === 'payroll' && segments[3] === 'summary' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const summary = payrollController.summaryPayroll(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary));
      return;
    }

    // -------- Performance routes --------
    // Daily performance averages by ward
    if (orgIdParam && segments[2] === 'performance' && segments[3] === 'daily' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const data = performanceController.getDailyPerformance(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }
    // Staff performance trend
    if (orgIdParam && segments[2] === 'performance' && segments[3] === 'staff' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      const staffId = segments[4];
      // Staff can only view their own metrics
      if (req.user.role === 'staff' && String(req.user.staff_id) !== String(staffId)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const perf = performanceController.getStaffPerformance(staffId, orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(perf));
      return;
    }
    // Performance leaderboard
    if (orgIdParam && segments[2] === 'performance' && segments[3] === 'leaderboard' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const leaderboard = performanceController.getLeaderboard(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(leaderboard));
      return;
    }

    // -------- AI payroll routes --------
    // Auto-close payroll (cron)
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'payroll' && segments[4] === 'auto-close' && method === 'POST') {
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return;
      }
      if (user.role !== 'admin' && user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const result = aiController.autoClosePayroll(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    // AI payroll summary
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'payroll' && segments[4] === 'summary' && method === 'GET') {
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return;
      }
      if (user.role !== 'admin' && user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const summary = await aiController.payrollSummary(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary));
      return;
    }

    // Predictive analytics: forecast staffing and cost
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'predict' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      // Only admin or manager can view predictions
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const windowDays = parseInt(parsedUrl.query.window || process.env.PREDICTION_WINDOW_DAYS || '7', 10);
      const result = analyticsController.predict(orgIdParam, windowDays);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    // Digital twin simulation
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'simulate' && method === 'POST') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      let body = {};
      const bodyData = await collectRequestBody(req);
      try { body = JSON.parse(bodyData || '{}'); } catch (e) { body = {}; }
      const sim = analyticsController.simulate(orgIdParam, body || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sim));
      return;
    }
    // AI insights narrative
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'insight' && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const result = await analyticsController.insight(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Refresh analytics snapshot on demand
    if (orgIdParam && segments[2] === 'ai' && segments[3] === 'refresh-snapshots' && method === 'POST') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      try {
        analyticsController.generateSnapshot(orgIdParam);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Snapshot generated' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to generate snapshot' }));
      }
      return;
    }

    // -------- Reports routes --------
    // List reports for an organisation
    if (orgIdParam && segments[2] === 'reports' && segments.length === 3 && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      // Only admin or manager can view reports
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const list = reportController.listReports(orgIdParam);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    // Get a single report
    if (orgIdParam && segments[2] === 'reports' && segments.length === 4 && method === 'GET') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const reportId = segments[3];
      const rep = reportController.getReport(orgIdParam, reportId);
      if (!rep) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rep));
      return;
    }
    // Generate a new report
    if (orgIdParam && segments[2] === 'reports' && segments[3] === 'generate' && method === 'POST') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const type = parsedUrl.query.type || 'weekly';
      const rep = await reportController.generateReport(orgIdParam, type);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rep));
      return;
    }
    // Send a report via email
    if (orgIdParam && segments[2] === 'reports' && segments[3] === 'send' && method === 'POST') {
      const scope = await enforceOrgScope();
      if (!scope) return;
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      let body = {};
      const bodyData = await collectRequestBody(req);
      try { body = JSON.parse(bodyData || '{}'); } catch (e) { body = {}; }
      const reportId = body.report_id || parsedUrl.query.report_id;
      if (!reportId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'report_id is required' }));
        return;
      }
      const result = await reportController.sendReport(orgIdParam, reportId);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // (The legacy /api/shifts, /api/shifts/:id/accept and /api/wellbeing/analyze
    // routes are now protected and handled above.  These conditions are
    // intentionally left blank to avoid accidentally exposing them without
    // authentication.)

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('Error handling request', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`Priory SmartShift server listening on port ${PORT}`);
  // Schedule daily generation of analytics snapshots.  When
  // ANALYTICS_REFRESH_CRON is defined in the environment, the server
  // runs a simple timer that creates a snapshot for each organisation
  // once per day.  This lightweight implementation does not parse
  // cron expressions; instead it triggers at startup and then every
  // 24 hours.  In production you should use a proper scheduler.
  function scheduleAnalyticsSnapshots() {
    // Generate snapshot for all organisations
    const refresh = () => {
      if (!db.organisations) return;
      db.organisations.forEach(org => {
        try {
          analyticsController.generateSnapshot(org.id);
        } catch (err) {
          console.error('Snapshot generation failed for org', org.id, err);
        }
      });
    };
    // Run immediately on startup
    refresh();
    // Run every 24 hours
    const intervalMs = 24 * 60 * 60 * 1000;
    setInterval(refresh, intervalMs);
  }
  if (process.env.ANALYTICS_REFRESH_CRON) {
    scheduleAnalyticsSnapshots();
  }
});