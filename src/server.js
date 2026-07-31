const express = require('express');
const path = require('path');
const config = require('./config');
require('./db'); // khởi tạo database

const app = express();
app.set('trust proxy', 1); // đứng sau Caddy -> đọc đúng IP khách qua X-Forwarded-For
app.use(express.json({ limit: '1mb' }));

// Security headers cơ bản
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const { ipLimiter } = require('./rate-limit');

// API (kèm giới hạn tần suất cho các cổng dễ bị lạm dụng)
app.use('/api/auth', ipLimiter({ windowMs: 10 * 60 * 1000, max: 120, message: 'Đăng nhập/đăng ký quá nhiều lần, thử lại sau ít phút.' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/push', require('./routes/push'));
app.use('/api/demo', ipLimiter({ windowMs: 5 * 60 * 1000, max: 200, message: 'Quá nhiều yêu cầu, thử lại sau ít phút.' }));
app.use('/api/demo', require('./routes/demo'));
app.get('/api/health', (req, res) => res.json({ ok: true, saycarMock: config.saycar.mock }));

// Giao diện tĩnh
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log('');
  console.log('  ✅ Web đặt hộ đang chạy: ' + config.appUrl);
  console.log('     - Kết nối saycar: ' + (config.saycar.mock ? 'CHẾ ĐỘ GIẢ LẬP (mock)' : 'GỌI THẬT'));
  if (!config.smtp.user) console.log('     - Chưa cấu hình SMTP -> mã OTP sẽ IN RA MÀN HÌNH này.');
  if (config.adminEmail) console.log('     - Email quản trị: ' + config.adminEmail);
  require('./status-poller').start();
  require('./driver-sync').start();
  console.log('');
});
