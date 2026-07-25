const config = require('../config');

// =====================================================================
//  MODULE KẾT NỐI SAYCAR (gọi API thật tại https://api.saycar.vn)
//  Luồng: login -> autocomplete -> place detail (toạ độ) -> preview (giá)
//         -> tra khách -> tạo chuyến.
// =====================================================================

const VEHICLE_TYPES = [
  { value: 'CAR', label: 'Ô tô' },
  { value: 'BIKE', label: 'Xe máy' },
];

const PAYMENT_METHODS = [
  { value: 'TRANSFER', label: 'Chuyển khoản' },
  { value: 'CASH', label: 'Tiền mặt' },
];

// Trạng thái chuyến của saycar -> nhãn tiếng Việt
const STATUS_LABELS = {
  pending: 'Đang tìm tài xế',
  accepted: 'Tài xế đã nhận',
  'in-progress': 'Đã đón khách / đang chạy',
  completed: 'Hoàn thành',
  canceled: 'Đã huỷ',
  cancelled: 'Đã huỷ',
  rejected: 'Tài xế từ chối',
  expired: 'Hết hạn (không có tài xế)',
};
const TERMINAL_STATUSES = new Set(['completed', 'canceled', 'cancelled', 'rejected', 'expired']);

function normStatus(s) {
  return String(s || '').toLowerCase().replace(/_/g, '-');
}
function statusLabel(s) {
  return STATUS_LABELS[normStatus(s)] || s || 'Chưa rõ';
}
function isTerminal(s) {
  return TERMINAL_STATUSES.has(normStatus(s));
}

function baseHeaders(token) {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'x-udtl-client-secret': config.saycar.clientSecret,
    Referer: config.saycar.referer,
    Origin: config.saycar.origin,
    'User-Agent': config.saycar.userAgent,
  };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function login(force) {
  if (config.saycar.mock) return 'mock-token';
  if (!force && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const url = config.saycar.baseUrl + config.saycar.loginPath;
  const res = await fetch(url, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ username: config.saycar.username, password: config.saycar.password }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok || !data.token) {
    throw new Error('Đăng nhập saycar thất bại (HTTP ' + res.status + '): ' + text.slice(0, 300));
  }
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 50 * 60 * 1000; // token ~1h, làm mới sớm
  return cachedToken;
}

async function authedFetch(path, { method = 'GET', body } = {}) {
  const doFetch = (tok) =>
    fetch(config.saycar.baseUrl + path, {
      method,
      headers: baseHeaders(tok),
      body: body ? JSON.stringify(body) : undefined,
    });

  let token = await login();
  let res = await doFetch(token);
  if (res.status === 401 || res.status === 403) {
    token = await login(true); // token hết hạn -> đăng nhập lại rồi thử lại
    res = await doFetch(token);
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error('saycar ' + path + ' lỗi HTTP ' + res.status + ': ' + detail);
  }
  return data;
}

// --- Gợi ý địa chỉ ---
async function autocomplete(input) {
  if (config.saycar.mock) {
    return [{ description: '(mock) ' + input, place_id: 'mock-' + encodeURIComponent(input) }];
  }
  const data = await authedFetch('/api/admin/place/auto-complete', { method: 'POST', body: { input } });
  const preds = (data && data.predictions) || [];
  return preds.map((p) => ({
    description: p.description,
    place_id: p.place_id,
    main: p.structured_formatting && p.structured_formatting.main_text,
    secondary: p.structured_formatting && p.structured_formatting.secondary_text,
  }));
}

// --- Chi tiết địa điểm (toạ độ) ---
async function placeDetail(placeId) {
  if (config.saycar.mock) {
    return { placeId, address: '(mock) địa chỉ', coords: '21.0,105.8', lat: 21.0, lng: 105.8 };
  }
  const data = await authedFetch('/api/place/detail', { method: 'POST', body: { placeId } });
  const r = data && data.result;
  if (!r || !r.geometry || !r.geometry.location) throw new Error('Không lấy được toạ độ của địa điểm');
  const { lat, lng } = r.geometry.location;
  return { placeId, address: r.formatted_address, coords: lat + ',' + lng, lat, lng };
}

// --- Tính giá (preview) ---
async function preview({ fromPlaceId, toPlaceId, vehicle = 'CAR' }) {
  if (config.saycar.mock) {
    const price = { vehicle, distance: 5000, duration: 900, priceBeforeVat: 200000, insurancePrice: 0, vatPrice: 16000, promotionPrice: 0, serviceFee: 8000, totalCustomerPaid: 224000, totalScoin: 0, scoinCanPay: 0, type: 'RIDE' };
    return { price, from: { address: '(mock) điểm đón', coords: '21.0,105.8', placeId: fromPlaceId }, to: { address: '(mock) điểm đến', coords: '21.1,105.9', placeId: toPlaceId }, vehicle };
  }
  const from = await placeDetail(fromPlaceId);
  const to = await placeDetail(toPlaceId);
  const price = await authedFetch('/api/admin/booking/preview', {
    method: 'POST',
    body: {
      destinations: to.coords,
      fromLocation: from.address,
      origins: from.coords,
      toLocation: to.address,
      userUUID: '',
      vehicle,
      firstName: '',
      fromPlaceId,
      toPlaceId,
    },
  });
  return { price, from, to, vehicle };
}

// --- Tra khách theo SĐT ---
async function findCustomer(phone) {
  if (config.saycar.mock) return null;
  const data = await authedFetch('/api/admin/manage/CUSTOMER?phone=' + encodeURIComponent(phone), { method: 'GET' });
  const list = (data && data.data) || [];
  if (!list.length) return null;
  const c = list[0];
  return { userUUID: c.id, name: c.firstName || '', phone: c.phone };
}

// --- Tạo khách "guest" cho khách MỚI (saycar bắt buộc userUUID hợp lệ khi đặt chuyến) ---
// Đây là bước admin saycar dùng: GET /api/admin/user/detail?firstName=&phoneNumber= -> tạo & trả về khách.
async function createGuestCustomer(name, phone) {
  if (config.saycar.mock) return { userUUID: 'mock-uuid', name, phone };
  const q = 'firstName=' + encodeURIComponent(name || phone) + '&phoneNumber=' + encodeURIComponent(phone);
  const data = await authedFetch('/api/admin/user/detail?' + q, { method: 'GET' });
  const list = Array.isArray(data) ? data : (data && data.data) || [];
  const c = list[0];
  return c ? { userUUID: c.id, name: c.firstName || name, phone: c.phone || phone } : null;
}

// --- Tra TÀI XẾ theo SĐT (dùng để miễn mã mời khi đăng ký) ---
// Trả về { name, phone, verified } hoặc null nếu không thấy.
function isDriverVerified(d) {
  // saycar: tài xế được PHÉP NHẬN CHUYẾN (allowOnTrip) = đã xác thực & đang hoạt động.
  // Đây là cờ khớp với danh sách "Tài Xế Đã Xác Thực" trên admin saycar.
  if (d.allowOnTrip === true) return true;
  // Dự phòng nếu saycar đổi cấu trúc dữ liệu sau này
  const truthy = (v) =>
    v === true || v === 1 ||
    ['1', 'true', 'yes', 'verified', 'approved', 'active'].includes(String(v || '').toLowerCase());
  return truthy(d.verified) || truthy(d.isVerified) || truthy(d.isVerify);
}

async function findDriver(phone) {
  // Mock: SĐT kết thúc bằng "99" coi như tài xế đã xác thực (để thử nghiệm)
  if (config.saycar.mock) {
    return String(phone).endsWith('99')
      ? { name: '(mock) Tài xế', phone, verified: true }
      : null;
  }

  // Thử các định dạng số hay gặp: 09xxxxxxxx / +849xxxxxxxx / 849xxxxxxxx
  const variants = [String(phone)];
  if (/^0\d{9}$/.test(phone)) variants.push('+84' + phone.slice(1), '84' + phone.slice(1));
  else if (/^\+84\d{9}$/.test(phone)) variants.push('0' + phone.slice(3), phone.slice(1));
  else if (/^84\d{9}$/.test(phone)) variants.push('0' + phone.slice(2), '+' + phone);

  for (const p of variants) {
    const data = await authedFetch('/api/admin/manage/DRIVER?phone=' + encodeURIComponent(p), { method: 'GET' });
    const list = (data && data.data) || [];
    const d = list.find((x) => x && x.phone) || list[0];
    if (d) {
      // manage/DRIVER = danh sách tài xế ĐÃ XÁC THỰC -> tìm thấy tức là đã xác thực
      return { name: d.firstName || d.name || '', phone: d.phone, verified: true };
    }
  }
  return null;
}

// --- Danh sách tài xế theo trang (dùng cho đồng bộ về DB local) ---
async function listDrivers({ page = 1, size = 100 } = {}) {
  if (config.saycar.mock) return [];
  const data = await authedFetch(`/api/admin/manage/DRIVER?page=${page}&size=${size}`, { method: 'GET' });
  return (data && data.data) || [];
}

// --- Tạo chuyến ---
async function createBooking({ fromPlaceId, toPlaceId, vehicle = 'CAR', customerName, customerPhone, paymentMethod = 'TRANSFER' }) {
  if (config.saycar.mock) {
    return { bookingId: 'MOCK-' + String(Date.now()).slice(-6), totalAmount: 224000, driverName: '(mock) tài xế', statusBooking: 'IN_PROGRESS' };
  }

  // Tính giá lại ở server (không tin giá do client gửi lên) để đảm bảo đúng
  const { price, from, to } = await preview({ fromPlaceId, toPlaceId, vehicle });

  // Tra khách theo SĐT; nếu là khách MỚI -> tạo hồ sơ guest để có userUUID hợp lệ.
  let customer = await findCustomer(customerPhone);
  if (!customer || !customer.userUUID) {
    customer = await createGuestCustomer(customerName, customerPhone);
    if (!customer || !customer.userUUID) throw new Error('Không tạo được hồ sơ khách trên saycar');
  }

  const payload = {
    ...price, // vehicle, distance, duration, các trường giá, type
    destinations: to.coords,
    fromLocation: from.address,
    origins: from.coords,
    toLocation: to.address,
    userUUID: customer.userUUID,
    firstName: customerName || customer.name || '',
    fromPlaceId,
    toPlaceId,
    phoneNumber: customerPhone,
    paymentMethod,
  };

  const res = await authedFetch('/api/admin/booking', { method: 'POST', body: payload });

  // Tìm shortCode (mã chuyến) để sau này tra trạng thái — best-effort
  try {
    if (res && res.bookingId && !res.shortCode) {
      const resolved = await resolveShortCode(res.bookingId);
      if (resolved) res.shortCode = resolved.shortCode;
    }
  } catch {}
  return res;
}

// --- Danh sách đơn (dùng để tra trạng thái) ---
async function listBookings({ shortCode, size = 50 } = {}) {
  if (config.saycar.mock) return [];
  let path = '/api/admin/manage/booking?customerType=CUSTOMER&page=1&size=' + size;
  if (shortCode) path += '&shortCode=' + encodeURIComponent(shortCode);
  const data = await authedFetch(path, { method: 'GET' });
  return (data && data.data) || [];
}

// Tìm shortCode theo bookingId (đơn vừa tạo còn nằm ở trang đầu)
async function resolveShortCode(bookingId) {
  const list = await listBookings({ size: 50 });
  const b = list.find((x) => String(x.bookingId) === String(bookingId));
  return b ? { shortCode: b.shortCode, status: b.statusBooking, driverName: b.driverName, driverPhone: b.driverPhoneNumber } : null;
}

// Tra trạng thái hiện tại theo shortCode (chính xác, không phụ thuộc số lượng đơn)
async function getStatusByShortCode(shortCode) {
  if (!shortCode || config.saycar.mock) return null;
  const list = await listBookings({ shortCode, size: 5 });
  const b = list.find((x) => String(x.shortCode) === String(shortCode)) || list[0];
  if (!b) return null;
  return {
    shortCode: b.shortCode,
    bookingId: b.bookingId,
    status: b.statusBooking,
    statusPayment: b.statusPayment,
    driverName: b.driverName,
    driverPhone: b.driverPhoneNumber,
    paymentAmount: b.paymentAmount,
  };
}

module.exports = {
  login,
  autocomplete,
  placeDetail,
  preview,
  findCustomer,
  createGuestCustomer,
  findDriver,
  listDrivers,
  isDriverVerified,
  createBooking,
  listBookings,
  resolveShortCode,
  getStatusByShortCode,
  statusLabel,
  isTerminal,
  VEHICLE_TYPES,
  PAYMENT_METHODS,
};
