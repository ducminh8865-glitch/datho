const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth } = require('../middleware');
const { hashPassword, verifyPassword, signToken } = require('../auth-utils');
const saycar = require('../saycar/client');
const driverSync = require('../driver-sync');
const { loginLockLeftSec, recordLoginFail, resetLogin } = require('../rate-limit');

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

    // Ô "Mã mời" nhận: mã hệ thống (.env) / mã do admin tạo / SĐT tài xế saycar giới thiệu.
    const code = String(req.body.code || '').trim();
    const activeCodes = db.prepare("SELECT COUNT(*) AS c FROM invite_codes WHERE status = 'active'").get().c;
    const gated = !!config.registerCode || activeCodes > 0;

    let usedEnvCode = false;   // dùng mã mời hệ thống trong .env
    let invite = null;         // mã mời do admin tạo
    let refDriverPhone = null; // SĐT tài xế giới thiệu
    let refDriverName = null;  // tên tài xế giới thiệu

    if (code) {
      if (config.registerCode && code === config.registerCode) {
        usedEnvCode = true;
      } else {
        const inv = db.prepare("SELECT * FROM invite_codes WHERE code = ? AND status = 'active'").get(code.toUpperCase());
        if (inv && (inv.max_uses == null || inv.used_count < inv.max_uses)) {
          invite = inv;
        } else {
          // Không phải mã mời -> thử coi là SĐT tài xế đã xác thực trên saycar (người giới thiệu).
          const cp = normPhone(code);
          if (validPhone(cp)) {
            const local = driverSync.findLocal(cp);
            if (local && local.verified) {
              refDriverPhone = cp; refDriverName = local.name || '';
            } else if (!local) {
              // Chưa có trong bảng đồng bộ -> tra sống trên saycar
              try {
                const drv = await saycar.findDriver(cp);
                if (drv && drv.verified) {
                  refDriverPhone = cp; refDriverName = drv.name || '';
                  driverSync.rememberVerified(cp, drv.name);
                }
              } catch (e) { console.error('findDriver (giới thiệu) lỗi:', e.message || e); }
            }
          }
        }
      }
    }

    // Nếu chưa có nguồn nào: người đăng ký CHÍNH LÀ tài xế saycar đã xác thực -> khỏi cần mã
    let selfDriver = false;
    if (!usedEnvCode && !invite && !refDriverPhone) {
      const localSelf = driverSync.findLocal(phone);
      if (localSelf && localSelf.verified) {
        selfDriver = true;
      } else if (!localSelf) {
        try {
          const d = await saycar.findDriver(phone);
          if (d && d.verified) { selfDriver = true; driverSync.rememberVerified(phone, d.name); }
        } catch (e) { console.error('findDriver (bản thân) lỗi:', e.message || e); }
      }
    }

    // Nếu đang khoá đăng ký: phải có mã / SĐT tài xế giới thiệu / bản thân là tài xế
    if (gated && !usedEnvCode && !invite && !refDriverPhone && !selfDriver) {
      return res.status(403).json({ error: 'Mã mời sai/hết lượt, hoặc SĐT tài xế giới thiệu không hợp lệ' });
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

    // Ghi lại nguồn đăng ký: mã mời hoặc tài xế giới thiệu
    if (invite) {
      db.prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?').run(invite.id);
      db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(invite.code, ins.lastInsertRowid);
    }
    if (refDriverPhone) {
      db.prepare('UPDATE users SET referrer_driver_phone = ?, referrer_driver_name = ? WHERE id = ?')
        .run(refDriverPhone, refDriverName || '', ins.lastInsertRowid);
    } else if (selfDriver) {
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

    // Chống dò mật khẩu: khoá SĐT sau nhiều lần sai
    const lock = loginLockLeftSec(phone);
    if (lock) return res.status(429).json({ error: `Sai mật khẩu nhiều lần. Thử lại sau ${Math.ceil(lock / 60)} phút.` });

    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      recordLoginFail(phone);
      return res.status(401).json({ error: 'Số điện thoại hoặc mật khẩu không đúng' });
    }
    if (user.status === 'blocked') return res.status(403).json({ error: 'Tài khoản đã bị khoá' });

    resetLogin(phone);
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
