# SayCar · Đặt Hộ

Web app cho **cộng tác viên** đặt chuyến hộ khách hàng. Đơn được server tự động đẩy vào
hệ thống admin saycar.vn. Cộng tác viên không cần tài khoản saycar và không thấy trang admin.

## Chạy trên máy (thử nghiệm)

```bash
npm install
cp .env.example .env      # rồi mở .env sửa các giá trị
npm start
```

Mở http://localhost:3000

> Yêu cầu **Node.js >= 22.5** (dùng `node:sqlite` có sẵn, không cần cài database).

## Cách hoạt động

1. Cộng tác viên **đăng ký** đơn giản: **số điện thoại + mật khẩu + xác nhận mật khẩu**
   → **tự đăng nhập vào luôn** (không OTP, không chờ duyệt).
2. Nhập thông tin chuyến (chọn điểm đón/đến từ gợi ý, tính giá) → bấm **Đặt chuyến**.
3. Server đăng nhập tài khoản saycar "dịch vụ" và **tạo chuyến trong admin**. Mỗi đơn ghi
   rõ cộng tác viên (số điện thoại) nào đặt.

**Tài khoản admin:** người **đăng ký đầu tiên** tự thành admin. Hoặc chỉ định `ADMIN_PHONE`
trong `.env`. Admin vào `/admin.html` để xem tất cả đơn và **khoá** tài khoản xấu.

## Rút tiền (hoa hồng)

1. Cộng tác viên bấm **💸 Rút tiền** trên thẻ số dư → nhập **ngân hàng + số TK + tên chủ TK**,
   bấm **Lưu** (lần đầu; sau đó bấm **Sửa** để đổi).
2. Nhập số tiền muốn rút → **Gửi yêu cầu**. Số tiền chờ duyệt bị **tạm giữ** (không rút quá số dư).
3. Admin nhận thông báo, vào `/admin.html` mục **Yêu cầu rút tiền**, chuyển khoản tay rồi bấm
   **✅ Đã chuyển khoản** → số dư của cộng tác viên **bị trừ tương ứng**. Bấm **Từ chối** thì
   tiền quay lại số dư.

> Số dư = hoa hồng các chuyến **hoàn thành** − tiền **đã CK**. Server luôn kiểm tra lại số dư
> khi nhận yêu cầu (không tin số client gửi lên).

> 🔒 Đăng ký đang **mở tự do** (ai có link cũng đăng ký + tạo đơn thật được). Muốn giới hạn:
> đặt `REGISTER_CODE=<mã>` trong `.env` → chỉ người có mã mới đăng ký được.

> ℹ️ Bản này **không dùng OTP/email** nữa nên **không cần cấu hình Gmail/SMTP**.

## Cấu hình `.env`

| Biến | Ý nghĩa |
|------|---------|
| `ADMIN_EMAIL` | Email của bạn — tự thành admin |
| `JWT_SECRET` | Chuỗi bí mật ký phiên đăng nhập — **đổi thành chuỗi ngẫu nhiên dài** |
| `SMTP_USER` / `SMTP_PASS` | Gmail + mật khẩu ứng dụng để gửi OTP (xem dưới). Bỏ trống → OTP in ra console |
| `SAYCAR_MOCK` | `1` = chạy giả lập (không gọi saycar). `0` = đẩy đơn thật |
| `SAYCAR_*` | Địa chỉ + tài khoản saycar để đẩy đơn (xem dưới) |

### Gửi OTP bằng Gmail (miễn phí)

1. Bật **Xác minh 2 bước** cho Gmail.
2. Vào Google Account → Bảo mật → **Mật khẩu ứng dụng** → tạo 1 cái (16 ký tự).
3. Điền vào `.env`: `SMTP_USER=email@gmail.com`, `SMTP_PASS=<16 ký tự>`.

Nếu để trống, app vẫn chạy — mã OTP **in ra màn hình console** (tiện lúc thử).

## ⚙️ Kết nối saycar (ĐÃ NỐI THẬT)

App gọi thẳng API của saycar tại `https://api.saycar.vn`, dùng đúng các endpoint mà
trang admin dùng — nên **địa điểm và giá luôn khớp tuyệt đối với admin**:

| Bước | API saycar |
|------|-----------|
| Đăng nhập (lấy token) | `POST /private/api/admin/login` |
| Gợi ý địa chỉ | `POST /api/admin/place/auto-complete` |
| Lấy toạ độ | `POST /api/place/detail` |
| Tính giá | `POST /api/admin/booking/preview` |
| Tra khách theo SĐT | `GET /api/admin/manage/CUSTOMER?phone=` |
| Tạo chuyến | `POST /api/admin/booking` |

Mọi request đều kèm header bắt buộc `x-udtl-client-secret` (khai trong `.env`).
Toàn bộ logic nằm ở [`src/saycar/client.js`](src/saycar/client.js).

**Cấu hình** (trong `.env`): `SAYCAR_MOCK=0`, `SAYCAR_USERNAME`, `SAYCAR_PASSWORD`
(tài khoản dịch vụ), `SAYCAR_CLIENT_SECRET` (bọc trong ngoặc kép vì có ký tự `#`).

> ⚠️ **Tạo chuyến là thao tác THẬT**: saycar gán tài xế ngay khi tạo. Giao diện có
> bước "Tính giá" + hộp xác nhận trước khi tạo. Giá được tính lại ở server (không tin
> giá client gửi lên) để chống gian lận.

> ℹ️ Khách MỚI (chưa có trong saycar): app gửi tạo chuyến với tên + SĐT, `userUUID` rỗng.
> Nếu saycar từ chối đơn của khách hoàn toàn mới, cần ghi lại thêm 1 lần tạo đơn cho
> khách mới để bổ sung bước tạo khách. Khách đã từng đi thì luôn chạy tốt (tra theo SĐT).

### Theo dõi trạng thái chuyến
Sau khi tạo, app lưu `shortCode` (mã chuyến) và tra trạng thái qua
`GET /api/admin/manage/booking?...&shortCode=<mã>`. Mục "Chuyến tôi đã đặt" tự làm mới
mỗi 25 giây và hiển thị (kèm tên + SĐT tài xế):

| saycar | Hiển thị |
|--------|----------|
| pending | Đang tìm tài xế |
| accepted | Tài xế đã nhận |
| in-progress | Đã đón khách / đang chạy |
| completed | Hoàn thành |
| canceled / rejected | Đã huỷ / Tài xế từ chối |

Đơn đã ở trạng thái cuối (hoàn thành/huỷ) thì ngừng gọi saycar để đỡ tải.

## Đưa lên VPS

```bash
# Trên VPS (Ubuntu, đã cài Node >=22.5)
git clone <repo>            # hoặc copy thư mục lên
cd saycar-datho
npm install
cp .env.example .env && nano .env   # điền cấu hình thật, APP_URL=https://ten-mien-cua-ban
npm install -g pm2
pm2 start src/server.js --name datho
pm2 save && pm2 startup      # tự chạy lại khi VPS khởi động
```

Đặt **nginx** làm proxy vào cổng 3000 và bật HTTPS (Let's Encrypt) cho tên miền của bạn.

## Cấu trúc

```
src/
  server.js          # khởi động Express
  config.js          # đọc .env
  db.js              # tạo bảng SQLite
  email.js           # gửi OTP
  auth-utils.js      # OTP, hash mật khẩu, JWT
  middleware.js      # kiểm tra đăng nhập / quyền admin
  routes/auth.js     # đăng ký, OTP, đăng nhập
  routes/bookings.js # tạo chuyến, lịch sử
  routes/admin.js    # duyệt tài khoản, xem tất cả đơn
  saycar/client.js   # <<< NỐI VÀO SAYCAR (chỗ cần sửa khi có API thật)
public/              # giao diện (index.html, admin.html)
```

## Bảo mật
- Mật khẩu lưu dạng **hash bcrypt**.
- Phiên đăng nhập bằng **JWT** ký bằng `JWT_SECRET`.
- Token/mật khẩu saycar **chỉ ở server**, không bao giờ gửi xuống trình duyệt cộng tác viên.
- Tài khoản mới phải **được admin duyệt** mới đặt được chuyến.
