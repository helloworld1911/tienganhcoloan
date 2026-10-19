// Gọi API + lưu phiên đăng nhập
const KEY = 'engweb.session';
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
  set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

export async function api(path, { method = 'GET', body, raw = false } = {}) {
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
  if (!res.ok) throw new Error(data?.error || `Lỗi ${res.status}`);
  return data;
}
export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
