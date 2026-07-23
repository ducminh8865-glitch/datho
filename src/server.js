const express = require('express');
const path = require('path');
const config = require('./config');
require('./db'); // khởi tạo database

const app = express();
app.use(express.json({ limit: '1mb' }));

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/push', require('./routes/push'));
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
