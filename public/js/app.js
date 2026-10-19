// Điểm vào ứng dụng: định tuyến, khung giao diện, đăng nhập
import { session, get, post, del } from './api.js';
import { esc, toast, formData, modal, googleButton, $ } from './ui.js';
// Các trang được tải khi cần (học sinh không phải tải phần quản trị và ngược lại)
const mods = {
  admin: () => import('./admin.js'),
  editor: () => import('./editor.js'),
  student: () => import('./student.js'),
  examView: () => import('./exam-view.js'),
};
const lazy = (m, name) => async (params) => (await mods[m]())[name](params);
/** Tải sẵn các trang của vai trò hiện tại khi trình duyệt rảnh */
function prefetch() {
  const list = state.user?.role === 'student' ? ['student', 'examView'] : ['admin', 'editor', 'examView'];
  const run = () => list.forEach((m) => mods[m]().catch(() => {}));
  (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(run);
}

export const state = { user: null, cls: null, pending: 0 };
const app = document.getElementById('app');

const ROUTES = [
  // công khai
  ['/login', null, loginView],
  ['/register', null, registerView],
  ['/setup', null, setupView],
  // học sinh
  ['/home', 'student', lazy('student', 'home')],
  ['/assignments', 'student', lazy('student', 'assignments')],
  ['/do/:id', 'student', lazy('examView', 'take')],
  ['/practice', 'student', lazy('student', 'practice')],
  ['/practice/do/:id', 'student', lazy('examView', 'takePractice')],
  ['/result/:id', 'auth', lazy('examView', 'result')],
  ['/history', 'student', lazy('student', 'history')],
  ['/account', 'auth', accountView],
  // giáo viên / quản trị
  ['/admin', 'staff', lazy('admin', 'dashboard')],
  ['/admin/classes', 'staff', lazy('admin', 'classes')],
  ['/admin/class/:id', 'staff', lazy('admin', 'classDetail')],
  ['/admin/student/:id', 'staff', lazy('admin', 'studentDetail')],
  ['/admin/exams', 'staff', lazy('editor', 'examList')],
  ['/admin/exams/new', 'staff', lazy('editor', 'uploadView')],
  ['/admin/exam/:id', 'staff', lazy('editor', 'editExam')],
  ['/admin/exam/:id/preview', 'staff', lazy('examView', 'preview')],
  ['/admin/assignments', 'staff', lazy('editor', 'assignmentList')],
  ['/admin/assignment/:id', 'staff', lazy('admin', 'assignmentResults')],
  ['/admin/grading', 'staff', lazy('admin', 'grading')],
  ['/admin/attempt/:id', 'staff', lazy('examView', 'result')],
  ['/admin/users', 'staff', lazy('admin', 'users')],
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
    <div class="topbar"><button id="menuBtn" aria-label="Mở menu">☰</button><b>Tiếng Anh cô Loan</b></div>
    <div class="shell">
      <aside class="side" id="side">
        <div class="brand"><span class="logo">L</span> Tiếng Anh cô Loan</div>
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
    try { const me = await get('/me'); state.user = me.user; state.cls = me.class; prefetch(); } catch { session.clear(); }
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
      <div class="brand" style="padding:0"><span class="logo">L</span> Tiếng Anh cô Loan</div>
      <div>
        <h1>Làm bài cô Loan giao – tiến bộ từng ngày.</h1>
        <p>Nộp bài là có điểm ngay. Câu nào sai, cô Loan đã chuẩn bị sẵn đáp án và lời giải thích để em tự ôn lại.</p>
        <ul><li>Đủ dạng bài như đề thi: nghe, trắc nghiệm, đọc hiểu, viết lại câu…</li><li>Luyện thêm những chuyên đề em còn yếu</li><li>Cô Loan theo dõi tiến bộ của em qua từng bài</li></ul>
      </div>
      <div class="small" style="color:#9aa5c0">© Tiếng Anh cô Loan</div>
      <div class="deco">Aa</div>
    </div>
    <div class="form"><div class="card">${formHtml}</div></div>
  </div>`;
}
async function loginView() {
  if (state.user) { location.hash = isStaff() ? '#/admin' : '#/home'; return; }
  try { const st = await get('/setup/status'); if (st.needsSetup) { location.hash = '#/setup'; return; } } catch (e) { toast('Không kết nối được máy chủ: ' + e.message, 'err'); }
  authFrame(`<h2>Đăng nhập</h2><p class="muted">Dùng tài khoản cô Loan cấp, tài khoản em đã đăng ký, hoặc Gmail.</p>
    <form id="f"><label class="f">Tên đăng nhập<input name="username" autocomplete="username" required autofocus></label>
    <label class="f">Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn block accent">Đăng nhập</button></form>
    <div class="or" id="gor" style="display:none">hoặc</div><div class="gbtn-wrap" id="gbtn"></div>
    <p class="small muted mt">Học sinh mới của cô Loan? <a href="#/register">Đăng ký bằng mã lớp</a></p>`);
  bindAuth('/auth/login');
  googleButton($('#gbtn'), (credential) => googleLogin(credential)).then((ok) => { if (ok) $('#gor').style.display = ''; });
}
function finishLogin(r) {
  session.set({ token: r.token });
  state.user = null;
  location.hash = r.user.role === 'student' ? '#/home' : '#/admin';
}
/** Đăng nhập Google; nếu Gmail chưa có tài khoản thì hỏi mã lớp để tạo tài khoản học sinh */
async function googleLogin(credential, extra = {}) {
  try {
    finishLogin(await post('/auth/google', { credential, ...extra }));
  } catch (e) {
    if (!e.data?.needsRegister) { toast(e.message, 'err'); return; }
    const d = e.data;
    modal(`<h2>Tạo tài khoản học sinh</h2>
      <p>Gmail <b>${esc(d.email)}</b> chưa có trong hệ thống. Nếu em là học sinh, nhập <b>mã lớp</b> cô Loan gửi để tạo tài khoản.</p>
      <p class="small muted">Thầy cô / học sinh đã có tài khoản: hãy đăng nhập bằng tên đăng nhập và mật khẩu, rồi vào <b>Tài khoản → Liên kết Gmail</b>.</p>
      <form id="gf" class="form-grid"><label class="f">Mã lớp<input name="joinCode" required style="text-transform:uppercase;letter-spacing:.1em"></label>
      <label class="f">Họ và tên<input name="fullName" value="${esc(d.name || '')}" required></label></form>
      <div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn accent" id="ok">Tạo tài khoản</button></div>`, {
      onMount: (m, close) => m.querySelector('#ok').onclick = async () => {
        const f = m.querySelector('#gf'); if (!f.reportValidity()) return;
        try { finishLogin(await post('/auth/google', { credential, ...formData(f) })); close(); } catch (err) { toast(err.message, 'err'); }
      },
    });
  }
}
function registerView() {
  authFrame(`<h2>Đăng ký học sinh</h2><p class="muted">Nhập <b>mã lớp</b> cô Loan gửi cho lớp em.</p>
    <form id="f"><label class="f">Mã lớp<input name="joinCode" required style="text-transform:uppercase;letter-spacing:.1em"></label>
    <label class="f">Họ và tên<input name="fullName" required></label>
    <label class="f">Tên đăng nhập<input name="username" required pattern="[A-Za-z0-9._\\-]{3,40}" title="3–40 ký tự: chữ không dấu, số, . _ -"></label>
    <label class="f">Mật khẩu (ít nhất 6 ký tự)<input name="password" type="password" minlength="6" required></label>
    <button class="btn block accent">Tạo tài khoản</button></form>
    <div class="or" id="gor" style="display:none">hoặc nhập mã lớp ở trên rồi</div><div class="gbtn-wrap" id="gbtn"></div>
    <p class="small muted mt">Đã có tài khoản? <a href="#/login">Đăng nhập</a></p>`);
  bindAuth('/auth/register');
  googleButton($('#gbtn'), (credential) => {
    const f = formData($('#f'));
    if (!f.joinCode) { toast('Hãy nhập mã lớp trước khi đăng ký bằng Google', 'err'); return; }
    googleLogin(credential, { joinCode: f.joinCode, fullName: f.fullName });
  }, 'signup_with').then((ok) => { if (ok) $('#gor').style.display = ''; });
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
      finishLogin(r);
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  });
}
async function accountView() {
  try { const me = await get('/me'); state.user = me.user; state.cls = me.class; } catch {}
  const u = state.user;
  const main = layout(`<div class="page-head"><div><h1>Tài khoản</h1><p>${esc(u.fullName)} · @${esc(u.username)}</p></div></div>
    <div class="grid g2" style="max-width:920px">
    <div class="card"><h3>Đăng nhập bằng Google (Gmail)</h3>
      ${u.googleLinked ? `<p>✅ Đã liên kết với <b>${esc(u.email || '')}</b>. Em có thể bấm “Đăng nhập bằng Google” ở trang đăng nhập.</p>
        <button class="btn ghost sm" id="unlink">Bỏ liên kết</button>`
      : `<p class="muted">Liên kết Gmail để lần sau đăng nhập chỉ bằng một cú bấm.${u.email ? ` Gmail đã đăng ký: <b>${esc(u.email)}</b>.` : ''}</p><div class="gbtn-wrap" id="glink"></div><p class="small muted" id="gnone" style="display:none">Quản trị viên chưa bật đăng nhập Google (thiếu GOOGLE_CLIENT_ID).</p>`}
    </div>
    <div class="card"><h3>${u.passwordSet ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}</h3>
      ${u.passwordSet ? '' : '<p class="small muted">Tài khoản tạo bằng Google chưa có mật khẩu. Đặt mật khẩu để có thể đăng nhập bằng tên đăng nhập @' + esc(u.username) + '.</p>'}
      <form id="pw" class="form-grid">${u.passwordSet ? '<label class="f">Mật khẩu hiện tại<input type="password" name="oldPassword" required></label>' : ''}
      <label class="f">Mật khẩu mới<input type="password" name="newPassword" minlength="6" required></label>
      <button class="btn">Lưu</button></form></div></div>`);
  main.querySelector('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/me/password', formData(e.target)); toast('Đã lưu mật khẩu', 'ok'); accountView(); } catch (err) { toast(err.message, 'err'); }
  });
  const gl = main.querySelector('#glink');
  if (gl) googleButton(gl, async (credential) => {
    try { await post('/me/google', { credential }); toast('Đã liên kết Gmail', 'ok'); accountView(); } catch (err) { toast(err.message, 'err'); }
  }, 'continue_with').then((ok) => { if (!ok) main.querySelector('#gnone').style.display = ''; });
  const ul = main.querySelector('#unlink');
  if (ul) ul.onclick = async () => { try { await del('/me/google'); toast('Đã bỏ liên kết'); accountView(); } catch (err) { toast(err.message, 'err'); } };
}

window.addEventListener('hashchange', route);
route();
