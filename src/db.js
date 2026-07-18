const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    phone         TEXT UNIQUE NOT NULL,                    -- số điện thoại = tên đăng nhập
    name          TEXT,
    email         TEXT,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',          -- active | blocked
    role          TEXT NOT NULL DEFAULT 'collaborator',    -- collaborator | admin
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    payload_json  TEXT NOT NULL,
    saycar_status TEXT NOT NULL DEFAULT 'pending',         -- pending | success | failed (kết quả đẩy đơn)
    saycar_ref    TEXT,                                    -- bookingId của saycar
    error         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Di trú nhẹ: thêm cột theo dõi trạng thái chuyến (bỏ qua nếu đã có)
for (const stmt of [
  "ALTER TABLE bookings ADD COLUMN short_code TEXT",       // mã chuyến, dùng để tra trạng thái
  "ALTER TABLE bookings ADD COLUMN trip_status TEXT",      // trạng thái chuyến từ saycar
  "ALTER TABLE bookings ADD COLUMN total_amount REAL",     // tổng khách trả (để tính hoa hồng)
]) {
  try { db.exec(stmt); } catch { /* cột đã tồn tại */ }
}

// Đăng ký nhận thông báo đẩy (Web Push) theo từng thiết bị/trình duyệt
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    endpoint   TEXT UNIQUE NOT NULL,
    keys_json  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
