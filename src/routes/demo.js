// Endpoint CÔNG KHAI cho trang xem thử (preview.html): chỉ ĐỌC, không tạo đơn.
// Cho phép bản demo hiện gợi ý địa chỉ + tính giá THẬT của saycar, khớp admin.
const express = require('express');
const saycar = require('../saycar/client');

const router = express.Router();

router.post('/autocomplete', async (req, res) => {
  const input = String(req.body.input || '').trim();
  if (input.length < 2) return res.json({ predictions: [] });
  try {
    res.json({ predictions: await saycar.autocomplete(input) });
  } catch (e) {
    res.json({ predictions: [], warn: String(e.message || e) });
  }
});

router.post('/preview', async (req, res) => {
  const { fromPlaceId, toPlaceId, vehicle } = req.body || {};
  if (!fromPlaceId || !toPlaceId) return res.status(400).json({ error: 'Hãy chọn điểm đón và điểm đến' });
  try {
    const { price, from, to } = await saycar.preview({ fromPlaceId, toPlaceId, vehicle: vehicle || 'CAR' });
    res.json({ ok: true, from: from.address, to: to.address, distance: price.distance, duration: price.duration, total: price.totalCustomerPaid });
  } catch (e) {
    res.status(502).json({ error: 'Không tính được giá: ' + (e.message || e) });
  }
});

module.exports = router;
