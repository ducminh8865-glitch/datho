// Chống lạm dụng: giới hạn theo IP + khoá đăng nhập theo SĐT.
// (Khoá theo SĐT để không phạt oan nhiều người dùng chung 1 IP nhà mạng - CGNAT.)

// --- Giới hạn tần suất theo IP (dùng cho auth, demo) ---
function ipLimiter({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { n, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'x';
    let r = hits.get(ip);
    if (!r || now > r.resetAt) { r = { n: 0, resetAt: now + windowMs }; hits.set(ip, r); }
    r.n++;
    if (hits.size > 5000) { for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k); }
    if (r.n > max) {
      res.set('Retry-After', String(Math.ceil((r.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || 'Quá nhiều yêu cầu, thử lại sau ít phút.' });
    }
    next();
  };
}

// --- Khoá đăng nhập theo SĐT sau nhiều lần sai mật khẩu ---
const failMap = new Map(); // phone -> { n, until }
const MAX_FAIL = 5;                 // sai 5 lần
const LOCK_MS = 15 * 60 * 1000;     // -> khoá 15 phút

function loginLockLeftSec(phone) {
  const r = failMap.get(phone);
  if (r && r.until && Date.now() < r.until) return Math.ceil((r.until - Date.now()) / 1000);
  return 0;
}
function recordLoginFail(phone) {
  const now = Date.now();
  let r = failMap.get(phone);
  if (!r || (r.until && now > r.until)) r = { n: 0, until: 0 };
  r.n++;
  if (r.n >= MAX_FAIL) { r.until = now + LOCK_MS; r.n = 0; }
  failMap.set(phone, r);
}
function resetLogin(phone) { failMap.delete(phone); }

// --- Quên mật khẩu: mỗi SĐT chỉ báo về Telegram admin 1 lần / 15 phút ---
// Áp cho MỌI số, kể cả số chưa đăng ký, để không lộ ai đã có tài khoản.
const forgotMap = new Map(); // phone -> thời điểm được gửi tiếp
const FORGOT_MS = 15 * 60 * 1000;

function forgotOnCooldown(phone) {
  const until = forgotMap.get(phone);
  return !!(until && Date.now() < until);
}
function markForgot(phone) {
  const now = Date.now();
  if (forgotMap.size > 5000) for (const [k, v] of forgotMap) if (now > v) forgotMap.delete(k);
  forgotMap.set(phone, now + FORGOT_MS);
}

module.exports = { ipLimiter, loginLockLeftSec, recordLoginFail, resetLogin, forgotOnCooldown, markForgot };
