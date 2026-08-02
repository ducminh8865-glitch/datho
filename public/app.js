// ===== Tiện ích =====
const $ = (id) => document.getElementById(id);
let TOKEN = localStorage.getItem('token') || '';

// địa điểm đã chọn (kèm place_id của saycar)
const sel = { pickup: { placeId: '', text: '' }, dropoff: { placeId: '', text: '' } };

function show(view) {
  ['install', 'login', 'register', 'app'].forEach((v) => {
    $('view-' + v).classList.toggle('hidden', v !== view);
  });
}

// ===== PWA: cài ra màn hình =====
// Đang chạy dạng app đã cài (mở từ icon màn hình)?
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = $('install-btn');
  if (btn) {
    btn.classList.remove('hidden');
    btn.onclick = async () => {
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === 'accepted') btn.textContent = '✅ Đang cài...';
      deferredInstall = null;
    };
  }
});
// Cài xong -> vào thẳng app
window.addEventListener('appinstalled', () => { localStorage.setItem('installed', '1'); enterOrAuth(); });

function showInstallGuide() {
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (/(Mac)/.test(ua) && 'ontouchend' in document);
  const isAndroid = /android/i.test(ua);
  // Hiện hướng dẫn phù hợp; máy tính thì hiện cả hai để tham khảo
  $('guide-ios').classList.toggle('hidden', !(isIOS || (!isIOS && !isAndroid)));
  $('guide-android').classList.toggle('hidden', !(isAndroid || (!isIOS && !isAndroid)));
  show('install');
}
function skipInstall() {
  localStorage.setItem('skipInstall', '1');
  enterOrAuth();
}
// Quyết định màn hình khi khởi động (khi CHƯA đăng nhập)
function routeStart() {
  const forceApp = new URLSearchParams(location.search).get('app') === '1';
  if (isStandalone() || forceApp || localStorage.getItem('skipInstall') === '1' || localStorage.getItem('installed') === '1') {
    show('login');
  } else {
    showInstallGuide();
  }
}
function msg(el, text, type) {
  const m = $(el);
  m.textContent = text;
  m.className = 'msg show ' + (type || 'err');
}
function clearMsg(el) { $(el).className = 'msg'; }
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';

// Hộp xác nhận đẹp (thay cho confirm() mặc định). Trả về Promise<boolean>.
function uiConfirm({ title = 'Xác nhận', message = '', html = '', okText = 'Đồng ý', cancelText = 'Huỷ', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      `<div class="modal" role="dialog" aria-modal="true">
         <div class="modal-title">${esc(title)}</div>
         <div class="modal-body">${html || esc(message)}</div>
         <div class="modal-actions">
           <button class="btn secondary modal-cancel">${esc(cancelText)}</button>
           <button class="btn ${danger ? 'danger' : ''} modal-ok">${esc(okText)}</button>
         </div>
       </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { document.removeEventListener('keydown', onKey); overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 180); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
    overlay.querySelector('.modal-cancel').onclick = () => done(false);
    overlay.querySelector('.modal-ok').onclick = () => done(true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => { overlay.classList.add('show'); overlay.querySelector('.modal-ok').focus(); });
  });
}

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
    code: $('reg-code').value.trim(),
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
  $('b-cphone').addEventListener('blur', checkCustomer);
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

// ===== Cảnh báo khách sẵn có trên saycar =====
let custIsExisting = false;
async function checkCustomer() {
  const warn = $('cust-warn');
  const phone = $('b-cphone').value.replace(/[\s.\-()]/g, '');
  custIsExisting = false;
  if (!/^(0\d{9}|\+84\d{9}|84\d{9})$/.test(phone)) { warn.classList.add('hidden'); return; }
  try {
    const r = await api('/bookings/check-customer', 'POST', { phone }, true);
    if (r.ok && r.data.existing) {
      custIsExisting = true;
      warn.innerHTML = `⚠️ <b>Khách hàng này đã có trong hệ thống SayCar.</b> Vui lòng báo khách <b>đặt trực tiếp trên APP SayCar</b>. Nếu đặt qua hệ thống này, bạn <b>chỉ được tính hoa hồng ${r.data.commissionPercent}%</b>.`;
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  } catch { warn.classList.add('hidden'); }
}

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
  const phoneNorm = phone.replace(/[\s.\-()]/g, '');
  if (!/^(0\d{9}|\+84\d{9}|84\d{9})$/.test(phoneNorm)) return msg('b-msg', 'Số điện thoại khách chưa đúng (cần 10 số, VD 09xxxxxxxx)');
  if (!sel.pickup.placeId || !sel.dropoff.placeId) return msg('b-msg', 'Hãy chọn lại điểm đón/đến rồi Tính giá');

  const totalTxt = ($('b-price').querySelector('.total') || {}).textContent || '';
  const existingNote = custIsExisting
    ? `<div class="modal-warn">⚠️ Khách này đã có trên SayCar — nên báo khách tự đặt trên APP. Đặt qua đây chỉ được hoa hồng thấp (5%).</div>`
    : '';
  const ok = await uiConfirm({
    title: 'Xác nhận đặt chuyến',
    html:
      `<div class="modal-route">
         <div class="leg from"><span class="pin"></span><span>${esc(sel.pickup.text)}</span></div>
         <div class="leg to"><span class="pin"></span><span>${esc(sel.dropoff.text)}</span></div>
       </div>
       ${totalTxt ? `<div class="modal-total">${esc(totalTxt)}</div>` : ''}
       ${existingNote}
       <div class="modal-note">Hệ thống sẽ tạo chuyến <b>thật</b> và gán tài xế ngay.</div>`,
    okText: 'Đặt chuyến',
  });
  if (!ok) return;

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
  const note = s.existingCustomer ? ' · Khách sẵn có (hoa hồng 5%)' : '';
  msg('b-msg', `Đặt chuyến thành công!${s.totalAmount ? ' · ' + vnd(s.totalAmount) : ''}${drv}${note}`, 'ok');
  // reset form
  ['b-pickup', 'b-dropoff', 'b-cname', 'b-cphone'].forEach((i) => ($(i).value = ''));
  custIsExisting = false; $('cust-warn').classList.add('hidden');
  sel.pickup = { placeId: '', text: '' };
  sel.dropoff = { placeId: '', text: '' };
  invalidatePrice();
  histPage = 1;
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

// Rút gọn lỗi saycar thành câu dễ hiểu cho cộng tác viên
function friendlyError(raw) {
  const s = String(raw || '');
  if (/USER_DUPLICATE_BOOKING|đang trong chuyến/i.test(s)) return 'Khách đang có chuyến chưa hoàn thành — không đặt thêm được. Đợi xong (hoặc huỷ) rồi đặt lại.';
  if (/sai định dạng|INVALID.*PHONE|user\/detail|phoneNumber/i.test(s)) return 'Số điện thoại khách không hợp lệ.';
  if (/NO_PERMISSION|API key/i.test(s)) return 'Lỗi kết nối hệ thống, thử lại sau.';
  // cắt bỏ phần JSON kỹ thuật nếu có
  const m = s.match(/"message":"([^"]+)"/);
  if (m) return m[1];
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

async function loadEarnings() {
  const r = await api('/bookings/earnings', 'GET', null, true);
  if (!r.ok) return;
  const d = r.data;
  $('earn-total').textContent = vnd(d.balance);
  const parts = [`${d.completedCount} chuyến hoàn thành`];
  if (d.withdrawnPaid) parts.push(`đã rút ${vnd(d.withdrawnPaid)}`);
  if (d.withdrawPending) parts.push(`chờ duyệt rút ${vnd(d.withdrawPending)}`);
  if (d.activeCount) parts.push(`đang chạy ${d.activeCount} · dự kiến +${vnd(d.pending)}`);
  parts.push(`hoa hồng ${d.percent}%`);
  $('earn-sub').textContent = parts.join(' · ');
}

// ===== Rút tiền =====
let WD = { bank: {}, balance: null };

const WD_STATUS = {
  pending: { cls: 'pending', label: 'Chờ duyệt' },
  paid: { cls: 'success', label: 'Đã chuyển khoản' },
  rejected: { cls: 'failed', label: 'Từ chối' },
};

function toggleWithdraw() {
  const card = $('withdraw-card');
  const open = card.classList.contains('hidden');
  card.classList.toggle('hidden', !open);
  if (open) {
    clearMsg('wd-msg');
    loadWithdrawals().then(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

async function loadWithdrawals() {
  const r = await api('/withdrawals', 'GET', null, true);
  if (!r.ok) return;
  WD = r.data;
  const hasBank = !!(WD.bank.bankName && WD.bank.accountNumber && WD.bank.accountName);
  $('wd-available').textContent = vnd(WD.balance.available);
  $('wd-bank-view').classList.toggle('hidden', !hasBank);
  $('wd-request').classList.toggle('hidden', !hasBank);
  $('wd-bank-form').classList.toggle('hidden', hasBank);
  if (hasBank) {
    $('wd-bank-summary').innerHTML = `<b>${esc(WD.bank.bankName)}</b> · ${esc(WD.bank.accountNumber)}`;
    $('wd-bank-owner').textContent = WD.bank.accountName;
  }
  const box = $('wd-history');
  if (!WD.rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<label style="margin-top:18px">Lịch sử rút tiền</label>' + WD.rows.map((w) => {
    const st = WD_STATUS[w.status] || { cls: 'pending', label: w.status };
    return `<div class="hist-item">
      <div class="top"><span class="pill ${st.cls}">${st.label}</span><span class="meta">${esc(w.created_at)}</span></div>
      <div style="font-size:18px;font-weight:800">${vnd(w.amount)}</div>
      <div class="sub">${esc(w.bank_name)} · ${esc(w.bank_account_number)} · ${esc(w.bank_account_name)}</div>
    </div>`;
  }).join('');
}

function editBank() {
  $('wd-bank-name').value = WD.bank.bankName || '';
  $('wd-acc-num').value = WD.bank.accountNumber || '';
  $('wd-acc-name').value = WD.bank.accountName || '';
  $('wd-bank-form').classList.remove('hidden');
  $('wd-bank-view').classList.add('hidden');
  $('wd-request').classList.add('hidden');
}

async function saveBank() {
  clearMsg('wd-msg');
  const body = {
    bankName: $('wd-bank-name').value.trim(),
    accountNumber: $('wd-acc-num').value.trim(),
    accountName: $('wd-acc-name').value.trim(),
  };
  if (!body.bankName || !body.accountNumber || !body.accountName) {
    return msg('wd-msg', 'Nhập đủ ngân hàng, số tài khoản và tên chủ tài khoản');
  }
  const btn = $('wd-bank-save');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const r = await api('/withdrawals/bank', 'POST', body, true);
  btn.disabled = false; btn.textContent = 'Lưu thông tin nhận tiền';
  if (!r.ok) return msg('wd-msg', r.data.error || 'Không lưu được thông tin');
  msg('wd-msg', 'Đã lưu thông tin nhận tiền', 'ok');
  await loadWithdrawals();
}

function setMaxWithdraw() {
  if (WD.balance) $('wd-amount').value = WD.balance.available;
}

async function requestWithdraw() {
  clearMsg('wd-msg');
  const amount = Math.round(Number($('wd-amount').value) || 0);
  if (amount < 1000) return msg('wd-msg', 'Nhập số tiền muốn rút (tối thiểu 1.000 đ)');
  if (WD.balance && amount > WD.balance.available) {
    return msg('wd-msg', `Chỉ có thể rút tối đa ${vnd(WD.balance.available)}`);
  }
  const ok = await uiConfirm({
    title: 'Xác nhận rút tiền',
    html:
      `<div class="modal-total">${vnd(amount)}</div>
       <div class="modal-note">Chuyển về <b>${esc(WD.bank.bankName)}</b><br>${esc(WD.bank.accountNumber)} · ${esc(WD.bank.accountName)}</div>`,
    okText: 'Gửi yêu cầu',
  });
  if (!ok) return;
  const btn = $('wd-submit');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  const r = await api('/withdrawals', 'POST', { amount }, true);
  btn.disabled = false; btn.textContent = 'Gửi yêu cầu rút tiền';
  if (!r.ok) return msg('wd-msg', r.data.error || 'Không gửi được yêu cầu');
  $('wd-amount').value = '';
  msg('wd-msg', `Đã gửi yêu cầu rút ${vnd(amount)}. Quản trị viên sẽ chuyển khoản rồi xác nhận.`, 'ok');
  await loadWithdrawals();
  loadEarnings();
}

// Phân trang lịch sử: 5 chuyến / trang
let histRows = [];
let histPage = 1;
const HIST_PER_PAGE = 5;

async function loadHistory() {
  loadEarnings();
  if (!$('withdraw-card').classList.contains('hidden')) loadWithdrawals();
  const r = await api('/bookings/mine', 'GET', null, true);
  histRows = (r.ok && r.data) || [];
  renderHistory();
}

function histItemHtml(b) {
  const p = b.payload || {};
  const pill = tripPill(b);
  const meta = [p.total ? vnd(p.total) : '', b.shortCode ? '#' + esc(b.shortCode) : ''].filter(Boolean).join(' · ');
  const driver = p.driverName ? `<div class="sub">Tài xế: <b>${esc(p.driverName)}</b></div>` : '';
  const comm = b.cancelled ? ''
    : (b.earned
      ? `<div class="comm earned">Hoa hồng: +${vnd(b.commission)}</div>`
      : `<div class="comm">Hoa hồng (dự kiến): +${vnd(b.commission)}</div>`);
  // Huỷ được: đã đẩy saycar thành công, chưa kết thúc, và còn trong 10 giây đầu
  const canCancel = b.status === 'success' && !b.earned && !b.cancelled && b.cancelSecondsLeft > 0;
  const cancelBlock = canCancel
    ? `<div class="hist-actions" data-cancel-deadline="${Date.now() + b.cancelSecondsLeft * 1000}">
         <span class="cancel-count">${b.cancelSecondsLeft}s</span>
         <button class="btn secondary sm hist-cancel" onclick="cancelTrip(${b.id})">Huỷ chuyến</button>
       </div>`
    : '';
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
    ${b.error ? `<div class="err">${esc(friendlyError(b.error))}</div>` : ''}
    ${cancelBlock}
  </div>`;
}

function renderHistory() {
  const box = $('history');
  if (!histRows.length) { box.innerHTML = '<p class="muted">Chưa có chuyến nào.</p>'; return; }
  const pages = Math.ceil(histRows.length / HIST_PER_PAGE);
  if (histPage > pages) histPage = pages;
  if (histPage < 1) histPage = 1;
  const start = (histPage - 1) * HIST_PER_PAGE;
  const items = histRows.slice(start, start + HIST_PER_PAGE).map(histItemHtml).join('');
  const pager = pages > 1
    ? `<div class="pager">
         <button class="pg-btn" ${histPage === 1 ? 'disabled' : ''} onclick="gotoHistPage(${histPage - 1})">‹</button>
         <span class="pg-info">Trang ${histPage}/${pages}</span>
         <button class="pg-btn" ${histPage === pages ? 'disabled' : ''} onclick="gotoHistPage(${histPage + 1})">›</button>
       </div>`
    : '';
  box.innerHTML = items + pager;
  startCancelCountdown();
}

function gotoHistPage(n) {
  histPage = n;
  renderHistory();
  $('history').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Đếm ngược nút huỷ: cập nhật mỗi 0.5s, hết giờ thì bỏ nút
let cancelTicker = null;
function startCancelCountdown() {
  if (cancelTicker) return;
  cancelTicker = setInterval(() => {
    const els = document.querySelectorAll('.hist-actions[data-cancel-deadline]');
    if (!els.length) return;
    const now = Date.now();
    els.forEach((el) => {
      const left = Math.ceil((Number(el.getAttribute('data-cancel-deadline')) - now) / 1000);
      if (left <= 0) { el.remove(); return; }
      const c = el.querySelector('.cancel-count');
      if (c) c.textContent = left + 's';
    });
  }, 500);
}

async function cancelTrip(id) {
  const ok = await uiConfirm({
    title: 'Huỷ chuyến',
    html: '<div class="modal-note">Huỷ chuyến này? Hệ thống sẽ <b>huỷ luôn trên saycar</b> và không hoàn tác được.</div>',
    okText: 'Huỷ chuyến',
    cancelText: 'Không',
    danger: true,
  });
  if (!ok) return;
  const r = await api('/bookings/' + id + '/cancel', 'POST', null, true);
  if (!r.ok) return alert((r.data && r.data.error) || 'Huỷ chuyến thất bại');
  await loadHistory();
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
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
async function enterOrAuth() {
  if (TOKEN) {
    const me = await api('/auth/me', 'GET', null, true);
    if (me.ok) return enterApp();
    TOKEN = ''; localStorage.removeItem('token');
  }
  show('login');
}
(async function init() {
  registerSW();
  if (TOKEN) {
    const me = await api('/auth/me', 'GET', null, true);
    if (me.ok) return enterApp();
    TOKEN = ''; localStorage.removeItem('token');
  }
  routeStart();
})();
