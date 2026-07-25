const TOKEN = localStorage.getItem('token') || '';
const $ = (id) => document.getElementById(id);

async function api(path, method, body) {
  const headers = { Authorization: 'Bearer ' + TOKEN };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
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

async function loadStats() {
  const r = await api('/admin/stats');
  if (!r.ok) return;
  const o = r.data.overall || {};
  const box = $('stats');
  const tile = (n, l) => `<div class="stat-tile"><div class="stat-num">${n || 0}</div><div class="stat-lbl">${l}</div></div>`;
  const tiles = `<div class="stat-row">${tile(o.today, 'Hôm nay')}${tile(o.month, 'Tháng này')}${tile(o.year, 'Năm nay')}${tile(o.total, 'Tổng cộng')}</div>`;
  const rows = r.data.byUser || [];
  const table = rows.length
    ? `<div class="stat-tbl-title">Số chuyến theo từng người</div>
       <div class="stat-scroll"><table class="stat-table">
         <thead><tr><th>Người đặt</th><th>Hôm nay</th><th>Tháng</th><th>Năm</th><th>Tổng</th></tr></thead>
         <tbody>${rows.map((u) => `<tr>
           <td class="who">${esc(u.name && u.name !== u.phone ? u.name + ' · ' + u.phone : u.phone)}</td>
           <td>${u.today}</td><td>${u.month}</td><td>${u.year}</td><td><b>${u.total}</b></td>
         </tr>`).join('')}</tbody>
       </table></div>`
    : '<p class="muted" style="margin-top:12px">Chưa có chuyến nào.</p>';
  box.innerHTML = tiles + table;
}

async function loadCommissions() {
  const r = await api('/admin/commissions');
  if (!r.ok) return;
  const box = $('commissions');
  if (!r.data.rows.length) { box.innerHTML = '<p class="muted">Chưa có hoa hồng (chưa có chuyến nào hoàn thành).</p>'; return; }
  const total = r.data.rows.reduce((s, x) => s + x.remaining, 0);
  box.innerHTML =
    `<p class="muted" style="margin:0 0 12px">Mức ${r.data.percent}% · Còn phải trả: <b style="color:#166534;font-size:16px">${vnd(total)}</b></p>` +
    r.data.rows.map((x) => `<div class="hist-item">
      <div class="top">
        <b>${esc(x.name && x.name !== x.phone ? x.name + ' · ' + x.phone : x.phone)}</b>
        <span class="comm earned" style="margin:0">${vnd(x.remaining)}</span>
      </div>
      <div class="sub">${x.completed} chuyến hoàn thành · hoa hồng ${vnd(x.commission)}${x.withdrawn ? ' · đã CK ' + vnd(x.withdrawn) : ''}</div>
    </div>`).join('');
}

// ===== Yêu cầu rút tiền =====
const WD_STATUS = {
  pending: { cls: 'pending', label: 'Chờ CK' },
  paid: { cls: 'success', label: 'Đã CK' },
  rejected: { cls: 'failed', label: 'Từ chối' },
};

async function loadWithdrawals() {
  const r = await api('/admin/withdrawals');
  if (!r.ok) return;
  const box = $('withdrawals');
  if (!r.data.length) { box.innerHTML = '<p class="muted">Chưa có yêu cầu rút tiền.</p>'; return; }
  const waiting = r.data.filter((w) => w.status === 'pending').reduce((s, w) => s + w.amount, 0);
  box.innerHTML =
    (waiting ? `<p class="muted" style="margin:0 0 12px">Đang chờ chuyển: <b style="color:#b45309;font-size:16px">${vnd(waiting)}</b></p>` : '') +
    r.data.map((w) => {
      const st = WD_STATUS[w.status] || { cls: 'pending', label: w.status };
      const who = w.user_name && w.user_name !== w.user_phone ? `${w.user_name} · ${w.user_phone}` : w.user_phone;
      const actions = w.status === 'pending'
        ? `<div style="margin-top:10px;display:flex;gap:8px">
             <button class="btn sm" onclick="wdAct(${w.id},'paid')">✅ Đã chuyển khoản</button>
             <button class="btn secondary sm" onclick="wdAct(${w.id},'reject')">Từ chối</button>
           </div>`
        : '';
      return `<div class="hist-item">
        <div class="top"><span class="pill ${st.cls}">${st.label}</span><span class="meta">${esc(w.created_at)}</span></div>
        <div style="font-size:20px;font-weight:800">${vnd(w.amount)}</div>
        <div class="sub">Người rút: <b>${esc(who)}</b></div>
        <div class="sub"><b>${esc(w.bank_name)}</b> · ${esc(w.bank_account_number)} · ${esc(w.bank_account_name)}</div>
        ${actions}
      </div>`;
    }).join('');
}

async function wdAct(id, action) {
  const q = action === 'paid'
    ? 'Xác nhận ĐÃ chuyển khoản cho yêu cầu này?\nSố dư của cộng tác viên sẽ bị trừ tương ứng.'
    : 'Từ chối yêu cầu rút tiền này?\nSố tiền sẽ quay lại số dư của cộng tác viên.';
  if (!confirm(q)) return;
  const r = await api('/admin/withdrawals/' + id + '/' + action, 'POST');
  if (!r.ok) alert(r.data.error || 'Lỗi');
  loadWithdrawals();
  loadCommissions();
}

// ===== Mã mời đăng ký =====
async function loadInvites() {
  const r = await api('/admin/invites');
  if (!r.ok) return;
  const box = $('invites');
  const env = r.data.envCode
    ? `<div class="hist-item">
        <div class="top"><b class="inv-code">${esc(r.data.envCode)}</b><span class="pill success">Mã hệ thống</span></div>
        <div class="sub">Cấu hình trong .env (REGISTER_CODE) · không giới hạn lượt · muốn đổi/xoá thì sửa .env trên máy chủ</div>
      </div>`
    : '';
  if (!r.data.rows.length && !env) {
    box.innerHTML = '<p class="muted">Chưa có mã nào — đăng ký đang <b>mở tự do</b>. Tạo mã đầu tiên để khoá lại.</p>';
    return;
  }
  box.innerHTML = env + r.data.rows.map((c) => {
    const out = c.max_uses != null && c.used_count >= c.max_uses;
    const pill = c.status !== 'active'
      ? '<span class="pill failed">Đã tắt</span>'
      : out ? '<span class="pill pending">Hết lượt</span>' : '<span class="pill success">Đang hoạt động</span>';
    const usage = `Đã dùng ${c.used_count}${c.max_uses != null ? '/' + c.max_uses : ' (không giới hạn)'}`;
    const usedBy = c.usedBy.length ? `<div class="sub">Người đăng ký: <b>${c.usedBy.map(esc).join(', ')}</b></div>` : '';
    return `<div class="hist-item">
      <div class="top"><b class="inv-code" title="Bấm để copy" onclick="copyInvite(this, '${esc(c.code)}')">${esc(c.code)} ⧉</b>${pill}</div>
      <div class="sub">${usage} · tạo lúc ${esc(c.created_at)}</div>
      ${usedBy}
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn secondary sm" onclick="invToggle(${c.id})">${c.status === 'active' ? 'Tắt' : 'Bật lại'}</button>
        <button class="btn secondary sm" style="color:#dc2626;border-color:#fecaca" onclick="invDelete(${c.id})">Xoá</button>
      </div>
    </div>`;
  }).join('');
}

async function createInvite() {
  const btn = $('inv-create');
  btn.disabled = true;
  const r = await api('/admin/invites', 'POST', {
    code: $('inv-code').value.trim(),
    maxUses: $('inv-max').value.trim() || null,
  });
  btn.disabled = false;
  if (!r.ok) return alert(r.data.error || 'Không tạo được mã');
  $('inv-code').value = ''; $('inv-max').value = '';
  loadInvites();
}

function copyInvite(el, code) {
  const done = () => { el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 900); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done));
  } else fallbackCopy(code, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  document.body.removeChild(ta);
}

async function invToggle(id) {
  const r = await api('/admin/invites/' + id + '/toggle', 'POST');
  if (!r.ok) alert(r.data.error || 'Lỗi');
  loadInvites();
}
async function invDelete(id) {
  if (!confirm('Xoá mã này? Người đã đăng ký bằng mã không bị ảnh hưởng.')) return;
  const r = await api('/admin/invites/' + id, 'DELETE');
  if (!r.ok) alert(r.data.error || 'Lỗi');
  loadInvites();
}

// ===== Tài xế saycar (bản sao local) =====
async function loadDriverStatus() {
  const r = await api('/admin/drivers/status');
  if (!r.ok) return;
  const d = r.data;
  const el = $('drv-status');
  if (!d.total) {
    el.textContent = d.last && d.last.reason === 'mock'
      ? 'Chế độ giả lập — không đồng bộ.'
      : (d.last && d.last.error ? 'Lỗi đồng bộ: ' + d.last.error : 'Chưa có dữ liệu — bấm Đồng bộ ngay.');
    return;
  }
  el.textContent = `${d.total} tài xế · ${d.verified} đã xác thực · lần cuối ${d.syncedAt || '—'}`;
}

async function syncDrivers() {
  const btn = $('drv-sync');
  btn.disabled = true; btn.textContent = 'Đang đồng bộ...';
  const r = await api('/admin/drivers/sync', 'POST');
  btn.disabled = false; btn.textContent = 'Đồng bộ ngay';
  if (!r.ok) alert((r.data && r.data.error) || 'Lỗi đồng bộ');
  else if (r.data.result && r.data.result.error) alert('Đồng bộ lỗi: ' + r.data.result.error);
  loadDriverStatus();
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
      ${u.referrer_driver_phone
        ? `<div class="sub">🚗 Tài xế giới thiệu: <b>${esc((u.referrer_driver_name || '').trim())} ${esc(u.referrer_driver_phone)}</b></div>`
        : (u.invite_code === 'TÀI XẾ SAYCAR'
          ? `<div class="sub">🚗 <b>Là tài xế SayCar</b></div>`
          : (u.invite_code ? `<div class="sub">Vào bằng: <b>mã ${esc(u.invite_code)}</b></div>` : ''))}
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
  if (ok) { loadStats(); loadWithdrawals(); loadCommissions(); loadInvites(); loadDriverStatus(); loadBookings(); }
})();
