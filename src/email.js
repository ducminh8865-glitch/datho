const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp.user || !config.smtp.pass) return null; // chưa cấu hình -> chế độ dev (in ra console)
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

async function sendOtp(email, code) {
  const t = getTransporter();
  const subject = 'Mã xác minh - SayCar Đặt Hộ';
  const text = `Mã xác minh của bạn là: ${code}\nMã có hiệu lực trong ${config.otpTtlMinutes} phút.`;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:420px">
       <h2 style="margin:0 0 8px">SayCar Đặt Hộ</h2>
       <p>Mã xác minh của bạn là:</p>
       <p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#0b7">${code}</p>
       <p style="color:#666">Mã có hiệu lực trong ${config.otpTtlMinutes} phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>
     </div>`;

  if (!t) {
    console.log(`\n[EMAIL-DEV] Gửi tới ${email}  ->  MÃ OTP = ${code}\n`);
    return { dev: true };
  }
  await t.sendMail({ from: config.smtp.from, to: email, subject, text, html });
  return { sent: true };
}

module.exports = { sendOtp };
