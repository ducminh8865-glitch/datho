const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth, adminOnly } = require('../middleware');

const router = express.Router();

// Tổng hoa hồng phải trả cho từng cộng tác viên (chỉ tính chuyến HOÀN THÀNH)
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
  res.json({
    percent: config.commissionPercent,
    rows: rows.map((r) => ({
      id: r.id, phone: r.phone, name: r.name,
      completed: r.completed, gross: r.gross,
      commission: Math.round(r.gross * rate),
    })),
  });
});

// Danh sách tài khoản
router.get('/users', auth, adminOnly, (req, res) => {
  const rows = db.prepare(
    'SELECT id, phone, name, status, role, created_at FROM users ORDER BY id DESC'
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
