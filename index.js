// index.js — Express-based server for Priory SmartShift

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Core middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets (login, dashboard, etc.)
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- Routes ---

// 1) Auth routes (register + login) — public
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/auth', authRoutes);

// 2) JWT middleware — protects /api/* except auth + whatsapp webhook (handled inside middleware)
const authMiddleware = require('./src/middleware/auth');
app.use(authMiddleware);

// 3) WhatsApp routes (bot + webhook)
const whatsappRoutes = require('./src/routes/whatsappRoutes');
app.use('/api/whatsapp', whatsappRoutes);

// 4) Manager routes (AI shift automation, ranking, broadcasting)
const managerRoutes = require('./src/routes/managerRoutes');
app.use('/api/manager', managerRoutes);

// --- Example protected route to confirm JWT works ---
app.get('/api/ai/insight', (req, res) => {
  res.json({
    message: 'JWT-protected insight route working ✅',
    user: req.user || null,
  });
});

// --- Root health-check route ---
app.get('/', (_req, res) => {
  res.json({ message: 'Priory SmartShift Express API running ✅' });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
