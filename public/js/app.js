// Điểm vào ứng dụng: định tuyến, khung giao diện, đăng nhập
import { session, get, post } from './api.js';
import { esc, toast, formData, $ } from './ui.js';
import * as admin from './admin.js';
import * as editor from './editor.js';
import * as student from './student.js';
import * as examView from './exam-view.js';

export const state = { user: null, cls: null, pending: 0 };
const app = document.getElementById('app');

const ROUTES = [
  // công khai
  ['/login', null, loginView],
  ['/register', null, registerView],
  ['/setup', null, setupView],
  // học sinh
  ['/home', 'student', student.home],
  ['/assignments', 'student', student.assignments],
  ['/do/:id', 'student', examView.take],
  ['/practice', 'student', student.practice],
  ['/practice/do/:id', 'student', examView.takePractice],
  ['/result/:id', 'auth', examView.result],
  ['/history', 'student', student.history],
  ['/account', 'auth', accountView],
  // giáo viên / quản trị
  ['/admin', 'staff', admin.dashboard],
  ['/admin/classes', 'staff', admin.classes],
  ['/admin/class/:id', 'staff', admin.classDetail],
  ['/admin/student/:id', 'staff', admin.studentDetail],
  ['/admin/exams', 'staff', editor.examList],
  ['/admin/exams/new', 'staff', editor.uploadView],
  ['/admin/exam/:id', 'staff', editor.editExam],
  ['/admin/exam/:id/preview', 'staff', examView.preview],
  ['/admin/assignments', 'staff', editor.assignmentList],
  ['/admin/assignment/:id', 'staff', admin.assignmentResults],
  ['/admin/grading', 'staff', admin.grading],
  ['/admin/attempt/:id', 'staff', examView.result],
  ['/admin/users', 'staff', admin.users],
];

const NAV = {
  staff: [
    ['#/admin', '📊', 'Tổng quan'],
    ['#/admin/classes', '🏫', 'Lớp & học sinh'],
    ['#/admin/exams', '📄', 'Ngân hàng đề'],
    ['#/admin/assignments', '📮', 'Bài đã giao'],
    ['#/admin/grading', '✍️', 'Chấm tự luận', 'pending'],
    ['#/admin/users', '👥', 'Tài khoản'],
  ],
  student: [
    ['#/home', '🏠', 'Trang của em'],
    ['#/assignments', '📝', 'Bài tập của lớp'],
    ['#/practice', '🎯', 'Luyện theo chuyên đề'],
    ['#/history', '📈', 'Kết quả & tiến bộ'],
  ],
};

const isStaff = () => state.user && (state.user.role === 'admin' || state.user.role === 'teacher');

export function layout(html) {
  const nav = NAV[isStaff() ? 'staff' : 'student'];
  const here = location.hash.split('?')[0];
  const active = (href) => here === href || (href !== '#/admin' && href !== '#/home' && here.startsWith(href));
  app.innerHTML = `
    <div class="topbar"><button id="menuBtn" aria-label="Mở menu">☰</button><b>EngPractice</b></div>
    <div class="shell">
      <aside class="side" id="side">
        <div class="brand"><span class="logo">E</span> EngPractice</div>
        ${nav.map(([href, icon, label, badge]) => `<a class="nav ${active(href) ? 'active' : ''}" href="${href}"><span>${icon}</span>${label}${badge === 'pending' && state.pending ? `<span class="badge">${state.pending}</span>` : ''}</a>`).join('')}
        <div class="who">
          <b>${esc(state.user.fullName)}</b>
          <span class="muted">${isStaff() ? (state.user.role === 'admin' ? 'Quản trị viên' : 'Giáo viên') : 'Lớp ' + esc(state.cls?.name || '—')}</span><br>
          <a href="#/account">Tài khoản</a> · <a href="#" id="logout">Đăng xuất</a>
        </div>
      </aside>
      <main class="main" id="main">${html}</main>
    </div>`;
  $('#logout').onclick = (e) => { e.preventDefault(); session.clear(); state.user = null; location.hash = '#/login'; };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a.nav')) $('#side').classList.remove('open'); });
  return $('#main');
}
export const loading = () => layout('<div class="loading">Đang tải…</div>');

async function route() {
  const hash = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const s = session.get();
  if (s && !state.user) {
    try { const me = await get('/me'); state.user = me.user; state.cls = me.class; } catch { session.clear(); }
  }
  if (hash === '/' || hash === '') { location.hash = state.user ? (isStaff() ? '#/admin' : '#/home') : '#/login'; return; }
  for (const [pattern, role, view] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = hash.match(re);
    if (!m) continue;
    if (role && !state.user) { location.hash = '#/login'; return; }
    if (role === 'staff' && !isStaff()) { location.hash = '#/home'; return; }
    if (role === 'student' && isStaff()) { location.hash = '#/admin'; return; }
    const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    window.scrollTo(0, 0);
    if (isStaff() && role) refreshPending();
    try { await view(params); } catch (e) { console.error(e); layout(`<div class="card empty"><div class="big">⚠️</div>${esc(e.message)}</div>`); }
    return;
  }
  layout('<div class="card empty"><div class="big">🔎</div>Không tìm thấy trang</div>');
}
async function refreshPending() {
  try { const p = await get('/grading/pending'); if (p.length !== state.pending) { state.pending = p.length; const b = document.querySelector('a.nav[href="#/admin/grading"]'); if (b) b.innerHTML = `<span>✍️</span>Chấm tự luận${state.pending ? `<span class="badge">${state.pending}</span>` : ''}`; } } catch {}
}

// ------------------------------------------------------------------ AUTH
function authFrame(formHtml) {
  app.innerHTML = `<div class="auth">
    <div class="art">
      <div class="brand" style="padding:0"><span class="logo">E</span> EngPractice</div>
      <div>
        <h1>Luyện tiếng Anh mỗi ngày, tiến bộ thấy rõ.</h1>
        <p>Làm bài thầy cô giao, nộp là có điểm ngay, câu sai có đáp án và giải thích để tự ôn lại.</p>
        <ul><li>Trắc nghiệm, điền từ, đọc hiểu, viết lại câu…</li><li>Luyện riêng chuyên đề còn yếu</li><li>Theo dõi tiến bộ qua từng bài</li></ul>
      </div>
      <div class="small" style="color:#9aa5c0">© EngPractice</div>
      <div class="deco">Aa</div>
    </div>
    <div class="form"><div class="card">${formHtml}</div></div>
  </div>`;
}
async function loginView() {
  if (state.user) { location.hash = isStaff() ? '#/admin' : '#/home'; return; }
  try { const st = await get('/setup/status'); if (st.needsSetup) { location.hash = '#/setup'; return; } } catch (e) { toast('Không kết nối được máy chủ: ' + e.message, 'err'); }
  authFrame(`<h2>Đăng nhập</h2><p class="muted">Dùng tài khoản thầy cô cấp hoặc tài khoản em đã đăng ký.</p>
    <form id="f"><label class="f">Tên đăng nhập<input name="username" autocomplete="username" required autofocus></label>
    <label class="f">Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn block accent">Đăng nhập</button></form>
    <p class="small muted mt">Học sinh mới? <a href="#/register">Đăng ký bằng mã lớp</a></p>`);
  bindAuth('/auth/login');
}
function registerView() {
  authFrame(`<h2>Đăng ký học sinh</h2><p class="muted">Nhập <b>mã lớp</b> do thầy cô cung cấp.</p>
    <form id="f"><label class="f">Mã lớp<input name="joinCode" required style="text-transform:uppercase;letter-spacing:.1em"></label>
    <label class="f">Họ và tên<input name="fullName" required></label>
    <label class="f">Tên đăng nhập<input name="username" required pattern="[A-Za-z0-9._\\-]{3,40}" title="3–40 ký tự: chữ không dấu, số, . _ -"></label>
    <label class="f">Mật khẩu (ít nhất 6 ký tự)<input name="password" type="password" minlength="6" required></label>
    <button class="btn block accent">Tạo tài khoản</button></form>
    <p class="small muted mt">Đã có tài khoản? <a href="#/login">Đăng nhập</a></p>`);
  bindAuth('/auth/register');
}
function setupView() {
  authFrame(`<h2>Thiết lập lần đầu</h2><p class="muted">Tạo tài khoản <b>quản trị viên</b> (chỉ làm một lần).</p>
    <form id="f"><label class="f">Họ và tên<input name="fullName" required></label>
    <label class="f">Tên đăng nhập<input name="username" required pattern="[A-Za-z0-9._\\-]{3,40}"></label>
    <label class="f">Mật khẩu<input name="password" type="password" minlength="6" required></label>
    <button class="btn block accent">Tạo quản trị viên</button></form>`);
  bindAuth('/setup');
}
function bindAuth(path) {
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await post(path, formData(e.target));
      session.set({ token: r.token });
      state.user = null;
      location.hash = r.user.role === 'student' ? '#/home' : '#/admin';
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  });
}
function accountView() {
  const main = layout(`<div class="page-head"><div><h1>Tài khoản</h1><p>${esc(state.user.fullName)} · @${esc(state.user.username)}</p></div></div>
    <div class="card" style="max-width:460px"><h3>Đổi mật khẩu</h3>
    <form id="pw" class="form-grid"><label class="f">Mật khẩu hiện tại<input type="password" name="oldPassword" required></label>
    <label class="f">Mật khẩu mới<input type="password" name="newPassword" minlength="6" required></label>
    <button class="btn">Lưu</button></form></div>`);
  main.querySelector('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/me/password', formData(e.target)); toast('Đã đổi mật khẩu', 'ok'); e.target.reset(); } catch (err) { toast(err.message, 'err'); }
  });
}

window.addEventListener('hashchange', route);
route();
