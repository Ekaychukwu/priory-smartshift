const http = require('http');
const { parse } = require('querystring');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// --- Load .env ---
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

// --- Controllers ---
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
const insightController = require('./src/controllers/insightController');
const { verifyJwt } = require('./src/utils/auth');
const { db } = require('./src/utils/db');

const PORT = process.env.PORT || 3000;

// --- Helper: Collect body data ---
function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', err => reject(err));
  });
}

// --- Server ---
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Split path into segments
    const segments = pathname.split('/').filter(Boolean);
    let orgIdParam = null;
    if (segments.length >= 2 && segments[0] === 'api') {
      const candidate = segments[1];
      if (!['auth', 'whatsapp', 'billing', 'admin'].includes(candidate)) {
        orgIdParam = candidate;
      }
    }

    // --- Auth Helper Functions ---
    async function authenticate() {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
      if (!token) return null;
      const payload = verifyJwt(token, process.env.JWT_SECRET || 'secret');
      if (!payload) return null;
      const user = db.users.find(u => u.id === payload.id);
      return user || null;
    }

    async function enforceOrgScope() {
      if (!orgIdParam) return { user: null };
      const user = await authenticate();
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorised' }));
        return null;
      }
      if (user.role !== 'super_admin' && String(user.organisation_id) !== String(orgIdParam)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return null;
      }
      req.user = user;
      req.orgId = orgIdParam;
      return { user };
    }

    // --- ROUTES ---

    // Basic test
    if (pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Priory SmartShift API running ✅' }));
      return;
    }

    // WhatsApp webhook
    if (pathname === '/api/whatsapp/webhook' && method === 'POST') {
      const bodyData = await collectRequestBody(req);
      const contentType = req.headers['content-type'] || '';
      let body = {};
      if (contentType.includes('application/json')) {
        try { body = JSON.parse(bodyData); } catch {}
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        body = parse(bodyData);
      } else if (contentType.includes('text/plain')) {
        body = { Body: bodyData };
      }
      const result = await whatsappController.handleIncomingMessage(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Staff dashboard
    if (pathname.startsWith('/api/staff/') && method === 'GET') {
      const staffId = pathname.split('/')[3];
      const data = staffController.getStaffDashboard(req, staffId);
      res.writeHead(data.error ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // AI wellbeing summaries
    if (pathname === '/api/ai/generate-summaries' && method === 'POST') {
      const result = await aiController.generateSummaries();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/ai/wellbeing/today' && method === 'GET') {
      const result = aiController.getTodaySummaries();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    // --- Temporary AI Test Routes (for MVP validation only) ---
    if (pathname === '/api/test/ai/predict' && method === 'GET') {
      const result = analyticsController.predict(1, 7);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/test/ai/insight' && method === 'GET') {
      const result = await analyticsController.insight(1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
// --- AI Wellbeing Insight (OpenAI) ---
if (pathname === '/api/ai/insight' && method === 'GET') {
  const result = await insightController.generateInsight(req, res);
  return; // response is handled inside controller
}
// === AI Analytics Dashboard ===
const analyticsDashboardController = require("./src/controllers/analyticsDashboardController");

// Serve dashboard JSON summary
if (pathname === "/api/ai/logs/summary" && method === "GET") {
  const result = await analyticsDashboardController.getSummary();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return;
}

// Serve dashboard HTML page
if (pathname === "/dashboard/ai" && method === "GET") {
  const html = analyticsDashboardController.getHTML();
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
  return;
}

    // Fallback for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`✅ Priory SmartShift server listening on port ${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    if (PORT === 3000) {
      console.warn("⚠️ Port 3000 is busy — switching once to 3001...");
      server.listen(3001, () => {
        console.log("✅ Priory SmartShift now running on port 3001");
      });
    } else {
      console.error("❌ Both 3000 and 3001 are busy. Please free the ports and restart.");
      process.exit(1);
    }
  } else {
    throw err;
  }
});
