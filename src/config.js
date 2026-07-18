require('dotenv').config();

function bool(v, d = false) {
  if (v === undefined || v === '') return d;
  return v === '1' || v === 'true' || v === 'yes';
}

const port = parseInt(process.env.PORT || '3000', 10);

const config = {
  port,
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-doi-di-ngay',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPhone: (process.env.ADMIN_PHONE || '').replace(/\D/g, ''),
  // Nếu đặt REGISTER_CODE, người đăng ký phải nhập đúng mã này. Để trống = ai cũng đăng ký được.
  registerCode: (process.env.REGISTER_CODE || '').trim(),

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost',
  },

  saycar: {
    mock: bool(process.env.SAYCAR_MOCK, false),
    baseUrl: (process.env.SAYCAR_BASE_URL || 'https://api.saycar.vn').replace(/\/$/, ''),
    loginPath: process.env.SAYCAR_LOGIN_PATH || '/private/api/admin/login',
    username: process.env.SAYCAR_USERNAME || '',
    password: process.env.SAYCAR_PASSWORD || '',
    // Header bắt buộc mà cổng API saycar yêu cầu trên mọi request
    clientSecret: process.env.SAYCAR_CLIENT_SECRET || '',
    referer: process.env.SAYCAR_REFERER || 'https://admin.saycar.vn/',
    origin: process.env.SAYCAR_ORIGIN || 'https://admin.saycar.vn',
    userAgent: process.env.SAYCAR_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  },

  push: {
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey: process.env.VAPID_PUBLIC || '',
    privateKey: process.env.VAPID_PRIVATE || '',
  },
  statusPollSeconds: parseInt(process.env.STATUS_POLL_SECONDS || '12', 10),

  // Hoa hồng cho người đặt hộ: % của tổng khách trả, chỉ tính khi chuyến HOÀN THÀNH
  commissionPercent: parseFloat(process.env.COMMISSION_PERCENT || '15'),

  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
};

module.exports = config;
