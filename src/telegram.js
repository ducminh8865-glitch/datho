// Gửi thông báo về Telegram (bot của admin) mỗi khi có chuyến đặt hộ.
const config = require('./config');

function isEnabled() {
  return !!(config.telegram.token && config.telegram.chatId);
}

// Gửi tin nhắn (plain text, không cần escape). Fire-and-forget, không làm hỏng luồng chính.
async function send(text) {
  if (!isEnabled()) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error('Telegram HTTP', res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error('Telegram gửi lỗi:', e.message || e);
  }
}

module.exports = { isEnabled, send };
