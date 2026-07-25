const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth } = require('../middleware');
const saycar = require('../saycar/client');
const { balanceOf } = require('../wallet');

const router = express.Router();

const RATE = config.commissionPercent / 100;
const CANCEL_WINDOW_MS = 10000;  // nút huỷ chỉ hiện trong 10 giây đầu
const CANCEL_GRACE_MS = 15000;   // server cho phép huỷ tới 15s (bù độ trễ mạng)
const ageMsOf = (createdAt) => Date.now() - new Date(String(createdAt).replace(' ', 'T') + 'Z').getTime();
const norm = (s) => String(s || '').toLowerCase().replace(/_/g, '-');
const isCompleted = (s) => norm(s) === 'completed';
const isCancelled = (s) => ['canceled', 'cancelled', 'rejected', 'expired'].includes(norm(s));
const commissionOf = (amount) => Math.round((Number(amount) || 0) * RATE);

// Dữ liệu cho form: loại xe, phương thức thanh toán
router.get('/ref-data', auth, (req, res) => {
  res.json({ vehicleTypes: saycar.VEHICLE_TYPES, paymentMethods: saycar.PAYMENT_METHODS });
});

// Gợi ý địa chỉ (proxy sang saycar)
router.post('/autocomplete', auth, async (req, res) => {
  const input = String(req.body.input || '').trim();
  if (input.length < 2) return res.json({ predictions: [] });
  try {
    const predictions = await saycar.autocomplete(input);
    res.json({ predictions });
  } catch (e) {
    // saycar thỉnh thoảng trả 500 cho vài chuỗi — không làm hỏng trải nghiệm gõ
    res.json({ predictions: [], warn: String(e.message || e) });
  }
});

// Tính giá (xem trước) — chỉ hiển thị, không tạo đơn
router.post('/preview', auth, async (req, res) => {
  const { fromPlaceId, toPlaceId, vehicle } = req.body || {};
  if (!fromPlaceId || !toPlaceId) return res.status(400).json({ error: 'Hãy chọn điểm đón và điểm đến từ danh sách gợi ý' });
  try {
    const { price, from, to } = await saycar.preview({ fromPlaceId, toPlaceId, vehicle: vehicle || 'CAR' });
    res.json({
      ok: true,
      from: from.address,
      to: to.address,
      distance: price.distance,
      duration: price.duration,
      total: price.totalCustomerPaid,
      priceBeforeVat: price.priceBeforeVat,
      vatPrice: price.vatPrice,
      serviceFee: price.serviceFee,
    });
  } catch (e) {
    res.status(502).json({ error: 'Không tính được giá: ' + (e.message || e) });
  }
});

// Tạo chuyến -> đẩy vào saycar
router.post('/', auth, async (req, res) => {
  const { fromPlaceId, toPlaceId, fromText, toText, vehicle, customerName, customerPhone, paymentMethod } = req.body || {};
  if (!fromPlaceId || !toPlaceId) return res.status(400).json({ error: 'Hãy chọn điểm đón và điểm đến từ gợi ý' });
  if (!String(customerPhone || '').trim()) return res.status(400).json({ error: 'Thiếu số điện thoại khách' });

  const summary = {
    pickup: fromText || '',
    dropoff: toText || '',
    vehicle: vehicle || 'CAR',
    customerName: customerName || '',
    customerPhone,
    paymentMethod: paymentMethod || 'TRANSFER',
  };

  const ins = db.prepare('INSERT INTO bookings (user_id, payload_json, saycar_status) VALUES (?,?,?)')
    .run(req.user.id, JSON.stringify(summary), 'pending');
  const bookingId = ins.lastInsertRowid;

  try {
    const result = await saycar.createBooking({
      fromPlaceId,
      toPlaceId,
      vehicle: vehicle || 'CAR',
      customerName,
      customerPhone,
      paymentMethod: paymentMethod || 'TRANSFER',
    });

    const ref = result.bookingId || null;
    summary.total = result.totalAmount;
    summary.driverName = result.driverName;
    summary.driverPhone = result.driverPhoneNumber;
    const shortCode = result.shortCode || null;
    const tripStatus = result.statusBooking || null;
    const totalAmount = Number(result.totalAmount) || 0;
    db.prepare('UPDATE bookings SET saycar_status = ?, saycar_ref = ?, short_code = ?, trip_status = ?, total_amount = ?, payload_json = ? WHERE id = ?')
      .run('success', ref, shortCode, tripStatus, totalAmount, JSON.stringify(summary), bookingId);

    res.json({ ok: true, bookingId, saycar: result });
  } catch (e) {
    const msg = String(e.message || e);
    db.prepare('UPDATE bookings SET saycar_status = ?, error = ? WHERE id = ?').run('failed', msg, bookingId);
    res.status(502).json({ ok: false, bookingId, error: 'Không tạo được chuyến trên saycar: ' + msg });
  }
});

// Huỷ chuyến -> huỷ luôn trên saycar
router.post('/:id/cancel', auth, async (req, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy chuyến của bạn' });
  if (row.saycar_status !== 'success' || !row.saycar_ref) {
    return res.status(400).json({ error: 'Chuyến chưa được tạo trên saycar nên không cần huỷ' });
  }
  if (saycar.isTerminal(row.trip_status)) {
    return res.status(400).json({ error: 'Chuyến đã kết thúc/đã huỷ, không thể huỷ nữa' });
  }
  if (ageMsOf(row.created_at) > CANCEL_GRACE_MS) {
    return res.status(400).json({ error: 'Quá thời gian huỷ (chỉ huỷ trong 10 giây đầu sau khi đặt)' });
  }
  try {
    await saycar.cancelBooking({ bookId: row.saycar_ref, shortCode: row.short_code });
    db.prepare("UPDATE bookings SET trip_status = 'canceled' WHERE id = ?").run(row.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'Huỷ chuyến trên saycar thất bại: ' + (e.message || e) });
  }
});

// Thu nhập (hoa hồng) của tôi
router.get('/earnings', auth, (req, res) => {
  const rows = db.prepare(
    "SELECT total_amount, trip_status FROM bookings WHERE user_id = ? AND saycar_status = 'success'"
  ).all(req.user.id);

  let completedCount = 0, activeGross = 0, activeCount = 0;
  for (const r of rows) {
    const amt = Number(r.total_amount) || 0;
    if (isCompleted(r.trip_status)) { completedCount++; }
    else if (!isCancelled(r.trip_status)) { activeCount++; activeGross += amt; }
  }
  const bal = balanceOf(req.user.id);
  res.json({
    percent: config.commissionPercent,
    earned: bal.earned,                     // đã chốt (chuyến hoàn thành)
    completedCount,
    pending: commissionOf(activeGross),     // dự kiến (chuyến đang chạy)
    activeCount,
    withdrawnPaid: bal.withdrawnPaid,       // đã rút (admin đã CK)
    withdrawPending: bal.withdrawPending,   // đang chờ duyệt rút
    balance: bal.balance,                   // số dư hiển thị = đã chốt - đã rút
    available: bal.available,               // có thể gửi rút thêm
  });
});

// Lịch sử đơn của chính tôi (kèm làm mới trạng thái các chuyến còn hoạt động)
router.get('/mine', auth, async (req, res) => {
  const rows = db.prepare(
    'SELECT id, payload_json, saycar_status, saycar_ref, short_code, trip_status, total_amount, error, created_at FROM bookings WHERE user_id = ? ORDER BY id DESC LIMIT 100'
  ).all(req.user.id);

  // Làm mới trạng thái cho các chuyến đã đẩy thành công và chưa ở trạng thái cuối
  await Promise.all(rows.map(async (r) => {
    if (r.saycar_status !== 'success' || !r.short_code || saycar.isTerminal(r.trip_status)) return;
    try {
      const st = await saycar.getStatusByShortCode(r.short_code);
      if (!st) return;
      const summary = JSON.parse(r.payload_json);
      if (st.driverName) summary.driverName = st.driverName;
      if (st.driverPhone) summary.driverPhone = st.driverPhone;
      r.trip_status = st.status;
      r.payload_json = JSON.stringify(summary);
      db.prepare('UPDATE bookings SET trip_status = ?, payload_json = ? WHERE id = ?')
        .run(st.status, r.payload_json, r.id);
    } catch { /* bỏ qua lỗi tra trạng thái */ }
  }));

  res.json(rows.map((r) => {
    const cancelable = r.saycar_status === 'success' && r.saycar_ref && !saycar.isTerminal(r.trip_status);
    const cancelSecondsLeft = cancelable
      ? Math.max(0, Math.ceil((CANCEL_WINDOW_MS - ageMsOf(r.created_at)) / 1000))
      : 0;
    return {
      id: r.id,
      status: r.saycar_status,
      tripStatus: r.trip_status,
      tripStatusLabel: r.trip_status ? saycar.statusLabel(r.trip_status) : null,
      ref: r.saycar_ref,
      shortCode: r.short_code,
      total: r.total_amount,
      commission: commissionOf(r.total_amount),   // hoa hồng của chuyến
      earned: isCompleted(r.trip_status),         // đã chốt hay chưa
      cancelled: isCancelled(r.trip_status),
      cancelSecondsLeft,                          // giây còn lại để huỷ (0 = không huỷ được)
      error: r.error,
      created_at: r.created_at,
      payload: JSON.parse(r.payload_json),
    };
  }));
});

module.exports = router;
