const express = require('express');
const { auth } = require('../middleware');
const push = require('../push');
const config = require('../config');

const router = express.Router();

// Trình duyệt lấy khoá công khai để đăng ký nhận thông báo
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: config.push.publicKey, enabled: push.isEnabled() });
});

// Lưu đăng ký nhận thông báo của thiết bị hiện tại
router.post('/subscribe', auth, (req, res) => {
  try {
    push.saveSubscription(req.user.id, req.body.subscription || req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

module.exports = router;
