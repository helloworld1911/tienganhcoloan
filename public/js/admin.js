// Giao diện giáo viên / quản trị: dashboard, lớp, học sinh, kết quả
import { get, post, put, del, api, session } from './api.js';
import { layout, state } from './app.js';
import { esc, toast, modal, confirmBox, formData, fmtDate, fmtAgo, pct, bar, topicLabel, topicRows, chart, heatColor, score10, COLORS, $, $$ } from './ui.js';
import { TOPICS } from './parser.js';
import { drawProgress } from './student.js';

const gradeName = (g) => (g ? `Khối ${g}` : 'Chưa phân khối');
const clickRows = (root) => root.addEventListener('click', (e) => {
  if (e.target.closest('button, a, input, select')) return;
  const tr = e.target.closest('[data-href]'); if (tr) location.hash = tr.dataset.href;
});

// ================================================================ TỔNG QUAN
export async function dashboard() {
  layout('<div class="loading">Đang tải…</div>');
  const d = await get('/dashboard/overview');
  const grades = [...new Set(d.classes.map((c) => c.grade))].sort((a, b) => (a ?? 99) - (b ?? 99));
  let sel = 'all';
  const main = layout(`
    <div class="page-head"><div><h1>Tổng quan</h1><p>Tình hình học tập theo khối lớp</p></div>
      <div class="row"><a class="btn ghost" href="#/admin/exams/new">⬆️ Tải đề lên</a><a class="btn accent" href="#/admin/classes">+ Lớp mới</a></div></div>
    <div class="grid g4 mb">
      <div class="card kpi accent"><span class="v">${d.totals.students}</span><span class="l">học sinh</span></div>
      <div class="card kpi"><span class="v">${d.totals.exams}</span><span class="l">đề trong ngân hàng</span></div>
      <div class="card kpi"><span class="v">${d.totals.submissions}</span><span class="l">lượt nộp bài</span></div>
      <a class="card kpi" href="#/admin/grading" style="text-decoration:none;color:inherit"><span class="v">${d.totals.pending}</span><span class="l">bài tự luận chờ chấm →</span></a>
    </div>
    ${!d.classes.length ? '<div class="hint mb">Bắt đầu: 1) tạo lớp & thêm học sinh → 2) tải đề + đáp án lên → 3) giao bài cho lớp.</div>' : ''}
    <div class="seg mb" id="gsel"><button class="on" data-g="all">Tất cả khối</button>${grades.map((g) => `<button data-g="${g ?? ''}">${gradeName(g)}</button>`).join('')}</div>
    <div id="body"></div>
    <div class="card mt flat small" id="health"><span class="muted">⚡ Đang đo tốc độ hệ thống…</span></div>`);
  // đo tốc độ máy chủ ↔ CSDL (không chặn việc hiển thị trang)
  get('/health').then((h) => {
    const el = $('#health', main); if (!el) return;
    const slow = h.dbMs > 60;
    el.innerHTML = `<b>⚡ Tốc độ hệ thống:</b> mỗi truy vấn tới CSDL mất <b class="${slow ? 'pct lo' : 'pct hi'}">${h.dbMs} ms</b>
      · máy chủ Netlify ở vùng <b>${esc(h.region || '?')}</b> · kết nối ${h.driver === 'neon-http' ? 'HTTP (nhanh)' : esc(h.driver)}
      ${slow ? `<div class="warnbox mt-s">CSDL đang đặt xa máy chủ Netlify nên mỗi trang chậm thêm khoảng ${Math.round(h.dbMs * 4 / 100) / 10}s.
        Nên tạo CSDL Neon mới ở vùng <b>AWS US East 2 (Ohio)</b> – cùng vùng với máy chủ Netlify gói miễn phí – rồi dùng nút
        <b>Sao lưu / Khôi phục</b> bên dưới để chuyển dữ liệu (xem README, mục “Tăng tốc”).</div>` : ''}
      ${state.user.role === 'admin' ? '<div class="row mt-s"><button class="btn ghost sm" id="bk">⬇️ Sao lưu dữ liệu</button><button class="btn ghost sm" id="rs">⬆️ Khôi phục từ file sao lưu</button><input type="file" id="rsf" accept=".json" hidden><button class="btn ghost sm" id="pm">🎧 Chép file nghe từ web cũ</button></div>' : ''}`;
    if (state.user.role === 'admin') bindBackup(el);
  }).catch(() => { const el = $('#health', main); if (el) el.remove(); });
  const draw = () => {
    const cls = d.classes.filter((c) => sel === 'all' || String(c.grade ?? '') === sel);
    const gradeKey = (g) => String(g ?? '');
    const topics = {};
    d.topics.filter((t) => sel === 'all' || gradeKey(t.grade) === sel).forEach((t) => {
      topics[t.topic] ??= { topic: t.topic, earned: 0, max: 0 }; topics[t.topic].earned += t.earned; topics[t.topic].max += t.max;
    });
    $('#body', main).innerHTML = `
      <div class="card mb"><h3>Các lớp</h3><div class="table-wrap"><table class="t"><thead><tr><th>Lớp</th><th>Khối</th><th>Học sinh</th><th>Bài đã giao</th><th>Hoàn thành</th><th>Điểm TB</th><th>Nộp 7 ngày</th></tr></thead><tbody>
      ${cls.map((c) => {
        const expected = c.students * c.assignments;
        const comp = expected ? Math.round((c.done_pairs / expected) * 100) : null;
        return `<tr class="click" data-href="#/admin/class/${c.id}"><td><b>${esc(c.name)}</b></td><td>${c.grade ?? '—'}</td><td>${c.students}</td><td>${c.assignments}</td>
          <td style="min-width:140px">${comp == null ? '—' : `<div class="row" style="gap:8px">${bar(comp)}<span class="small">${comp}%</span></div>`}</td>
          <td>${pct(c.avg_percent)} <span class="muted small">(${score10(c.avg_percent)}đ)</span></td><td>${c.week_submissions}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">Chưa có lớp</td></tr>'}</tbody></table></div></div>
      <div class="grid g2">
        <div class="card"><h3>Điểm trung bình theo tuần</h3><div class="chart-box"><canvas id="trend"></canvas></div></div>
        <div class="card"><h3>Độ chính xác theo chuyên đề</h3><p class="small muted">Sắp xếp từ yếu đến mạnh – nên ưu tiên ôn các chuyên đề phía trên.</p>${topicRows(Object.values(topics))}</div>
      </div>`;
    clickRows($('#body', main));
    const tr = d.trend.filter((t) => sel === 'all' || gradeKey(t.grade) === sel);
    const weeks = [...new Set(tr.map((t) => t.week))].sort();
    const gs = [...new Set(tr.map((t) => t.grade))];
    if (!weeks.length) { $('#trend', main).parentElement.innerHTML = '<div class="empty small">Chưa có bài nộp</div>'; return; }
    chart($('#trend', main), {
      type: 'line',
      data: { labels: weeks.map((w) => 'Tuần ' + fmtDate(w, false)), datasets: gs.map((g, i) => ({ label: gradeName(g), data: weeks.map((w) => tr.find((t) => t.week === w && t.grade === g)?.avg ?? null), borderColor: COLORS[i % COLORS.length], tension: .3, spanGaps: true })) },
      options: { scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom' } } },
    });
  };
  draw();
  $('#gsel', main).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sel = b.dataset.g; $$('#gsel button', main).forEach((x) => x.classList.toggle('on', x === b)); draw();
  });
}

// ================================================================ SAO LƯU / KHÔI PHỤC
const BACKUP_TABLES = ['classes', 'users', 'exams', 'assignments', 'attempts', 'attempt_items', 'media'];
function bindBackup(el) {
  el.querySelector('#bk').onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const tables = {};
      for (const t of BACKUP_TABLES) {
        tables[t] = [];
        let offset = 0;
        while (offset != null) {
          btn.textContent = `Đang sao lưu ${t} (${tables[t].length})…`;
          const r = await get(`/admin/backup/${t}?offset=${offset}`);
          tables[t].push(...r.rows); offset = r.next;
        }
      }
      const blob = new Blob([JSON.stringify({ app: 'engpractice', version: 1, created: new Date().toISOString(), tables })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `sao-luu-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      toast('Đã tải file sao lưu', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.textContent = '⬇️ Sao lưu dữ liệu'; }
  };
  el.querySelector('#rs').onclick = () => el.querySelector('#rsf').click();
  // Sau khi chuyển web (VD từ Netlify sang Cloudflare) + khôi phục dữ liệu: file nghe vẫn nằm ở web cũ → chép sang
  el.querySelector('#pm').onclick = () => modal(`<h2>Chép file nghe từ web cũ</h2>
    <p>Dùng sau khi chuyển web sang địa chỉ mới và đã <b>khôi phục dữ liệu</b>. File nghe đã tải lên ở web cũ sẽ được chép sang đây (web cũ vẫn phải đang chạy).</p>
    <form id="pf" class="form-grid"><label class="f">Địa chỉ web cũ<input name="from" required placeholder="https://ten-web.netlify.app"></label></form>
    <div id="pr" class="small muted"></div>
    <div class="actions"><button class="btn ghost" data-close>Đóng</button><button class="btn" id="ok">Bắt đầu chép</button></div>`, {
    onMount: (m) => m.querySelector('#ok').onclick = async () => {
      const f = m.querySelector('#pf'); if (!f.reportValidity()) return;
      const from = f.from.value.trim().replace(/\/+$/, '');
      const okb = m.querySelector('#ok'); const pr = m.querySelector('#pr'); okb.disabled = true;
      try {
        const list = await get('/admin/media');
        let copied = 0, skipped = 0, failed = [];
        for (const [i, md] of list.entries()) {
          for (let n = 0; n < md.chunks; n++) {
            pr.textContent = `File ${i + 1}/${list.length} (${md.name || md.id}) – phần ${n + 1}/${md.chunks}…`;
            try { const r = await post(`/admin/media/${md.id}/pull/${n}`, { from }); r.skipped ? skipped++ : copied++; }
            catch (e) { failed.push(`${md.name || md.id}: ${e.message}`); break; }
          }
        }
        pr.innerHTML = `Xong: chép ${copied} phần, ${skipped} phần đã có sẵn.${failed.length ? '<br><b>Lỗi:</b><br>' + failed.map(esc).join('<br>') : ''}`;
        toast(failed.length ? 'Có file chưa chép được' : 'Đã chép xong file nghe', failed.length ? 'err' : 'ok');
      } catch (e) { toast(e.message, 'err'); } finally { okb.disabled = false; }
    },
  });
  el.querySelector('#rsf').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); if (data.app !== 'engpractice' || !data.tables) throw new Error(); } catch { toast('File sao lưu không hợp lệ', 'err'); return; }
    if (!(await confirmBox('Khôi phục sẽ <b>XOÁ toàn bộ dữ liệu hiện tại</b> (lớp, học sinh, đề, bài làm) và thay bằng dữ liệu trong file sao lưu. Tiếp tục?', { danger: true, ok: 'Khôi phục' }))) return;
    const btn = el.querySelector('#rs'); btn.disabled = true;
    try {
      const { restoreToken } = await post('/admin/restore/begin', { confirm: 'XOA_HET' });
      session.set({ token: restoreToken }); // tài khoản hiện tại bị xoá tạm trong lúc khôi phục
      let total = 0;
      for (const t of BACKUP_TABLES) {
        const rows = data.tables[t] || [];
        let chunk = [], size = 0;
        const flush = async () => { if (!chunk.length) return; total += (await post(`/admin/restore/rows/${t}`, { rows: chunk })).inserted; chunk = []; size = 0; btn.textContent = `Đang khôi phục ${t}… (${total})`; };
        for (const r of rows) { const n = JSON.stringify(r).length; if (size + n > 2_000_000) await flush(); chunk.push(r); size += n; }
        await flush();
      }
      await post('/admin/restore/finish');
      toast(`Đã khôi phục ${total} dòng dữ liệu. Hãy đăng nhập lại.`, 'ok');
      setTimeout(() => { try { localStorage.clear(); } catch {} location.hash = '#/login'; location.reload(); }, 1500);
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = '⬆️ Khôi phục từ file sao lưu'; }
  };
}

// ================================================================ LỚP
function classForm(c = {}) {
  return `<form class="form-grid" id="cf">
    <label class="f">Tên lớp<input name="name" value="${esc(c.name || '')}" placeholder="VD: 6A1" required></label>
    <div class="grid g2"><label class="f">Khối<select name="grade"><option value="">—</option>${Array.from({ length: 12 }, (_, i) => `<option ${c.grade === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
    <label class="f">Năm học<input name="schoolYear" value="${esc(c.school_year || '')}" placeholder="2026-2027"></label></div>
  </form>`;
}
export async function classes() {
  layout('<div class="loading">Đang tải…</div>');
  const list = await get('/classes');
  const main = layout(`<div class="page-head"><div><h1>Lớp & học sinh</h1><p>Học sinh không tự đăng ký được – quản trị viên tạo tài khoản trong từng lớp, hoặc ở mục <a href="#/admin/register">Đăng ký học sinh</a> bằng <b>mã lớp</b>.</p></div>
    <button class="btn accent" id="add">+ Tạo lớp</button></div>
    <div class="grid g3">${list.map((c) => `<div class="card assign-card"><div class="row between"><span class="t">${esc(c.name)}</span><span class="chip">${gradeName(c.grade)}</span></div>
      <div class="meta"><span>👩‍🎓 ${c.student_count} học sinh</span><span>📮 ${c.assignment_count} bài đã giao</span></div>
      <div class="small">Mã lớp: <span class="code">${esc(c.join_code)}</span></div>
      <div class="row"><a class="btn sm" href="#/admin/class/${c.id}">Mở lớp</a></div></div>`).join('') || '<div class="card empty">Chưa có lớp nào</div>'}</div>`);
  $('#add', main).onclick = () => modal(`<h2>Tạo lớp</h2>${classForm()}<div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn" id="ok">Tạo</button></div>`, {
    onMount: (m, close) => m.querySelector('#ok').onclick = async () => {
      const f = m.querySelector('#cf'); if (!f.reportValidity()) return;
      try { const c = await post('/classes', formData(f)); close(); location.hash = '#/admin/class/' + c.id; } catch (e) { toast(e.message, 'err'); }
    },
  });
}

export async function classDetail({ id }) {
  layout('<div class="loading">Đang tải…</div>');
  const [d, allClasses] = await Promise.all([get('/dashboard/class/' + id), get('/classes')]);
  const c = d.class;
  let tab = sessionStorage.getItem('classTab') || 'students';
  const main = layout(`
    <div class="page-head"><div><div class="crumbs"><a href="#/admin/classes">Lớp</a> / ${esc(c.name)}</div><h1>Lớp ${esc(c.name)}</h1>
      <p>${gradeName(c.grade)}${c.school_year ? ' · ' + esc(c.school_year) : ''} · Mã lớp <span class="code">${esc(c.join_code)}</span> <button class="link-btn small" id="regen">đổi mã</button></p></div>
      <div class="row"><button class="btn ghost" id="edit">Sửa lớp</button><button class="btn ghost" id="csv">⬇️ Xuất CSV</button>${state.user.role === 'admin' ? '<button class="btn accent" id="addSt">+ Thêm học sinh</button>' : ''}</div></div>
    <div class="grid g4 mb">
      <div class="card kpi accent"><span class="v">${d.students.length}</span><span class="l">học sinh</span></div>
      <div class="card kpi"><span class="v">${d.assignCount}</span><span class="l">bài đã giao</span></div>
      <div class="card kpi"><span class="v">${pct(avgOf(d.students.map((s) => s.avg_percent)))}</span><span class="l">điểm TB lớp</span></div>
      <div class="card kpi"><span class="v">${d.students.filter((s) => s.last_submitted && Date.now() - new Date(s.last_submitted) < 7 * 864e5).length}</span><span class="l">HS hoạt động 7 ngày</span></div>
    </div>
    <div class="tabs" id="tabs">${[['students', 'Học sinh'], ['topics', 'Chuyên đề'], ['assign', 'Bài đã giao'], ['trend', 'Tiến bộ']].map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div>
    <div id="tab"></div>`);
  const draw = () => {
    sessionStorage.setItem('classTab', tab);
    $$('#tabs button', main).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const el = $('#tab', main);
    if (tab === 'students') {
      el.innerHTML = `<div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Học sinh</th><th>Hoàn thành</th><th>Điểm TB</th><th>Xu hướng</th><th>Luyện tập</th><th>Hoạt động</th><th></th></tr></thead><tbody>
        ${d.students.map((s, i) => {
          const series = (s.series || []).map(Number);
          const trend = series.length >= 2 ? series[series.length - 1] - series[0] : null;
          return `<tr class="click" data-href="#/admin/student/${s.id}"><td>${i + 1}</td><td><b>${esc(s.full_name)}</b>${s.active ? '' : ' <span class="chip bad">khoá</span>'}<br><span class="small muted">@${esc(s.username)}</span></td>
          <td>${s.done_assignments}/${d.assignCount}</td><td>${pct(s.avg_percent)}</td><td>${spark(series)} ${trend == null ? '' : trend >= 0 ? `<span class="chip good">▲ ${Math.round(trend)}</span>` : `<span class="chip bad">▼ ${Math.round(-trend)}</span>`}</td>
          <td>${s.practice_count}</td><td class="small">${fmtAgo(s.last_submitted)}</td>
          <td class="nowrap"><button class="link-btn small" data-edit="${s.id}">Sửa</button> · <button class="link-btn danger small" data-del="${s.id}">Xoá</button></td></tr>`;
        }).join('') || '<tr><td colspan="8" class="empty">Lớp chưa có học sinh. Quản trị viên bấm “+ Thêm học sinh” hoặc vào mục Đăng ký học sinh.</td></tr>'}</tbody></table></div></div>`;
    } else if (tab === 'topics') {
      const topicsUsed = d.topics.map((t) => t.topic);
      const st = {}; d.studentTopics.forEach((r) => { st[`${r.user_id}-${r.topic}`] = r.max ? Math.round((r.earned / r.max) * 100) : null; });
      el.innerHTML = `<div class="grid g2"><div class="card"><h3>Độ chính xác của lớp</h3>${topicRows(d.topics)}</div>
        <div class="card"><h3>Biểu đồ</h3><div class="chart-box"><canvas id="radar"></canvas></div></div></div>
        <div class="card mt"><h3>Bản đồ nhiệt: học sinh × chuyên đề</h3><p class="small muted">Ô đỏ là chuyên đề học sinh còn yếu.</p><div class="table-wrap">
        <table class="heat"><thead><tr><th></th>${topicsUsed.map((t) => `<th class="rot">${esc(topicLabel(t))}</th>`).join('')}</tr></thead><tbody>
        ${d.students.map((s) => `<tr><th><a href="#/admin/student/${s.id}">${esc(s.full_name)}</a></th>${topicsUsed.map((t) => { const v = st[`${s.id}-${t}`]; return `<td style="background:${heatColor(v)}">${v ?? ''}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div></div>`;
      if (d.topics.length >= 3) chart($('#radar', el), { type: 'radar', data: { labels: d.topics.map((t) => topicLabel(t.topic)), datasets: [{ label: 'Độ chính xác %', data: d.topics.map((t) => Math.round((t.earned / t.max) * 100)), borderColor: '#3156d3', backgroundColor: 'rgba(49,86,211,.15)' }] }, options: { scales: { r: { min: 0, max: 100 } }, plugins: { legend: { display: false } } } });
      else $('#radar', el).parentElement.innerHTML = '<div class="empty small">Cần ít nhất 3 chuyên đề</div>';
    } else if (tab === 'assign') {
      el.innerHTML = `<div class="row mb"><a class="btn accent" href="#/admin/assignments?class=${c.id}">+ Giao bài mới</a></div><div class="card"><table class="t"><thead><tr><th>Bài</th><th>Hạn</th><th>Đã nộp</th><th>Điểm TB</th></tr></thead><tbody>
        ${d.assignments.map((a) => `<tr class="click" data-href="#/admin/assignment/${a.id}"><td><b>${esc(a.title)}</b><br><span class="small muted">giao ${fmtDate(a.created_at, false)}</span></td><td>${fmtDate(a.due_at)}</td>
        <td style="min-width:140px"><div class="row" style="gap:8px">${bar(d.students.length ? (a.done / d.students.length) * 100 : 0)}<span class="small">${a.done}/${d.students.length}</span></div></td><td>${pct(a.avg_percent)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa giao bài nào</td></tr>'}</tbody></table></div>`;
    } else {
      el.innerHTML = `<div class="card"><h3>Điểm trung bình của lớp theo tuần</h3><div class="chart-box"><canvas id="tr"></canvas></div></div>
        <div class="card mt"><h3>Điểm trung bình từng bài</h3><div class="chart-box"><canvas id="ab"></canvas></div></div>`;
      if (d.trend.length) chart($('#tr', el), { type: 'line', data: { labels: d.trend.map((t) => 'Tuần ' + fmtDate(t.week, false)), datasets: [{ label: 'Điểm TB (%)', data: d.trend.map((t) => t.avg), borderColor: '#ff6b4a', backgroundColor: 'rgba(255,107,74,.12)', fill: true, tension: .3 }, { label: 'Số lượt nộp', data: d.trend.map((t) => t.n), borderColor: '#64748b', borderDash: [4, 4], yAxisID: 'y2' }] }, options: { scales: { y: { min: 0, max: 100 }, y2: { position: 'right', grid: { display: false } } }, plugins: { legend: { position: 'bottom' } } } });
      const as = d.assignments.filter((a) => a.avg_percent != null);
      if (as.length) chart($('#ab', el), { type: 'bar', data: { labels: as.map((a) => a.title.slice(0, 30)), datasets: [{ label: 'Điểm TB (%)', data: as.map((a) => +a.avg_percent), backgroundColor: '#3156d3', borderRadius: 6 }] }, options: { scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } } });
    }
  };
  draw();
  $('#tabs', main).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; draw(); } });
  clickRows(main);
  main.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
    if (ed) editStudent(d.students.find((s) => s.id === +ed.dataset.edit), allClasses, () => classDetail({ id }));
    if (dl && await confirmBox('Xoá học sinh này cùng toàn bộ bài làm?', { danger: true, ok: 'Xoá' })) {
      try { await del('/users/' + dl.dataset.del); toast('Đã xoá', 'ok'); classDetail({ id }); } catch (err) { toast(err.message, 'err'); }
    }
  });
  $('#regen', main).onclick = async () => { if (await confirmBox('Tạo mã lớp mới? Mã cũ sẽ không dùng được nữa.')) { await post(`/classes/${c.id}/code`); classDetail({ id }); } };
  $('#csv', main).onclick = async () => {
    try { const res = await api('/export/class/' + c.id, { raw: true }); const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ket-qua-${c.name}.csv`; a.click(); } catch (err) { toast(err.message, 'err'); }
  };
  $('#edit', main).onclick = () => modal(`<h2>Sửa lớp</h2>${classForm(c)}<div class="actions">${state.user.role === 'admin' ? '<button class="btn danger" id="dl" style="margin-right:auto">Xoá lớp</button>' : ''}<button class="btn ghost" data-close>Huỷ</button><button class="btn" id="ok">Lưu</button></div>`, {
    onMount: (m, close) => {
      m.querySelector('#ok').onclick = async () => { try { await put('/classes/' + c.id, formData(m.querySelector('#cf'))); close(); classDetail({ id }); } catch (err) { toast(err.message, 'err'); } };
      const dlb = m.querySelector('#dl');
      if (dlb) dlb.onclick = async () => { close(); if (await confirmBox('Xoá lớp? Bài đã giao cho lớp sẽ bị xoá; tài khoản học sinh được giữ lại (không thuộc lớp nào).', { danger: true, ok: 'Xoá lớp' })) { await del('/classes/' + c.id); location.hash = '#/admin/classes'; } };
    },
  });
  const addSt = $('#addSt', main); if (addSt) addSt.onclick = () => addStudents(c, () => classDetail({ id }));
}
const avgOf = (arr) => { const v = arr.filter((x) => x != null).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
function spark(series) {
  if (!series.length) return '<span class="muted small">—</span>';
  const w = 70, h = 22, n = series.length;
  const pts = series.map((v, i) => `${n === 1 ? w / 2 : (i / (n - 1)) * w},${h - (v / 100) * h}`).join(' ');
  return `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="#3156d3" stroke-width="2"/></svg>`;
}

function slug(name) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim().split(/\s+/);
  if (!base.length || !base[0]) return '';
  const last = base.pop();
  return last + base.map((w) => w[0]).join('');
}
/** Tạo nhiều tài khoản: gửi từng em một (4 em cùng lúc) để mỗi lượt gọi máy chủ luôn nhẹ, gộp kết quả lại. */
async function createUsers(users, btn) {
  const out = { created: [], errors: [] };
  let next = 0, done = 0;
  const label = btn?.textContent;
  const worker = async () => {
    while (next < users.length) {
      const i = next++;
      try {
        const r = await post('/users', { users: [users[i]] });
        out.created.push(...r.created);
        out.errors.push(...r.errors.map((e) => ({ ...e, row: i + 1 })));
      } catch (e) { out.errors.push({ row: i + 1, username: users[i].username, error: e.message }); }
      done++; if (btn && users.length > 1) btn.textContent = `Đang tạo ${done}/${users.length}…`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, users.length) }, worker));
  if (btn) btn.textContent = label;
  out.errors.sort((a, b) => a.row - b.row);
  return out;
}
function addStudents(c, done) {
  modal(`<h2>Thêm học sinh vào lớp ${esc(c.name)}</h2>
    <div class="tabs" id="mt"><button class="on" data-t="one">Từng em</button><button data-t="bulk">Nhập danh sách</button></div>
    <div id="one" class="form-grid"><label class="f">Họ và tên<input id="fn"></label>
      <div class="grid g2"><label class="f">Tên đăng nhập<input id="un"></label><label class="f">Mật khẩu<input id="pw" value="123456"></label></div>
      <label class="f">Gmail của em (không bắt buộc – để đăng nhập bằng Google)<input id="em" type="email" placeholder="ten@gmail.com"></label></div>
    <div id="bulk" class="form-grid" style="display:none">
      <p class="small muted">Mỗi dòng một học sinh: <b>Họ tên, tên đăng nhập, mật khẩu, Gmail</b> (Gmail không bắt buộc – có thì em đăng nhập được bằng Google). Có thể chỉ ghi họ tên – hệ thống tự tạo tên đăng nhập (vd. <i>Nguyễn Văn An → annv${esc(c.name.toLowerCase().replace(/\s/g, ''))}</i>) và mật khẩu mặc định <b>123456</b>. Có thể dán trực tiếp từ Excel.</p>
      <textarea id="bl" rows="10" placeholder="Nguyễn Văn An, annv6a, 123456&#10;Trần Thị Bình&#10;Lê Minh Chi"></textarea></div>
    <div id="res"></div>
    <div class="actions"><button class="btn ghost" data-close>Đóng</button><button class="btn" id="ok">Thêm</button></div>`, {
    onMount: (m, close) => {
      let mode = 'one';
      const suffix = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      m.querySelector('#fn').addEventListener('input', (e) => { m.querySelector('#un').value = slug(e.target.value) + suffix; });
      m.querySelector('#mt').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.t; $$('#mt button', m).forEach((x) => x.classList.toggle('on', x === b)); m.querySelector('#one').style.display = mode === 'one' ? '' : 'none'; m.querySelector('#bulk').style.display = mode === 'bulk' ? '' : 'none'; });
      m.querySelector('#ok').onclick = async () => {
        let users;
        if (mode === 'one') users = [{ fullName: m.querySelector('#fn').value, username: m.querySelector('#un').value, password: m.querySelector('#pw').value, email: m.querySelector('#em').value, classId: c.id }];
        else users = m.querySelector('#bl').value.split('\n').map((l) => l.split(/\t|,|;/).map((x) => x.trim())).filter((p) => p[0])
          .map(([fullName, username, password, email]) => ({ fullName, username: username || slug(fullName) + suffix, password: password || '123456', email: email || '', classId: c.id }));
        if (!users.length) return;
        try {
          const r = await createUsers(users, m.querySelector('#ok'));
          m.querySelector('#res').innerHTML = `<div class="${r.errors.length ? 'warnbox' : 'hint'} mt">Đã tạo ${r.created.length} tài khoản.${r.errors.length ? '<br>Lỗi: ' + r.errors.map((x) => `dòng ${x.row} (${esc(x.username || '')}): ${esc(x.error)}`).join('<br>') : ''}</div>`;
          if (r.created.length) done && setTimeout(() => { if (!r.errors.length) { close(); done(); } }, r.errors.length ? 0 : 600);
          if (r.errors.length && r.created.length) m.querySelector('[data-close]').onclick = () => { close(); done(); };
        } catch (err) { toast(err.message, 'err'); }
      };
    },
  });
}
function editStudent(s, allClasses, done) {
  modal(`<h2>Sửa học sinh</h2><form id="ef" class="form-grid">
    <label class="f">Họ và tên<input name="fullName" value="${esc(s.full_name)}"></label>
    <label class="f">Lớp<select name="classId"><option value="">— Không thuộc lớp —</option>${allClasses.map((c) => `<option value="${c.id}" ${c.id === s.class_id || location.hash.endsWith('/' + c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f">Gmail (để em đăng nhập bằng Google)<input name="email" type="email" value="${esc(s.email || '')}" placeholder="ten@gmail.com"></label>
    <label class="f">Đặt lại mật khẩu (để trống nếu không đổi)<input name="password" placeholder="Mật khẩu mới"></label>
    <label class="row small"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Cho phép đăng nhập</label></form>
    <div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn" id="ok">Lưu</button></div>`, {
    onMount: (m, close) => m.querySelector('#ok').onclick = async () => {
      const f = formData(m.querySelector('#ef'));
      if (!f.password) delete f.password;
      try { await put('/users/' + s.id, f); toast('Đã lưu', 'ok'); close(); done(); } catch (e) { toast(e.message, 'err'); }
    },
  });
}

// ================================================================ HỌC SINH (GV xem)
export async function studentDetail({ id }) {
  layout('<div class="loading">Đang tải…</div>');
  const d = await get('/dashboard/student/' + id);
  const s = d.student;
  const asg = d.attempts.filter((t) => t.kind === 'assignment');
  const avg = avgOf(asg.map((t) => t.percent));
  const first = asg.slice(0, 3), last = asg.slice(-3);
  const delta = asg.length >= 4 ? avgOf(last.map((t) => t.percent)) - avgOf(first.map((t) => t.percent)) : null;
  const weak = d.topics.filter((t) => t.max > 0).map((t) => ({ ...t, p: Math.round((t.earned / t.max) * 100) })).sort((a, b) => a.p - b.p);
  const main = layout(`
    <div class="page-head"><div><div class="crumbs"><a href="#/admin/classes">Lớp</a> / ${s.class_id ? `<a href="#/admin/class/${s.class_id}">${esc(s.class_name)}</a> / ` : ''}${esc(s.full_name)}</div>
      <h1>${esc(s.full_name)}</h1><p>@${esc(s.username)} · ${esc(s.class_name || 'chưa xếp lớp')} · đăng nhập gần nhất ${fmtAgo(s.last_login)}</p></div></div>
    <div class="grid g4 mb">
      <div class="card kpi accent"><span class="v">${score10(avg)}</span><span class="l">điểm TB bài giao (thang 10)</span></div>
      <div class="card kpi"><span class="v">${asg.length}</span><span class="l">lượt làm bài · ${d.pendingAssignments} bài chưa làm</span></div>
      <div class="card kpi"><span class="v">${delta == null ? '—' : (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(delta)) + '%'}</span><span class="l">thay đổi (3 bài đầu → 3 bài gần nhất)</span></div>
      <div class="card kpi"><span class="v">${d.attempts.length - asg.length}</span><span class="l">lượt luyện tập chuyên đề</span></div>
    </div>
    <div class="grid g2 mb"><div class="card"><h3>Tiến trình điểm số</h3><div class="chart-box"><canvas id="prog"></canvas></div></div>
      <div class="card"><h3>Theo chuyên đề</h3>${topicRows(d.topics)}
        ${weak.length ? `<div class="hint mt">Cần củng cố: <b>${weak.slice(0, 3).filter((w) => w.p < 70).map((w) => esc(topicLabel(w.topic))).join(', ') || 'không có chuyên đề nào dưới 70% 👍'}</b></div>` : ''}</div></div>
    <div class="card"><h3>Lịch sử làm bài</h3><div class="table-wrap"><table class="t"><thead><tr><th>Bài</th><th>Loại</th><th>Điểm</th><th>Thang 10</th><th>Nộp lúc</th></tr></thead><tbody>
      ${[...d.attempts].reverse().map((t) => `<tr class="click" data-href="#/admin/attempt/${t.id}"><td>${esc(t.title)}</td><td>${t.kind === 'practice' ? '<span class="chip blue">Luyện tập</span>' : '<span class="chip">Bài giao</span>'}</td>
        <td>${t.score}/${t.max_score} · ${pct(t.percent)}${t.needs_grading ? ' <span class="chip warn">chờ chấm</span>' : ''}</td><td><b>${score10(t.percent)}</b></td><td>${fmtDate(t.submitted_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Chưa làm bài nào</td></tr>'}
    </tbody></table></div></div>`);
  drawProgress($('#prog', main), d.attempts, d.classAvg);
  clickRows(main);
}

// ================================================================ KẾT QUẢ MỘT BÀI GIAO
export async function assignmentResults({ id }) {
  layout('<div class="loading">Đang tải…</div>');
  const d = await get(`/assignments/${id}/results`);
  const a = d.assignment;
  const done = d.students.filter((s) => s.attempts > 0);
  const main = layout(`
    <div class="page-head"><div><div class="crumbs"><a href="#/admin/assignments">Bài đã giao</a> / <a href="#/admin/class/${a.class_id}">${esc(a.class_name)}</a></div>
      <h1>${esc(a.display_title)}</h1><p>Giao ${fmtDate(a.created_at)} · Hạn ${fmtDate(a.due_at)} · ${a.status === 'closed' ? 'Đã đóng' : 'Đang mở'}</p></div>
      <a class="btn ghost" href="#/admin/exam/${a.exam_id}">Xem / sửa đề</a></div>
    <div class="grid g4 mb">
      <div class="card kpi accent"><span class="v">${done.length}/${d.students.length}</span><span class="l">học sinh đã nộp</span></div>
      <div class="card kpi"><span class="v">${score10(avgOf(done.map((s) => s.best_percent)))}</span><span class="l">điểm TB (lần cao nhất)</span></div>
      <div class="card kpi"><span class="v">${done.filter((s) => +s.best_percent >= 80).length}</span><span class="l">em đạt ≥ 8 điểm</span></div>
      <div class="card kpi"><span class="v">${done.filter((s) => +s.best_percent < 50).length}</span><span class="l">em dưới 5 điểm</span></div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>Học sinh</h3><div class="table-wrap"><table class="t"><thead><tr><th>Học sinh</th><th>Lượt</th><th>Cao nhất</th><th>Lần cuối</th><th>Nộp lúc</th></tr></thead><tbody>
        ${d.students.map((s) => `<tr ${s.last_attempt_id ? `class="click" data-href="#/admin/attempt/${s.last_attempt_id}"` : ''}><td>${esc(s.full_name)}${s.needs_grading ? ' <span class="chip warn">chờ chấm</span>' : ''}</td><td>${s.attempts}</td><td>${pct(s.best_percent)}</td><td>${pct(s.last_percent)}</td><td class="small">${s.last_submitted ? fmtAgo(s.last_submitted) : '<span class="chip bad">chưa nộp</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="card"><h3>Phân tích câu hỏi</h3><p class="small muted">Tỉ lệ làm đúng từng câu – các câu khó nhất ở trên cùng.</p><div class="table-wrap" style="max-height:520px;overflow:auto"><table class="t"><thead><tr><th>Câu</th><th>Chuyên đề</th><th>Đúng</th><th></th></tr></thead><tbody>
        ${d.items.map((it) => `<tr><td><b>${esc(it.num ?? '?')}</b></td><td class="small">${esc(topicLabel(it.topic))}</td><td class="small">${it.right_n}/${it.n}</td><td style="min-width:110px">${bar(it.rate)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có dữ liệu</td></tr>'}
      </tbody></table></div></div>
    </div>`);
  clickRows(main);
}

// ================================================================ CHẤM TỰ LUẬN
export async function grading() {
  layout('<div class="loading">Đang tải…</div>');
  const list = await get('/grading/pending');
  const main = layout(`<div class="page-head"><div><h1>Chấm tự luận</h1><p>Các bài có phần viết (email, đoạn văn…) cần giáo viên chấm điểm.</p></div></div>
    <div class="card"><table class="t"><thead><tr><th>Học sinh</th><th>Lớp</th><th>Bài</th><th>Điểm tạm</th><th>Nộp lúc</th></tr></thead><tbody>
    ${list.map((t) => `<tr class="click" data-href="#/admin/attempt/${t.id}"><td><b>${esc(t.full_name)}</b></td><td>${esc(t.class_name || '')}</td><td>${esc(t.title)}</td><td>${t.score}/${t.max_score}</td><td>${fmtAgo(t.submitted_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">🎉 Không còn bài nào chờ chấm</td></tr>'}
    </tbody></table></div>`);
  clickRows(main);
}

// ================================================================ TÀI KHOẢN
export async function users() {
  layout('<div class="loading">Đang tải…</div>');
  const [list, cls] = await Promise.all([get('/users'), get('/classes')]);
  const isAdmin = state.user.role === 'admin';
  let filter = 'staff', q = '';
  const main = layout(`<div class="page-head"><div><h1>Tài khoản</h1><p>Giáo viên, quản trị viên và toàn bộ học sinh</p></div>
    ${isAdmin ? '<button class="btn accent" id="addT">+ Tài khoản giáo viên</button>' : ''}</div>
    <div class="row mb"><div class="seg" id="fs"><button class="on" data-f="staff">Giáo viên / quản trị</button><button data-f="student">Học sinh</button></div><input id="q" placeholder="Tìm tên hoặc tên đăng nhập…" style="max-width:300px"></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Họ tên</th><th>Tên đăng nhập</th><th>Gmail</th><th>Vai trò</th><th>Lớp</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const roleName = { admin: 'Quản trị', teacher: 'Giáo viên', student: 'Học sinh' };
  const draw = () => {
    const rows = list.filter((u) => (filter === 'staff' ? u.role !== 'student' : u.role === 'student'))
      .filter((u) => !q || (u.full_name + ' ' + u.username).toLowerCase().includes(q));
    $('#tb', main).innerHTML = rows.slice(0, 500).map((u) => `<tr><td><b>${esc(u.full_name)}</b>${u.active ? '' : ' <span class="chip bad">khoá</span>'}</td><td>@${esc(u.username)}</td><td class="small">${u.email ? esc(u.email) + (u.google_linked ? ' ✅' : '') : '<span class="muted">—</span>'}</td><td>${roleName[u.role]}</td>
      <td>${u.class_name ? `<a href="#/admin/class/${u.class_id}">${esc(u.class_name)}</a>` : '—'}</td><td class="small">${fmtAgo(u.last_login)}</td>
      <td class="nowrap">${u.role === 'student' ? `<a class="small" href="#/admin/student/${u.id}">Tiến trình</a> · ` : ''}${u.role === 'student' || isAdmin ? `<button class="link-btn small" data-edit="${u.id}">Sửa</button>` : ''}${u.id !== state.user.id && (u.role === 'student' || isAdmin) ? ` · <button class="link-btn danger small" data-del="${u.id}">Xoá</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Không có tài khoản</td></tr>';
  };
  draw();
  $('#fs', main).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; $$('#fs button', main).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  $('#q', main).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
  main.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
    if (ed) {
      const u = list.find((x) => x.id === +ed.dataset.edit);
      if (u.role === 'student') editStudent(u, cls, () => users());
      else modal(`<h2>Sửa tài khoản</h2><form id="ef" class="form-grid"><label class="f">Họ tên<input name="fullName" value="${esc(u.full_name)}"></label>
        <label class="f">Gmail (để đăng nhập bằng Google)<input name="email" type="email" value="${esc(u.email || '')}"></label>
        <label class="f">Vai trò<select name="role"><option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>Giáo viên</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Quản trị viên</option></select></label>
        <label class="f">Mật khẩu mới (để trống nếu không đổi)<input name="password"></label><label class="row small"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Cho phép đăng nhập</label></form>
        <div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn" id="ok">Lưu</button></div>`, {
        onMount: (m, close) => m.querySelector('#ok').onclick = async () => { const f = formData(m.querySelector('#ef')); if (!f.password) delete f.password; try { await put('/users/' + u.id, f); close(); users(); } catch (err) { toast(err.message, 'err'); } },
      });
    }
    if (dl && await confirmBox('Xoá tài khoản này?', { danger: true, ok: 'Xoá' })) { try { await del('/users/' + dl.dataset.del); users(); } catch (err) { toast(err.message, 'err'); } }
  });
  const addT = $('#addT', main);
  if (addT) addT.onclick = () => modal(`<h2>Tạo tài khoản giáo viên</h2><form id="tf" class="form-grid"><label class="f">Họ tên<input name="fullName" required></label>
    <div class="grid g2"><label class="f">Tên đăng nhập<input name="username" required></label><label class="f">Mật khẩu<input name="password" required minlength="6"></label></div>
    <label class="f">Vai trò<select name="role"><option value="teacher">Giáo viên</option><option value="admin">Quản trị viên</option></select></label></form>
    <div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn" id="ok">Tạo</button></div>`, {
    onMount: (m, close) => m.querySelector('#ok').onclick = async () => {
      const f = m.querySelector('#tf'); if (!f.reportValidity()) return;
      try { const r = await post('/users', { users: [formData(f)] }); if (r.errors.length) throw new Error(r.errors[0].error); close(); users(); } catch (err) { toast(err.message, 'err'); }
    },
  });
}

// ================================================================ ĐĂNG KÝ HỌC SINH (chỉ quản trị viên)
export async function registerStudent() {
  layout('<div class="loading">Đang tải…</div>');
  const cls = await get('/classes');
  const made = [];
  const main = layout(`<div class="page-head"><div><h1>Đăng ký học sinh</h1><p>Chỉ quản trị viên tạo được tài khoản. Nhập <b>mã lớp</b> để đưa học sinh vào đúng lớp.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card"><h3>Tài khoản mới</h3>
        <form id="rf" class="form-grid">
          <label class="f">Mã lớp<input name="joinCode" required autocomplete="off" style="text-transform:uppercase;letter-spacing:.1em"><span class="small muted" id="clsName"></span></label>
          <label class="f">Họ và tên<input name="fullName" required></label>
          <div class="grid g2"><label class="f">Tên đăng nhập<input name="username" required pattern="[A-Za-z0-9._\\-]{3,40}" title="3–40 ký tự: chữ không dấu, số, . _ -"></label>
            <label class="f">Mật khẩu (ít nhất 6 ký tự)<input name="password" value="123456" minlength="6" required></label></div>
          <label class="f">Gmail của em (không bắt buộc – để đăng nhập bằng Google)<input name="email" type="email" placeholder="ten@gmail.com"></label>
          <button class="btn accent" id="go">Tạo tài khoản</button>
        </form>
        <div id="made" class="mt"></div>
      </div>
      <div class="card"><h3>Mã các lớp</h3><p class="small muted">Bấm vào một lớp để điền mã.</p>
        <div class="table-wrap"><table class="t"><thead><tr><th>Lớp</th><th>Khối</th><th>Mã lớp</th><th>Học sinh</th></tr></thead><tbody>
        ${cls.map((c) => `<tr class="click" data-code="${esc(c.join_code)}"><td><b>${esc(c.name)}</b></td><td>${gradeName(c.grade)}</td><td><span class="code">${esc(c.join_code)}</span></td><td>${c.student_count}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có lớp – hãy <a href="#/admin/classes">tạo lớp</a> trước.</td></tr>'}
        </tbody></table></div></div>
    </div>`);
  const f = $('#rf', main);
  const byCode = (v) => cls.find((c) => c.join_code.toUpperCase() === String(v).trim().toUpperCase());
  const showCls = () => { const c = byCode(f.joinCode.value); $('#clsName', main).textContent = f.joinCode.value ? (c ? `→ Lớp ${c.name}` : 'Không có lớp nào có mã này') : ''; return c; };
  let touched = false;
  const autoUser = () => { if (touched) return; const c = byCode(f.joinCode.value); f.username.value = f.fullName.value ? slug(f.fullName.value) + (c ? c.name.toLowerCase().replace(/[^a-z0-9]/g, '') : '') : ''; };
  f.joinCode.addEventListener('input', () => { showCls(); autoUser(); });
  f.fullName.addEventListener('input', autoUser);
  f.username.addEventListener('input', () => { touched = !!f.username.value; });
  main.addEventListener('click', (e) => { const tr = e.target.closest('[data-code]'); if (!tr) return; f.joinCode.value = tr.dataset.code; showCls(); autoUser(); f.fullName.focus(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#go', main); if (btn.disabled) return; btn.disabled = true;
    try {
      const r = await post('/users/register', formData(f));
      made.unshift({ ...r.user, password: f.password.value, className: r.class.name });
      toast(`Đã tạo tài khoản cho ${r.user.full_name}`);
      const code = f.joinCode.value, pw = f.password.value;
      f.reset(); f.joinCode.value = code; f.password.value = pw; touched = false; showCls(); f.fullName.focus();
      $('#made', main).innerHTML = `<h3>Vừa tạo</h3><div class="table-wrap"><table class="t"><thead><tr><th>Họ tên</th><th>Lớp</th><th>Tên đăng nhập</th><th>Mật khẩu</th></tr></thead><tbody>
        ${made.map((u) => `<tr><td><b>${esc(u.full_name)}</b>${u.email ? `<div class="small muted">${esc(u.email)}</div>` : ''}</td><td>${esc(u.className)}</td><td>@${esc(u.username)}</td><td><span class="code">${esc(u.password)}</span></td></tr>`).join('')}</tbody></table></div>`;
    } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
  });
}

export { TOPICS };
