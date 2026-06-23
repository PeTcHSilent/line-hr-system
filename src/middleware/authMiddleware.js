const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'hr-system-secret-change-me';

/**
 * Middleware ตรวจ JWT token สำหรับ Admin API
 */
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
}

module.exports = { requireAuth };
