// src/middleware/auth.js
//
// Global JWT authentication middleware.
// This protects all /api/* routes EXCEPT:
//   - /api/auth/*              (public: login/register)
//   - /api/whatsapp/webhook    (Twilio webhook)
//   - /api/debug/*             (DEV-ONLY helper routes)
//
// It expects a header:
//   Authorization: Bearer <token>
//
// On success it sets req.user = { id, email, role, organisation_id }.

const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  const url = req.originalUrl || req.url || '';
  const method = req.method;

  // 1) Allow all non-API routes through (e.g. /, /public/*)
  if (!url.startsWith('/api/')) {
    return next();
  }

  // 2) Allow auth routes (register/login) without a token
  if (url.startsWith('/api/auth')) {
    return next();
  }

  // 3) Allow Twilio webhook without a token
  if (url === '/api/whatsapp/webhook' && method === 'POST') {
    return next();
  }

  // 4) Allow debug helper routes without a token (dev only)
  if (url.startsWith('/api/debug/')) {
    return next();
  }

  // 5) Everything else under /api/* requires a JWT
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const secret = process.env.JWT_SECRET || 'dev-secret';

  try {
    const decoded = jwt.verify(token, secret);

    // Normalise the user object we put on the request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      organisation_id: decoded.organisation_id,
    };

    return next();
  } catch (err) {
    console.error('JWT verify error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
