// ===== Tiện ích =====
const $ = (id) => document.getElementById(id);
let TOKEN = localStorage.getItem('token') || '';

// địa điểm đã chọn (kèm place_id của saycar)
const sel = { pickup: { placeId: '', text: '' }, dropoff: { placeId: '', text: '' } };

function show(view) {
  ['login', 'register', 'app'].forEach((v) => {
    $('view-' + v).classList.toggle('hidden', v !== view);
  });
}
function msg(el, text, type) {
  const m = $(el);
  m.textContent = text;
  m.className = 'msg show ' + (type || 'err');
}
function clearMsg(el) { $(el).className = 'msg'; }
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';

async function api(path, method, body, useAuth) {
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth && TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch('/api' + path, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

// ===== Đăng ký / Đăng nhập =====
async function doRegister() {
  clearMsg('reg-msg');
  const body = {
    phone: $('reg-phone').value.trim(),
    password: $('reg-pass').value,
    confirmPassword: $('reg-pass2').value,
  };
  if (!body.phone || !body.password) return msg('reg-msg', 'Nhập số điện thoại và mật khẩu');
  if (body.password.length < 6) return msg('reg-msg', 'Mật khẩu tối thiểu 6 ký tự');
  if (body.password !== body.confirmPassword) return msg('reg-msg', 'Mật khẩu xác nhận không khớp');
  const r = await api('/auth/register', 'POST', body);
  if (!r.ok) return msg('reg-msg', r.data.error || 'Đăng ký thất bại');
  setToken(r.data.token);
  await enterApp();
}

async function doLogin() {
  clearMsg('login-msg');
  const phone = $('login-phone').value.trim();
  const password = $('login-pass').value;
  if (!phone || !password) return msg('login-msg', 'Nhập số điện thoại và mật khẩu');
  const r = await api('/auth/login', 'POST', { phone, password });
  if (!r.ok) return msg('login-msg', r.data.error || 'Đăng nhập thất bại');
  setToken(r.data.token);
  await enterApp();
}

function setToken(t) { TOKEN = t; localStorage.setItem('token', t); }
function logout() { TOKEN = ''; localStorage.removeItem('token'); stopHistoryAutoRefresh(); show('login'); }

// ===== Vào app =====
async function enterApp() {
  const me = await api('/auth/me', 'GET', null, true);
  if (!me.ok) return logout();
  $('me-name').textContent = me.data.name;
  $('admin-link').classList.toggle('hidden', me.data.role !== 'admin');
  show('app');
  await loadRefData();
  setupAutocomplete('b-pickup', 'ac-pickup', 'pickup');
  setupAutocomplete('b-dropoff', 'ac-dropoff', 'dropoff');
  $('b-vehicle').addEventListener('change', invalidatePrice);
  await loadHistory();
  startHistoryAutoRefresh();
  refreshNotiBanner();
  if (notiSupported() && Notification.permission === 'granted') ensurePushSubscribed(true);
}

async function loadRefData() {
  const r = await api('/bookings/ref-data', 'GET', null, true);
  const veh = (r.ok && r.data.vehicleTypes) || [{ value: 'CAR', label: 'Ô tô' }];
  const pay = (r.ok && r.data.paymentMethods) || [{ value: 'TRANSFER', label: 'Chuyển khoản' }];
  $('b-vehicle').innerHTML = veh.map((v) => `<option value="${v.value}">${v.label}</option>`).join('');
  $('b-payment').innerHTML = pay.map((v) => `<option value="${v.value}">${v.label}</option>`).join('');
}

// ===== Gợi ý địa chỉ =====
function setupAutocomplete(inputId, listId, key) {
  const input = $(inputId);
  const list = $(listId);
  let timer = null;
  let reqSeq = 0;

  input.addEventListener('input', () => {
    // gõ lại -> huỷ lựa chọn cũ, huỷ giá
    sel[key] = { placeId: '', text: '' };
    invalidatePrice();
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { hideList(list); return; }
    timer = setTimeout(async () => {
      const mySeq = ++reqSeq;
      const r = await api('/bookings/autocomplete', 'POST', { input: q }, true);
      if (mySeq !== reqSeq) return; // đã có request mới hơn
      const preds = (r.ok && r.data.predictions) || [];
      renderList(list, preds, (p) => {
        sel[key] = { placeId: p.place_id, text: p.description };
        input.value = p.description;
        hideList(list);
        invalidatePrice();
      });
    }, 300);
  });

  input.addEventListener('blur', () => setTimeout(() => hideList(list), 200));
}

function renderList(list, preds, onPick) {
  if (!preds.length) {
    list.innerHTML = '<div class="ac-empty">Không có gợi ý</div>';
  } else {
    list.innerHTML = '';
    preds.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'ac-item';
      const main = p.main || p.description;
      const sec = p.secondary || '';
      item.innerHTML = `<div class="main">${esc(main)}</div>${sec ? `<div class="sec">${esc(sec)}</div>` : ''}`;
      item.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(p); });
      list.appendChild(item);
    });
  }
  list.classList.remove('hidden');
}
function hideList(list) { list.classList.add('hidden'); }

// ===== Tính giá =====
function invalidatePrice() {
  $('b-price').classList.add('hidden');
  $('b-submit').classList.add('hidden');
  clearMsg('b-msg');
}

async function doPreview() {
  clearMsg('b-msg');
  if (!sel.pickup.placeId || !sel.dropoff.placeId) {
    return msg('b-msg', 'Hãy chọn điểm đón và điểm đến từ danh sách gợi ý');
  }
  const btn = $('b-preview');
  btn.disabled = true; btn.textContent = 'Đang tính...';
  const r = await api('/bookings/preview', 'POST', {
    fromPlaceId: sel.pickup.placeId,
    toPlaceId: sel.dropoff.placeId,
    vehicle: $('b-vehicle').value,
  }, true);
  btn.disabled = false; btn.textContent = 'Tính lại giá';

  if (!r.ok) return msg('b-msg', r.data.error || 'Không tính được giá', 'err');
  const d = r.data;
  $('b-price').innerHTML =
    `<div class="route">${esc(d.from)} → ${esc(d.to)}</div>
     <div class="total">${vnd(d.total)}</div>
     <div class="brk">Quãng đường ${(d.distance / 1000).toFixed(1)} km · ~${Math.round(d.duration / 60)} phút · đã gồm VAT + phí dịch vụ</div>`;
  $('b-price').classList.remove('hidden');
  $('b-submit').classList.remove('hidden');
}

// ===== Đặt chuyến =====
async function doBooking() {
  clearMsg('b-msg');
  const phone = $('b-cphone').value.trim();
  if (!phone) return msg('b-msg', 'Nhập số điện thoại khách');
  if (!sel.pickup.placeId || !sel.dropoff.placeId) return msg('b-msg', 'Hãy chọn lại điểm đón/đến rồi Tính giá');

  if (!confirm('Xác nhận tạo chuyến thật? Hệ thống sẽ gán tài xế ngay.')) return;

  const btn = $('b-submit');
  btn.disabled = true; btn.textContent = 'Đang đặt...';
  const r = await api('/bookings', 'POST', {
    fromPlaceId: sel.pickup.placeId,
    toPlaceId: sel.dropoff.placeId,
    fromText: sel.pickup.text,
    toText: sel.dropoff.text,
    vehicle: $('b-vehicle').value,
    customerName: $('b-cname').value.trim(),
    customerPhone: phone,
    paymentMethod: $('b-payment').value,
  }, true);
  btn.disabled = false; btn.textContent = 'Xác nhận đặt chuyến';

  if (!r.ok) return msg('b-msg', r.data.error || 'Đặt chuyến thất bại', 'err');
  const s = r.data.saycar || {};
  const drv = s.driverName ? ` · Tài xế: ${s.driverName}` : '';
  msg('b-msg', `Đặt chuyến thành công!${s.totalAmount ? ' · ' + vnd(s.totalAmount) : ''}${drv}`, 'ok');
  // reset form
  ['b-pickup', 'b-dropoff', 'b-cname', 'b-cphone'].forEach((i) => ($(i).value = ''));
  sel.pickup = { placeId: '', text: '' };
  sel.dropoff = { placeId: '', text: '' };
  invalidatePrice();
  await loadHistory();
}

// ===== Lịch sử + trạng thái chuyến =====
function tripPill(b) {
  // Đẩy đơn lỗi
  if (b.status === 'failed') return { cls: 'failed', label: 'Lỗi đẩy đơn' };
  if (b.status !== 'success') return { cls: 'pending', label: 'Đang xử lý' };
  // Đã đẩy thành công -> hiện trạng thái chuyến
  const t = (b.tripStatus || '').toLowerCase().replace(/_/g, '-');
  let cls = 'pending';
  if (t === 'completed') cls = 'success';
  else if (['canceled', 'cancelled', 'rejected', 'expired'].includes(t)) cls = 'failed';
  return { cls, label: b.tripStatusLabel || 'Đã gửi' };
}

async function loadEarnings() {
  const r = await api('/bookings/earnings', 'GET', null, true);
  if (!r.ok) return;
  const d = r.data;
  $('earn-total').textContent = vnd(d.earned);
  const parts = [`${d.completedCount} chuyến hoàn thành`];
  if (d.activeCount) parts.push(`đang chạy ${d.activeCount} · dự kiến +${vnd(d.pending)}`);
  parts.push(`hoa hồng ${d.percent}%`);
  $('earn-sub').textContent = parts.join(' · ');
}

async function loadHistory() {
  loadEarnings();
  const r = await api('/bookings/mine', 'GET', null, true);
  const box = $('history');
  if (!r.ok || !r.data.length) { box.innerHTML = '<p class="muted">Chưa có chuyến nào.</p>'; return; }
  box.innerHTML = r.data.map((b) => {
    const p = b.payload || {};
    const pill = tripPill(b);
    const meta = [p.total ? vnd(p.total) : '', b.shortCode ? '#' + esc(b.shortCode) : ''].filter(Boolean).join(' · ');
    const driver = p.driverName ? `<div class="sub">Tài xế: <b>${esc(p.driverName)}</b></div>` : '';
    const comm = b.cancelled ? ''
      : (b.earned
        ? `<div class="comm earned">Hoa hồng: +${vnd(b.commission)}</div>`
        : `<div class="comm">Hoa hồng (dự kiến): +${vnd(b.commission)}</div>`);
    return `<div class="hist-item">
      <div class="top">
        <span class="pill ${pill.cls}">${esc(pill.label)}</span>
        <span class="meta">${meta}</span>
      </div>
      <div class="leg from"><span class="pin"></span><span class="txt">${esc(p.pickup)}</span></div>
      <div class="leg to"><span class="pin"></span><span class="txt">${esc(p.dropoff)}</span></div>
      <div class="sub">Khách: <b>${esc(p.customerName || '-')}</b>${p.customerPhone ? ' · ' + esc(p.customerPhone) : ''}</div>
      ${driver}
      ${comm}
      ${b.error ? `<div class="err">${esc(b.error)}</div>` : ''}
    </div>`;
  }).join('');
}

// Tự động làm mới trạng thái mỗi 25 giây khi đang ở màn hình app
let histTimer = null;
function startHistoryAutoRefresh() {
  stopHistoryAutoRefresh();
  histTimer = setInterval(() => {
    if (!$('view-app').classList.contains('hidden')) loadHistory();
  }, 10000);
}
function stopHistoryAutoRefresh() {
  if (histTimer) { clearInterval(histTimer); histTimer = null; }
}

// ===== Thông báo đẩy (Web Push) =====
function notiSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}
function refreshNotiBanner() {
  const banner = $('noti-banner');
  if (!banner) return;
  const granted = notiSupported() && Notification.permission === 'granted';
  banner.classList.toggle('hidden', !notiSupported() || granted);
}
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function ensurePushSubscribed(silent) {
  if (!notiSupported()) { if (!silent) alert('Trình duyệt này không hỗ trợ thông báo đẩy.'); return false; }
  let perm = Notification.permission;
  if (perm !== 'granted') {
    if (silent) return false;
    perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Bạn chưa cho phép thông báo.'); return false; }
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const r = await api('/push/vapid-public-key', 'GET', null, true);
    if (!r.ok || !r.data.enabled || !r.data.key) { if (!silent) alert('Máy chủ chưa bật thông báo.'); return false; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(r.data.key) });
    }
    const s = await api('/push/subscribe', 'POST', { subscription: sub }, true);
    refreshNotiBanner();
    if (!silent) alert(s.ok ? 'Đã bật thông báo!' : 'Không lưu được đăng ký thông báo.');
    return s.ok;
  } catch (e) {
    if (!silent) alert('Bật thông báo lỗi: ' + (e.message || e));
    return false;
  }
}
function enableNotifications() { ensurePushSubscribed(false); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!$('view-login').classList.contains('hidden')) doLogin();
  else if (!$('view-register').classList.contains('hidden')) doRegister();
});

// ===== Khởi động =====
(async function init() {
  if (TOKEN) {
    const me = await api('/auth/me', 'GET', null, true);
    if (me.ok) return enterApp();
    logout();
  }
  show('login');
})();
