# Kế hoạch: Web app Đặt hộ / Lái hộ (kết nối admin saycar.vn)

_Cập nhật: 2026-07-17_

## Mục tiêu
Một web app cho **cộng tác viên / tài xế** đặt chuyến hộ khách hàng.
Đơn đặt tự động được đẩy vào hệ thống admin hiện có tại https://admin.saycar.vn/booking.

## Quyết định thiết kế (có thể chỉnh)

### 1. Cách kết nối vào admin saycar
- App dùng **1 tài khoản saycar "dịch vụ"** duy nhất để đẩy mọi đơn vào admin.
- Token saycar **chỉ nằm ở server**, không bao giờ gửi xuống trình duyệt cộng tác viên.
- Mỗi đơn ghi rõ **cộng tác viên nào tạo** (lưu trong DB app; nhét tên/ghi chú vào đơn saycar nếu có field).

### 2. Tài khoản cộng tác viên (dùng app này, KHÔNG phải tài khoản saycar)
- Đăng ký bằng **email + mã OTP gửi qua email** (miễn phí).
- Tài khoản mới cần **chủ (bạn) duyệt** trước khi dùng — chống người lạ đăng ký spam đơn.
- Gửi email OTP: **Gmail SMTP** (miễn phí) — dùng "Mật khẩu ứng dụng" của 1 Gmail.

### 3. Công nghệ
- **Server:** Node.js + Express
- **Database:** SQLite (miễn phí, không cần cài server DB)
- **Giao diện:** HTML + CSS + JS thuần, tối ưu cho điện thoại
- **Gửi email:** nodemailer + Gmail SMTP
- **Phiên đăng nhập:** cookie/JWT ký ở server
- **Deploy:** chạy máy local trước, sau đưa lên host miễn phí (Render / Railway)

## Bảo mật — nguyên tắc bất di bất dịch
- Token/mật khẩu saycar **chỉ ở server**, không lộ ra client.
- Mật khẩu cộng tác viên lưu dạng **hash** (bcrypt), không lưu thô.
- Mọi request tạo đơn đều qua server trung gian; client không gọi thẳng saycar.

## Địa điểm & Giá (điểm mấu chốt)
Form saycar: điểm đón/đến là **ô gõ ra gợi ý** (kèm toạ độ), giá có **nút "Tính giá"**.
→ Giải pháp: app **gọi thẳng API của saycar** cho cả 3 việc, để luôn khớp tuyệt đối:
- Gợi ý địa chỉ (autocomplete) → lấy toạ độ giống admin.
- Tính giá (fare) → hiện đúng số tiền saycar tính, không lệch.
- Tạo chuyến → gửi kèm toạ độ + giá.
→ Ưu điểm: KHÔNG cần mua Google Maps API; địa điểm/giá do saycar quyết định.

## Đang chờ
- [ ] File **HAR** ghi lại đủ luồng saycar, gồm 4 request:
  1. Đăng nhập
  2. Gợi ý địa chỉ (gõ điểm đón/đến rồi chọn)
  3. Tính giá (bấm nút "Tính giá")
  4. Tạo chuyến
  → Đặt tại thư mục dự án này, tên `saycar.har`.

## Cần xác nhận từ chủ
- [ ] Saycar khi đăng nhập có **captcha / OTP** không? (ảnh hưởng cách app tự đăng nhập tài khoản dịch vụ)
- [ ] Đăng nhập saycar bằng **số điện thoại / email / username**?
- [ ] Đồng ý phương án "1 tài khoản dịch vụ" hay muốn "mỗi người 1 tài khoản saycar"?
