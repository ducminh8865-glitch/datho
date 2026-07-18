const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth } = require('../middleware');
const { hashPassword, verifyPassword, signToken } = require('../auth-utils');

const router = express.Router();

// Chuẩn hoá số điện thoại: giữ chữ số (và dấu + đầu nếu có)
function normPhone(p) {
  let s = String(p || '').trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('+')) s = '+' + s.slice(1).replace(/\D/g, '');
  else s = s.replace(/\D/g, '');
  return s;
}
function validPhone(p) {
  return /^(0\d{9}|\+?\d{9,12})$/.test(p);
}

function publicUser(u) {
  return { id: u.id, phone: u.phone, name: u.name || u.phone, role: u.role };
}

// --- Đăng ký (xong tự đăng nhập luôn) ---
router.post('/register', async (req, res) => {
  try {
    const phone = normPhone(req.body.phone);
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirmPassword ?? req.body.confirm ?? '');

    if (!validPhone(phone)) return res.status(400).json({ error: 'Số điện thoại không hợp lệ' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    if (password !== confirm) return res.status(400).json({ error: 'Mật khẩu xác nhận không khớp' });

    if (config.registerCode && String(req.body.code || '').trim() !== config.registerCode) {
      return res.status(403).json({ error: 'Mã mời không đúng' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (existing) return res.status(409).json({ error: 'Số điện thoại này đã đăng ký' });

    const password_hash = await hashPassword(password);
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const isAdmin = count === 0 || (config.adminPhone && phone.replace(/\D/g, '') === config.adminPhone);
    const name = String(req.body.name || '').trim() || phone;

    const ins = db.prepare(
      "INSERT INTO users (phone, name, password_hash, status, role) VALUES (?,?,?, 'active', ?)"
    ).run(phone, name, password_hash, isAdmin ? 'admin' : 'collaborator');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ins.lastInsertRowid);
    const token = signToken(user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// --- Đăng nhập ---
router.post('/login', async (req, res) => {
  try {
    const phone = normPhone(req.body.phone);
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Số điện thoại hoặc mật khẩu không đúng' });
    }
    if (user.status === 'blocked') return res.status(403).json({ error: 'Tài khoản đã bị khoá' });

    const token = signToken(user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// --- Thông tin tài khoản đang đăng nhập ---
router.get('/me', auth, (req, res) => {
  res.json(publicUser(req.user));
});

module.exports = router;
