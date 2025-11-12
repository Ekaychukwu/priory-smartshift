const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Allow /api/auth/* and /api/whatsapp/webhook without JWT; protect the rest of /api/*
module.exports = function (req, res, next) {
  const open = [/^\/api\/auth\//, /^\/api\/whatsapp\/webhook/];
  if (open.some(rx => rx.test(req.path))) return next();
  if (!req.path.startsWith('/api/')) return next();

  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    next();
  } catch (e) {
    console.error('JWT verification failed:', e.message);
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};
