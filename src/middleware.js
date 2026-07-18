const { verifyToken } = require('./auth-utils');
const db = require('./db');

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Chưa đăng nhập' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản chưa được duyệt hoặc đã bị khóa' });

  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ dành cho quản trị viên' });
  next();
}

module.exports = { auth, adminOnly };
