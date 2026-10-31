// Tiện ích giao diện dùng chung
import { TOPICS, escapeHtml } from './parser.js';

export const esc = escapeHtml;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const topicLabel = (t) => TOPICS[t] || t || '—';

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
}

export function fmtDate(d, withTime = true) {
  if (!d) return '—';
  const x = new Date(d);
  return x.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + (withTime ? ' ' + x.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '');
}
export function fmtAgo(d) {
  if (!d) return 'chưa có';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return Math.floor(s / 60) + ' phút trước';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' ngày trước';
  return fmtDate(d, false);
}
export function fmtDur(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}g ${m % 60}p` : `${m}p ${String(s).padStart(2, '0')}s`;
}
export const pctClass = (p) => (p == null ? '' : p >= 80 ? 'hi' : p >= 50 ? 'mid' : 'lo');
// Điểm hiển thị theo thang 10 (dữ liệu lưu dưới dạng %, 0–100)
export const pct = (p) => (p == null || p === '' ? '<span class="muted">—</span>' : `<span class="pct ${pctClass(+p)}">${score10(p)}</span>`);
export const bar = (p) => `<div class="bar ${pctClass(p)}"><i style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></div>`;
export function score10(p) { return p == null || p === '' ? '—' : (Math.round(+p) / 10).toFixed(1); }

export function modal(html, { wide = false, onMount } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
    document.body.appendChild(bg);
    const close = (v) => { bg.remove(); resolve(v); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(null); });
    bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    onMount && onMount(bg.firstElementChild, close);
    // Chống bấm nhiều lần: khoá nút xác nhận cho tới khi xử lý xong
    const ok = bg.querySelector('#ok');
    if (ok && ok.onclick) {
      const fn = ok.onclick;
      ok.onclick = async (ev) => {
        if (ok.dataset.busy) return;
        ok.dataset.busy = '1'; ok.disabled = true;
        const label = ok.innerHTML; ok.innerHTML = '<span class="spinner"></span> Đang xử lý…';
        try { await fn.call(ok, ev); } finally { delete ok.dataset.busy; ok.disabled = false; if (ok.isConnected) ok.innerHTML = label; }
      };
    }
  });
}
export function confirmBox(msg, { ok = 'Đồng ý', danger = false } = {}) {
  return modal(`<h2>Xác nhận</h2><p>${msg}</p><div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn ${danger ? 'danger' : ''}" id="okb">${ok}</button></div>`,
    { onMount: (m, close) => m.querySelector('#okb').addEventListener('click', () => close(true)) });
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else if (el.multiple) o[el.name] = [...el.selectedOptions].map((x) => x.value);
    else o[el.name] = el.value;
  }
  return o;
}

/** Biểu đồ Chart.js – tự huỷ biểu đồ cũ trên cùng canvas */
const charts = new WeakMap();
let chartLib = null;
const loadChart = () => (chartLib ??= new Promise((res, rej) => {
  if (window.Chart) return res(window.Chart);
  const sc = document.createElement('script'); sc.src = '/vendor/chart.umd.min.js';
  sc.onload = () => res(window.Chart); sc.onerror = () => { chartLib = null; rej(new Error('chart')); };
  document.head.appendChild(sc);
}));
/** Biểu đồ: thư viện Chart.js chỉ được tải khi trang thật sự có biểu đồ */
export async function chart(canvas, config) {
  if (!canvas) return;
  try { await loadChart(); } catch { return; }
  if (!canvas.isConnected) return;
  charts.get(canvas)?.destroy();
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  window.Chart.defaults.color = '#6b7591';
  const c = new window.Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options } });
  charts.set(canvas, c);
  return c;
}
export const COLORS = ['#3156d3', '#ff6b4a', '#14966d', '#ffb84d', '#8b5cf6', '#0ea5b7', '#d93b41', '#64748b'];

/** Thanh đánh giá chuyên đề */
export function topicRows(topics, { sort = 'asc' } = {}) {
  const rows = topics.filter((t) => t.max > 0).map((t) => ({ ...t, p: Math.round((t.earned / t.max) * 100) }));
  rows.sort((a, b) => (sort === 'asc' ? a.p - b.p : b.p - a.p));
  if (!rows.length) return '<div class="empty small">Chưa có dữ liệu</div>';
  return rows.map((t) => `<div class="topic-row"><span>${esc(topicLabel(t.topic))}</span>${bar(t.p)}<span class="right">${pct(t.p)}</span></div>`).join('');
}
export const heatColor = (p) => {
  if (p == null) return '#f1efe9';
  const h = Math.round((p / 100) * 130); // đỏ -> xanh
  return `hsl(${h} 65% ${78 - (p / 100) * 8}%)`;
};

/** Link Google Drive không phát trực tiếp được trong trang → phát qua máy chủ web (chuyển tiếp từng đoạn) */
export function driveAudio(url) {
  const s = String(url || '');
  if (!/drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com/.test(s)) return s;
  const m = s.match(/\/file\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/);
  return m ? `/api/drive/${m[1]}` : s;
}
export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; }

// ---------------------------------------------------------------- Google Sign-In
let gcfg = null, gis = null;
export async function googleClientId() {
  if (gcfg === null) { try { gcfg = (await (await fetch('/api/config')).json()).googleClientId || ''; } catch { gcfg = ''; } }
  return gcfg;
}
function loadGis() {
  gis ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(window.google); s.onerror = () => { gis = null; rej(new Error('Không tải được Google Sign-In')); };
    document.head.appendChild(s);
  });
  return gis;
}
/** Vẽ nút Google vào el. onCredential nhận chuỗi credential. Trả về false nếu chưa cấu hình. */
export async function googleButton(el, onCredential, text = 'signin_with') {
  const cid = await googleClientId();
  if (!cid || !el) return false;
  try {
    const g = await loadGis();
    g.accounts.id.initialize({ client_id: cid, callback: (r) => onCredential(r.credential), ux_mode: 'popup' });
    g.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text, shape: 'pill', width: Math.min(320, el.clientWidth || 300), locale: 'vi' });
    return true;
  } catch { return false; }
}
