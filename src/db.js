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
  "ALTER TABLE users ADD COLUMN bank_name TEXT",           // thông tin nhận tiền rút
  "ALTER TABLE users ADD COLUMN bank_account_number TEXT",
  "ALTER TABLE users ADD COLUMN bank_account_name TEXT",
  "ALTER TABLE users ADD COLUMN invite_code TEXT",         // đăng ký bằng mã mời nào
]) {
  try { db.exec(stmt); } catch { /* cột đã tồn tại */ }
}

// Bản sao danh sách tài xế saycar (đồng bộ định kỳ) — dùng để miễn mã mời khi đăng ký
db.exec(`
  CREATE TABLE IF NOT EXISTS saycar_drivers (
    phone      TEXT PRIMARY KEY,                           -- chuẩn hoá dạng 0xxxxxxxxx
    name       TEXT,
    verified   INTEGER NOT NULL DEFAULT 0,                 -- 1 = đã xác thực
    raw_status TEXT,                                       -- các trường trạng thái gốc (để debug)
    synced_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Mã mời đăng ký (admin tạo trong trang quản trị)
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    max_uses   INTEGER,                                    -- NULL = không giới hạn
    used_count INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'active',             -- active | disabled
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Yêu cầu rút tiền của cộng tác viên (admin duyệt tay rồi bấm "Đã CK")
db.exec(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    amount              INTEGER NOT NULL,                  -- số tiền rút (đ)
    bank_name           TEXT NOT NULL,                     -- chụp lại thông tin nhận tiền lúc gửi yêu cầu
    bank_account_number TEXT NOT NULL,
    bank_account_name   TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | rejected
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT                               -- lúc admin bấm Đã CK / Từ chối
  );
`);

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
