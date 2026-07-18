const db = require('./db');
const saycar = require('./saycar/client');
const push = require('./push');
const config = require('./config');

let timer = null;
let running = false;

function activeBookings() {
  const rows = db.prepare(
    `SELECT id, user_id, short_code, trip_status, payload_json
     FROM bookings
     WHERE saycar_status = 'success' AND short_code IS NOT NULL
       AND created_at > datetime('now', '-1 day')
     ORDER BY id DESC LIMIT 200`
  ).all();
  return rows.filter((r) => !saycar.isTerminal(r.trip_status));
}

const norm = (s) => String(s || '').toLowerCase().replace(/_/g, '-');

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    const rows = activeBookings();
    for (const r of rows) {
      try {
        const st = await saycar.getStatusByShortCode(r.short_code);
        if (!st || !st.status) continue;

        const summary = JSON.parse(r.payload_json);
        let driverChanged = false;
        if (st.driverName && summary.driverName !== st.driverName) {
          summary.driverName = st.driverName;
          summary.driverPhone = st.driverPhone;
          driverChanged = true;
        }

        if (norm(st.status) !== norm(r.trip_status)) {
          db.prepare('UPDATE bookings SET trip_status = ?, payload_json = ? WHERE id = ?')
            .run(st.status, JSON.stringify(summary), r.id);
          const label = saycar.statusLabel(st.status);
          await push.sendToUser(r.user_id, {
            title: 'Chuyến ' + (r.short_code || '') + ': ' + label,
            body: `${summary.pickup || ''} → ${summary.dropoff || ''}` + (st.driverName ? ` · Tài xế ${st.driverName}` : ''),
            url: '/',
            tag: 'booking-' + r.id,
          });
        } else if (driverChanged) {
          db.prepare('UPDATE bookings SET payload_json = ? WHERE id = ?').run(JSON.stringify(summary), r.id);
        }
      } catch { /* bỏ qua từng đơn */ }
    }
  } finally {
    running = false;
  }
}

function start() {
  if (config.saycar.mock) {
    console.log('     - Mock: không chạy theo dõi trạng thái nền.');
    return;
  }
  if (timer) return;
  const ms = Math.max(5, config.statusPollSeconds) * 1000;
  timer = setInterval(() => { pollOnce().catch(() => {}); }, ms);
  console.log(`     - Theo dõi trạng thái nền mỗi ${config.statusPollSeconds}s (thông báo đẩy: ${push.isEnabled() ? 'BẬT' : 'tắt'})`);
}

module.exports = { start, pollOnce };
