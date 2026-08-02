// Số dư ví của cộng tác viên = hoa hồng đã chốt - tiền đã rút (admin đã CK).
// Phần "đang chờ duyệt" bị tạm giữ để không thể gửi rút quá số dư.
const db = require('./db');
const config = require('./config');

// Hoa hồng đã chốt (chỉ tính chuyến HOÀN THÀNH), theo % riêng của từng chuyến
function earnedOf(userId) {
  const r = db.prepare(
    `SELECT COALESCE(SUM(total_amount * COALESCE(commission_pct, ?) / 100), 0) AS earned
     FROM bookings
     WHERE user_id = ? AND saycar_status = 'success'
       AND lower(replace(trip_status, '_', '-')) = 'completed'`
  ).get(config.commissionPercent, userId);
  return Math.round(r.earned);
}

// Tổng tiền đã rút (admin đã CK) và đang chờ duyệt
function withdrawnOf(userId) {
  const r = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount END), 0) AS paid,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending
     FROM withdrawals WHERE user_id = ?`
  ).get(userId);
  return { paid: r.paid, pending: r.pending };
}

function balanceOf(userId) {
  const earned = earnedOf(userId);
  const w = withdrawnOf(userId);
  return {
    earned,                                            // tổng hoa hồng đã chốt
    withdrawnPaid: w.paid,                             // đã rút (đã CK)
    withdrawPending: w.pending,                        // đang chờ admin duyệt
    balance: earned - w.paid,                          // số dư hiển thị
    available: Math.max(0, earned - w.paid - w.pending), // có thể gửi rút thêm
  };
}

module.exports = { balanceOf };
