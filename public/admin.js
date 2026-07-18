const TOKEN = localStorage.getItem('token') || '';
const $ = (id) => document.getElementById(id);

async function api(path, method) {
  const res = await fetch('/api' + path, {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + TOKEN },
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';

async function loadCommissions() {
  const r = await api('/admin/commissions');
  if (!r.ok) return;
  const box = $('commissions');
  if (!r.data.rows.length) { box.innerHTML = '<p class="muted">Chưa có hoa hồng (chưa có chuyến nào hoàn thành).</p>'; return; }
  const total = r.data.rows.reduce((s, x) => s + x.commission, 0);
  box.innerHTML =
    `<p class="muted" style="margin:0 0 12px">Mức ${r.data.percent}% · Tổng phải trả: <b style="color:#166534;font-size:16px">${vnd(total)}</b></p>` +
    r.data.rows.map((x) => `<div class="hist-item">
      <div class="top">
        <b>${esc(x.name && x.name !== x.phone ? x.name + ' · ' + x.phone : x.phone)}</b>
        <span class="comm earned" style="margin:0">${vnd(x.commission)}</span>
      </div>
      <div class="sub">${x.completed} chuyến hoàn thành · doanh thu ${vnd(x.gross)}</div>
    </div>`).join('');
}

const STATUS_VI = {
  active: 'Đang hoạt động',
  blocked: 'Đã khóa',
};

async function loadUsers() {
  const r = await api('/admin/users');
  if (!r.ok) { $('users').innerHTML = '<p class="msg show err">Bạn không có quyền quản trị hoặc chưa đăng nhập. <a class="plain" href="/">Đăng nhập lại</a></p>'; return false; }
  if (!r.data.length) { $('users').innerHTML = '<p class="muted">Chưa có tài khoản.</p>'; return true; }
  $('users').innerHTML = r.data.map((u) => {
    const actions = [];
    if (u.status === 'active' && u.role !== 'admin') actions.push(`<button class="btn secondary sm" onclick="act(${u.id},'block')">Khóa</button>`);
    if (u.status === 'blocked') actions.push(`<button class="btn sm" onclick="act(${u.id},'unblock')">Mở khóa</button>`);
    return `<div class="hist-item">
      <div class="top">
        <b>${esc(u.phone)} ${u.role === 'admin' ? '⭐' : ''}</b>
        <span class="pill ${u.status === 'active' ? 'success' : 'failed'}">${STATUS_VI[u.status] || u.status}</span>
      </div>
      ${u.name && u.name !== u.phone ? `<div class="sub">${esc(u.name)}</div>` : ''}
      ${actions.length ? `<div style="margin-top:10px;display:flex;gap:8px">${actions.join('')}</div>` : ''}
    </div>`;
  }).join('');
  return true;
}

async function act(id, action) {
  const r = await api('/admin/users/' + id + '/' + action, 'POST');
  if (!r.ok) alert(r.data.error || 'Lỗi');
  loadUsers();
}

async function loadBookings() {
  const r = await api('/admin/bookings');
  if (!r.ok) return;
  if (!r.data.length) { $('bookings').innerHTML = '<p class="muted">Chưa có đơn nào.</p>'; return; }
  $('bookings').innerHTML = r.data.map((b) => {
    const p = b.payload || {};
    const statusVi = { success: 'Thành công', failed: 'Lỗi', pending: 'Đang xử lý' }[b.status] || b.status;
    const cls = b.status === 'success' ? 'success' : b.status === 'failed' ? 'failed' : 'pending';
    const meta = [p.total ? vnd(p.total) : '', b.shortCode ? '#' + esc(b.shortCode) : ''].filter(Boolean).join(' · ');
    return `<div class="hist-item">
      <div class="top"><span class="pill ${cls}">${statusVi}</span><span class="meta">${meta}</span></div>
      <div class="leg from"><span class="pin"></span><span class="txt">${esc(p.pickup)}</span></div>
      <div class="leg to"><span class="pin"></span><span class="txt">${esc(p.dropoff)}</span></div>
      <div class="sub">Khách: <b>${esc(p.customerName || '-')}</b>${p.customerPhone ? ' · ' + esc(p.customerPhone) : ''}</div>
      <div class="sub">Người đặt: <b>${esc(b.user_phone)}</b>${b.user_name && b.user_name !== b.user_phone ? ' (' + esc(b.user_name) + ')' : ''} · ${esc(b.created_at)}</div>
      ${b.error ? `<div class="err">${esc(b.error)}</div>` : ''}
    </div>`;
  }).join('');
}

(async function () {
  const ok = await loadUsers();
  if (ok) { loadCommissions(); loadBookings(); }
})();
