// Đồng bộ danh sách tài xế saycar về DB local (bảng saycar_drivers).
// Đăng ký tài khoản sẽ check bảng này trước — nhanh, không phải gọi admin saycar mỗi lần.
const db = require('./db');
const config = require('./config');
const saycar = require('./saycar/client');

// Chuẩn hoá SĐT về dạng 0xxxxxxxxx để so khớp
function normPhone(p) {
  let s = String(p || '').replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('84')) s = '0' + s.slice(2);
  return s;
}

const upsert = db.prepare(`
  INSERT INTO saycar_drivers (phone, name, verified, raw_status, synced_at)
  VALUES (?,?,?,?, datetime('now'))
  ON CONFLICT(phone) DO UPDATE SET
    name = excluded.name, verified = excluded.verified,
    raw_status = excluded.raw_status, synced_at = excluded.synced_at
`);

// Các trường trạng thái gốc của saycar (lưu lại để debug khi cần chỉnh isDriverVerified)
function statusFields(d) {
  const out = {};
  for (const k of Object.keys(d)) if (/status|verif|active/i.test(k)) out[k] = d[k];
  return JSON.stringify(out);
}

let running = false;
let last = null;

async function syncOnce() {
  if (config.saycar.mock) return { ok: false, reason: 'mock' };
  if (running) return last;
  running = true;
  try {
    let total = 0, verified = 0;
    for (let page = 1; page <= 500; page++) {
      const list = await saycar.listDrivers({ page, size: 100 });
      if (!list.length) break;
      for (const d of list) {
        const phone = normPhone(d.phone);
        if (!phone) continue;
        const v = saycar.isDriverVerified(d) ? 1 : 0;
        upsert.run(phone, d.firstName || d.name || '', v, statusFields(d));
        total++;
        if (v) verified++;
      }
      if (list.length < 100) break;
    }
    last = { ok: true, total, verified, at: new Date().toISOString() };
    console.log(`✅ Đồng bộ tài xế saycar: ${total} tài xế, ${verified} đã xác thực`);
  } catch (e) {
    last = { ok: false, error: String(e.message || e), at: new Date().toISOString() };
    console.error('❌ Đồng bộ tài xế saycar lỗi:', last.error);
  } finally {
    running = false;
  }
  return last;
}

// Tra local; trả về hàng trong bảng hoặc undefined
function findLocal(phone) {
  return db.prepare('SELECT * FROM saycar_drivers WHERE phone = ?').get(normPhone(phone));
}

// Ghi nhớ tài xế vừa tra sống thành công (chưa kịp có trong đợt đồng bộ)
function rememberVerified(phone, name) {
  const p = normPhone(phone);
  if (p) upsert.run(p, name || '', 1, '{"nguon":"tra-song-luc-dang-ky"}');
}

function stats() {
  const r = db.prepare('SELECT COUNT(*) AS total, SUM(verified) AS verified, MAX(synced_at) AS synced_at FROM saycar_drivers').get();
  return { total: r.total, verified: r.verified || 0, syncedAt: r.synced_at, last };
}

function start() {
  if (config.saycar.mock) {
    console.log('     - Mock: không đồng bộ tài xế saycar.');
    return;
  }
  syncOnce(); // chạy ngay khi khởi động
  const ms = Math.max(0.5, config.driverSyncHours) * 3600 * 1000;
  setInterval(() => { syncOnce(); }, ms);
  console.log(`     - Đồng bộ tài xế saycar mỗi ${config.driverSyncHours} giờ.`);
}

module.exports = { start, syncOnce, findLocal, rememberVerified, stats };
