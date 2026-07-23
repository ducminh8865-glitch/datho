const express = require('express');
const db = require('../db');
const { auth } = require('../middleware');
const { balanceOf } = require('../wallet');
const push = require('../push');

const router = express.Router();
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';

// Số dư + thông tin nhận tiền + lịch sử rút của tôi
router.get('/', auth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, amount, bank_name, bank_account_number, bank_account_name, status, created_at, resolved_at
     FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50`
  ).all(req.user.id);
  res.json({
    balance: balanceOf(req.user.id),
    bank: {
      bankName: req.user.bank_name || '',
      accountNumber: req.user.bank_account_number || '',
      accountName: req.user.bank_account_name || '',
    },
    rows,
  });
});

// Lưu / sửa thông tin nhận tiền (ngân hàng, số TK, tên chủ TK)
router.post('/bank', auth, (req, res) => {
  const bankName = String(req.body.bankName || '').trim();
  const accountNumber = String(req.body.accountNumber || '').replace(/\s/g, '');
  const accountName = String(req.body.accountName || '').trim();
  if (!bankName || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Nhập đủ ngân hàng, số tài khoản và tên chủ tài khoản' });
  }
  if (!/^[0-9]{4,25}$/.test(accountNumber)) {
    return res.status(400).json({ error: 'Số tài khoản không hợp lệ (chỉ gồm chữ số)' });
  }
  db.prepare('UPDATE users SET bank_name = ?, bank_account_number = ?, bank_account_name = ? WHERE id = ?')
    .run(bankName, accountNumber, accountName, req.user.id);
  res.json({ ok: true });
});

// Gửi yêu cầu rút tiền -> chờ admin chuyển khoản tay rồi bấm "Đã CK"
router.post('/', auth, (req, res) => {
  const u = req.user;
  if (!u.bank_name || !u.bank_account_number || !u.bank_account_name) {
    return res.status(400).json({ error: 'Hãy lưu thông tin nhận tiền trước khi rút' });
  }
  const amount = Math.round(Number(req.body.amount) || 0);
  if (amount < 1000) return res.status(400).json({ error: 'Số tiền rút tối thiểu 1.000 đ' });

  const bal = balanceOf(u.id);
  if (amount > bal.available) {
    const hold = bal.withdrawPending ? ` (đang chờ duyệt ${vnd(bal.withdrawPending)})` : '';
    return res.status(400).json({ error: `Chỉ có thể rút tối đa ${vnd(bal.available)}${hold}` });
  }

  const ins = db.prepare(
    'INSERT INTO withdrawals (user_id, amount, bank_name, bank_account_number, bank_account_name) VALUES (?,?,?,?,?)'
  ).run(u.id, amount, u.bank_name, u.bank_account_number, u.bank_account_name);

  // Báo cho tất cả admin vào duyệt
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  Promise.all(admins.map((a) => push.sendToUser(a.id, {
    title: '💸 Yêu cầu rút tiền ' + vnd(amount),
    body: `${u.phone}${u.name && u.name !== u.phone ? ' (' + u.name + ')' : ''} · ${u.bank_name} ${u.bank_account_number}`,
    url: '/admin.html',
    tag: 'withdrawal-' + ins.lastInsertRowid,
  }))).catch(() => {});

  res.json({ ok: true, id: ins.lastInsertRowid, balance: balanceOf(u.id) });
});

module.exports = router;
