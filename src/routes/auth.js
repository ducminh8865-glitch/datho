const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth } = require('../middleware');
const { hashPassword, verifyPassword, signToken } = require('../auth-utils');
const saycar = require('../saycar/client');
const driverSync = require('../driver-sync');

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

    // Cổng mã mời: mở khi có mã hệ thống (.env) HOẶC có mã do admin tạo còn hoạt động
    const code = String(req.body.code || '').trim();
    const activeCodes = db.prepare("SELECT COUNT(*) AS c FROM invite_codes WHERE status = 'active'").get().c;
    let invite = null;
    let driverExempt = false;
    if (config.registerCode || activeCodes > 0) {
      const okEnv = config.registerCode && code === config.registerCode;
      if (!okEnv) {
        invite = code
          ? db.prepare("SELECT * FROM invite_codes WHERE code = ? AND status = 'active'").get(code.toUpperCase())
          : null;
        const hasLeft = invite && (invite.max_uses == null || invite.used_count < invite.max_uses);
        if (!hasLeft) {
          invite = null;
          // Không có mã hợp lệ -> nếu SĐT trùng TÀI XẾ ĐÃ XÁC THỰC trên saycar thì miễn mã.
          // Check bảng đồng bộ local trước (nhanh); không thấy mới tra sống trên saycar.
          const local = driverSync.findLocal(phone);
          if (local && local.verified) {
            driverExempt = true;
          } else if (!local) {
            let driver = null;
            try { driver = await saycar.findDriver(phone); }
            catch (e) { console.error('findDriver lỗi (bỏ qua, vẫn yêu cầu mã):', e.message || e); }
            if (driver && driver.verified) {
              driverExempt = true;
              driverSync.rememberVerified(phone, driver.name); // ghi vào bảng local luôn
            }
          }
          if (!driverExempt) {
            return res.status(403).json({ error: 'Mã mời không đúng hoặc đã hết lượt' });
          }
        }
      }
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

    // Trừ lượt mã mời + ghi lại ai dùng mã nào / ai vào bằng SĐT tài xế
    if (invite) {
      db.prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?').run(invite.id);
      db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(invite.code, ins.lastInsertRowid);
    } else if (driverExempt) {
      db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run('TÀI XẾ SAYCAR', ins.lastInsertRowid);
    }

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
