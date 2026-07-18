const webpush = require('web-push');
const db = require('./db');
const config = require('./config');

const enabled = !!(config.push.publicKey && config.push.privateKey);
if (enabled) {
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
} else {
  console.log('ℹ️  Chưa cấu hình VAPID -> thông báo đẩy TẮT. Tạo khoá: node -e "console.log(require(\'web-push\').generateVAPIDKeys())"');
}

function isEnabled() {
  return enabled;
}

function saveSubscription(userId, sub) {
  if (!sub || !sub.endpoint || !sub.keys) throw new Error('Đăng ký thông báo không hợp lệ');
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys_json) VALUES (?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json`
  ).run(userId, sub.endpoint, JSON.stringify(sub.keys));
}

async function sendToUser(userId, payload) {
  if (!enabled) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: JSON.parse(s.keys_json) };
    try {
      await webpush.sendNotification(subscription, body);
    } catch (e) {
      // 404/410 = đăng ký hết hạn -> xoá
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      }
    }
  }));
}

module.exports = { isEnabled, saveSubscription, sendToUser };
