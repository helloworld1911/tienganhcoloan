// Gọi API + lưu phiên đăng nhập
const KEY = 'engweb.session';
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
  set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

// Thanh tiến trình mảnh ở đầu trang khi đang chờ máy chủ
let pending = 0, barTimer = null;
function busy(d) {
  pending += d;
  let bar = document.getElementById('netbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'netbar'; document.body.appendChild(bar); }
  clearTimeout(barTimer);
  if (pending > 0) barTimer = setTimeout(() => bar.classList.add('on'), 120);
  else { bar.classList.remove('on'); }
}

export async function api(path, opts = {}) {
  busy(1);
  try { return await request(path, opts); } finally { busy(-1); }
}
async function request(path, { method = 'GET', body, raw = false } = {}) {
  const s = session.get();
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(s?.token ? { authorization: 'Bearer ' + s.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) { if (!res.ok) throw new Error('Lỗi ' + res.status); return res; }
  let data = null;
  try { data = await res.json(); } catch { /* bỏ qua */ }
  if (res.status === 401 && s) { session.clear(); location.hash = '#/login'; }
  if (!res.ok) { const err = new Error(data?.error || `Lỗi ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}
export const get = (p) => api(p);
/** Gửi dữ liệu nhị phân (mảnh file nghe) */
export async function upload(path, blob) {
  const s = session.get();
  const res = await fetch('/api' + path, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...(s?.token ? { authorization: 'Bearer ' + s.token } : {}) }, body: blob });
  if (!res.ok) { let m = 'Lỗi ' + res.status; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
  return res.json();
}
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
