// index.js — Express-based server for Priory SmartShift
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Auth routes (register/login)
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/auth', authRoutes);

// JWT middleware (protects /api/* except auth + whatsapp)
const authMiddleware = require('./src/middleware/auth');
app.use(authMiddleware);

// Example protected route
app.get('/api/ai/insight', (req, res) => {
  res.json({ message: 'JWT-protected insight route working ✅', user: req.user });
});

// WhatsApp webhook (left open)
app.post('/api/whatsapp/webhook', (req, res) => {
  res.json({ status: 'Webhook received ✅' });
});

app.get('/', (_req, res) => res.json({ message: 'Priory SmartShift Express API running ✅' }));

app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));
