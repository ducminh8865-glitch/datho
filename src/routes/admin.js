const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth, adminOnly } = require('../middleware');
const push = require('../push');
const driverSync = require('../driver-sync');

const router = express.Router();
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';

// Tổng hoa hồng phải trả cho từng cộng tác viên (chỉ tính chuyến HOÀN THÀNH, trừ tiền đã CK)
router.get('/commissions', auth, adminOnly, (req, res) => {
  const rate = config.commissionPercent / 100;
  const rows = db.prepare(`
    SELECT u.id, u.phone, u.name,
           COUNT(b.id) AS completed,
           COALESCE(SUM(b.total_amount), 0) AS gross
    FROM users u
    JOIN bookings b ON b.user_id = u.id
      AND b.saycar_status = 'success'
      AND lower(replace(b.trip_status, '_', '-')) = 'completed'
    GROUP BY u.id
    ORDER BY gross DESC
  `).all();
  const paidRows = db.prepare(
    "SELECT user_id, COALESCE(SUM(amount), 0) AS paid FROM withdrawals WHERE status = 'paid' GROUP BY user_id"
  ).all();
  const paidMap = new Map(paidRows.map((r) => [r.user_id, r.paid]));
  res.json({
    percent: config.commissionPercent,
    rows: rows.map((r) => {
      const commission = Math.round(r.gross * rate);
      const withdrawn = paidMap.get(r.id) || 0;
      return {
        id: r.id, phone: r.phone, name: r.name,
        completed: r.completed, gross: r.gross,
        commission,
        withdrawn,                        // đã CK cho cộng tác viên
        remaining: commission - withdrawn, // còn phải trả
      };
    }),
  });
});

// ===== Yêu cầu rút tiền =====
router.get('/withdrawals', auth, adminOnly, (req, res) => {
  const rows = db.prepare(
    `SELECT w.id, w.amount, w.bank_name, w.bank_account_number, w.bank_account_name,
            w.status, w.created_at, w.resolved_at,
            u.phone AS user_phone, u.name AS user_name
     FROM withdrawals w JOIN users u ON u.id = w.user_id
     ORDER BY CASE w.status WHEN 'pending' THEN 0 ELSE 1 END, w.id DESC
     LIMIT 200`
  ).all();
  res.json(rows);
});

// Admin bấm "Đã CK" -> trừ vào số dư hiển thị của cộng tác viên
router.post('/withdrawals/:id/paid', auth, adminOnly, (req, res) => {
  const r = db.prepare(
    "UPDATE withdrawals SET status = 'paid', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).run(req.params.id);
  if (!r.changes) return res.status(400).json({ error: 'Yêu cầu không tồn tại hoặc đã xử lý rồi' });
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  push.sendToUser(w.user_id, {
    title: '✅ Đã chuyển khoản ' + vnd(w.amount),
    body: `Về ${w.bank_name} · ${w.bank_account_number}. Số dư đã trừ tương ứng.`,
    url: '/',
    tag: 'withdrawal-' + w.id,
  }).catch(() => {});
  res.json({ ok: true });
});

// Admin từ chối -> tiền quay lại số dư khả dụng
router.post('/withdrawals/:id/reject', auth, adminOnly, (req, res) => {
  const r = db.prepare(
    "UPDATE withdrawals SET status = 'rejected', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).run(req.params.id);
  if (!r.changes) return res.status(400).json({ error: 'Yêu cầu không tồn tại hoặc đã xử lý rồi' });
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  push.sendToUser(w.user_id, {
    title: '❌ Yêu cầu rút ' + vnd(w.amount) + ' bị từ chối',
    body: 'Liên hệ quản trị viên nếu cần hỗ trợ. Số tiền vẫn còn trong số dư của bạn.',
    url: '/',
    tag: 'withdrawal-' + w.id,
  }).catch(() => {});
  res.json({ ok: true });
});

// ===== Mã mời đăng ký =====
router.get('/invites', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM invite_codes ORDER BY id DESC').all();
  const users = db.prepare('SELECT invite_code, phone FROM users WHERE invite_code IS NOT NULL').all();
  const byCode = {};
  for (const u of users) (byCode[u.invite_code] ||= []).push(u.phone);
  res.json({
    envCode: config.registerCode || null, // mã hệ thống cấu hình trong .env (nếu có)
    rows: rows.map((r) => ({ ...r, usedBy: byCode[r.code] || [] })),
  });
});

// Tạo mã: bỏ trống code -> tự sinh 6 ký tự; maxUses trống -> không giới hạn
router.post('/invites', auth, adminOnly, (req, res) => {
  let code = String(req.body.code || '').trim().toUpperCase().replace(/\s/g, '');
  if (!code) {
    const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I,O,0,1 dễ nhầm
    do {
      code = Array.from({ length: 6 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join('');
    } while (db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code));
  }
  if (!/^[A-Z0-9]{4,20}$/.test(code)) return res.status(400).json({ error: 'Mã chỉ gồm chữ và số, dài 4-20 ký tự' });
  if (db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code)) return res.status(409).json({ error: 'Mã này đã tồn tại' });
  const maxUses = req.body.maxUses == null || req.body.maxUses === '' ? null : parseInt(req.body.maxUses, 10);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return res.status(400).json({ error: 'Số lượt không hợp lệ' });
  db.prepare('INSERT INTO invite_codes (code, max_uses) VALUES (?,?)').run(code, maxUses);
  res.json({ ok: true, code });
});

router.post('/invites/:id/toggle', auth, adminOnly, (req, res) => {
  const r = db.prepare(
    "UPDATE invite_codes SET status = CASE status WHEN 'active' THEN 'disabled' ELSE 'active' END WHERE id = ?"
  ).run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Không tìm thấy mã' });
  res.json({ ok: true });
});

router.delete('/invites/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM invite_codes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== Tài xế saycar (bản sao local để miễn mã mời) =====
router.get('/drivers/status', auth, adminOnly, (req, res) => {
  res.json(driverSync.stats());
});

router.post('/drivers/sync', auth, adminOnly, async (req, res) => {
  const result = await driverSync.syncOnce();
  res.json({ result, stats: driverSync.stats() });
});

// Danh sách tài khoản
router.get('/users', auth, adminOnly, (req, res) => {
  const rows = db.prepare(
    'SELECT id, phone, name, status, role, invite_code, referrer_driver_phone, referrer_driver_name, created_at FROM users ORDER BY id DESC'
  ).all();
  res.json(rows);
});

router.post('/users/:id/approve', auth, adminOnly, (req, res) => {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending_approval'").run(req.params.id);
  res.json({ ok: true });
});

router.post('/users/:id/block', auth, adminOnly, (req, res) => {
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (target && target.role === 'admin') return res.status(400).json({ error: 'Không thể khóa tài khoản quản trị' });
  db.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post('/users/:id/unblock', auth, adminOnly, (req, res) => {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Toàn bộ đơn đặt
router.get('/bookings', auth, adminOnly, (req, res) => {
  const rows = db.prepare(
    `SELECT b.id, b.saycar_status, b.saycar_ref, b.short_code, b.trip_status, b.error, b.created_at, b.payload_json,
            u.name AS user_name, u.phone AS user_phone
     FROM bookings b JOIN users u ON u.id = b.user_id
     ORDER BY b.id DESC LIMIT 300`
  ).all();
  res.json(rows.map((r) => ({
    id: r.id,
    status: r.saycar_status,
    ref: r.saycar_ref,
    shortCode: r.short_code,
    tripStatus: r.trip_status,
    error: r.error,
    created_at: r.created_at,
    user_name: r.user_name,
    user_phone: r.user_phone,
    payload: JSON.parse(r.payload_json),
  })));
});

module.exports = router;
