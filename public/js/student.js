// Giao diện học sinh
import { get, post } from './api.js';
import { layout, state } from './app.js';
import { esc, toast, fmtDate, fmtAgo, fmtDur, pct, bar, topicLabel, topicRows, chart, score10, $ } from './ui.js';

function statusOf(a) {
  const now = Date.now();
  const overdue = a.due_at && new Date(a.due_at).getTime() < now;
  if (a.in_progress) return { chip: '<span class="chip warn">Đang làm dở</span>', act: 'Làm tiếp', can: true };
  if (a.attempts > 0) {
    const left = a.max_attempts > 0 ? a.max_attempts - a.attempts : Infinity;
    return { chip: `<span class="chip good">Đã nộp · cao nhất ${pct(a.best_percent)}</span>`, act: 'Làm lại', can: left > 0 && !overdue && a.status !== 'closed', done: true };
  }
  if (overdue || a.status === 'closed') return { chip: '<span class="chip bad">Quá hạn</span>', can: false };
  return { chip: '<span class="chip accent">Chưa làm</span>', act: 'Bắt đầu làm', can: true };
}
function assignCard(a) {
  const st = statusOf(a);
  const dueSoon = a.due_at && new Date(a.due_at) - Date.now() < 2 * 86400000 && new Date(a.due_at) > Date.now();
  return `<div class="card assign-card">
    <div class="row between"><span class="t">${esc(a.title)}</span>${st.chip}</div>
    <div class="meta"><span>📝 ${a.question_count} câu</span>${a.time_limit ? `<span>⏱ ${a.time_limit} phút</span>` : ''}
      ${a.due_at ? `<span style="${dueSoon ? 'color:var(--bad);font-weight:600' : ''}">📅 Hạn ${fmtDate(a.due_at)}</span>` : ''}
      ${a.max_attempts ? `<span>🔁 ${a.attempts}/${a.max_attempts} lượt</span>` : ''}</div>
    <div class="row">${(a.topics || []).slice(0, 6).map((t) => `<span class="chip">${esc(topicLabel(t))}</span>`).join('')}</div>
    <div class="row">${st.can ? `<a class="btn ${st.done ? 'ghost' : 'accent'} sm" href="#/do/${a.id}">${st.act}</a>` : ''}
      ${a.last_attempt_id ? `<a class="btn ghost sm" href="#/result/${a.last_attempt_id}">Xem kết quả & lời giải</a>` : ''}</div>
  </div>`;
}

export async function home() {
  layout('<div class="loading">Đang tải…</div>');
  const [list, stats] = await Promise.all([get('/my/assignments'), get('/my/stats')]);
  const todo = list.filter((a) => statusOf(a).can && !statusOf(a).done);
  const done = stats.attempts.filter((t) => t.kind === 'assignment');
  const avg = done.length ? done.reduce((s, t) => s + +t.percent, 0) / done.length : null;
  const weak = stats.topics.filter((t) => t.max > 0).map((t) => ({ ...t, p: (t.earned / t.max) * 100 })).sort((a, b) => a.p - b.p).slice(0, 2);
  const main = layout(`
    <div class="page-head"><div><h1>Chào ${esc(state.user.fullName.split(' ').pop())}! 👋</h1><p>Lớp ${esc(state.cls?.name || '—')} · Cố gắng hoàn thành bài đúng hạn nhé.</p></div>
      <a class="btn accent" href="#/practice">🎯 Luyện chuyên đề</a></div>
    ${!state.user.classId ? '<div class="warnbox mb">Tài khoản của em chưa được xếp lớp. Hãy báo thầy cô.</div>' : ''}
    <div class="grid g4 mb">
      <div class="card kpi accent"><span class="v">${todo.length}</span><span class="l">bài cần làm</span></div>
      <div class="card kpi"><span class="v">${avg == null ? '—' : score10(avg)}</span><span class="l">điểm TB (thang 10)</span></div>
      <div class="card kpi"><span class="v">${done.length}</span><span class="l">lượt làm bài</span></div>
      <div class="card kpi"><span class="v">${stats.attempts.filter((t) => t.kind === 'practice').length}</span><span class="l">lượt luyện tập</span></div>
    </div>
    <div class="grid g2">
      <div>
        <h2>Bài cần làm</h2>
        <div class="grid">${todo.length ? todo.slice(0, 4).map(assignCard).join('') : '<div class="card empty"><div class="big">🎉</div>Em đã làm hết bài được giao!</div>'}</div>
        ${list.length > 4 ? '<p class="mt"><a href="#/assignments">Xem tất cả bài tập →</a></p>' : ''}
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><h3>Tiến bộ của em</h3><div class="chart-box"><canvas id="prog"></canvas></div></div>
        <div class="card"><h3>Chuyên đề</h3>${topicRows(stats.topics)}
          ${weak.length ? `<div class="hint mt">Em nên luyện thêm: ${weak.map((w) => `<a href="#/practice?topic=${w.topic}"><b>${esc(topicLabel(w.topic))}</b></a>`).join(', ')}.</div>` : ''}</div>
      </div>
    </div>`);
  drawProgress($('#prog', main), stats.attempts, stats.classAvg);
}

export function drawProgress(canvas, attempts, classAvg) {
  const list = attempts.filter((t) => t.kind === 'assignment' && t.percent != null);
  if (!list.length) { canvas.parentElement.innerHTML = '<div class="empty small">Làm bài đầu tiên để thấy biểu đồ tiến bộ</div>'; return; }
  chart(canvas, {
    type: 'line',
    data: {
      labels: list.map((t) => fmtDate(t.submitted_at, false)),
      datasets: [
        { label: 'Điểm (%)', data: list.map((t) => +t.percent), borderColor: '#3156d3', backgroundColor: 'rgba(49,86,211,.12)', fill: true, tension: .3, pointRadius: 4 },
        ...(classAvg != null ? [{ label: 'TB lớp', data: list.map(() => classAvg), borderColor: '#ffb84d', borderDash: [6, 4], pointRadius: 0 }] : []),
      ],
    },
    options: { scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (i) => list[i[0].dataIndex].title } } } },
  });
}

export async function assignments() {
  layout('<div class="loading">Đang tải…</div>');
  const list = await get('/my/assignments');
  const groups = { todo: [], done: [], late: [] };
  for (const a of list) { const s = statusOf(a); (s.done ? groups.done : s.can ? groups.todo : groups.late).push(a); }
  layout(`<div class="page-head"><div><h1>Bài tập của lớp</h1><p>Bài thầy cô đã giao cho lớp ${esc(state.cls?.name || '')}</p></div></div>
    ${!list.length ? '<div class="card empty"><div class="big">📭</div>Chưa có bài nào được giao.</div>' : ''}
    ${groups.todo.length ? `<h2>Cần làm (${groups.todo.length})</h2><div class="grid g2 mb">${groups.todo.map(assignCard).join('')}</div>` : ''}
    ${groups.done.length ? `<h2>Đã nộp (${groups.done.length})</h2><div class="grid g2 mb">${groups.done.map(assignCard).join('')}</div>` : ''}
    ${groups.late.length ? `<h2>Đã hết hạn (${groups.late.length})</h2><div class="grid g2">${groups.late.map(assignCard).join('')}</div>` : ''}`);
}

export async function practice() {
  layout('<div class="loading">Đang tải…</div>');
  const topics = await get('/practice/topics');
  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('topic');
  const main = layout(`<div class="page-head"><div><h1>Luyện theo chuyên đề</h1><p>Câu hỏi được lấy ngẫu nhiên từ các bài em đã làm xong hoặc đã hết hạn. Nộp xong có đáp án và giải thích ngay.</p></div></div>
    ${topics.length ? `<div class="grid g3">${topics.sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101)).map((t) => `
      <div class="card assign-card" ${pre === t.topic ? 'style="outline:2px solid var(--accent)"' : ''}>
        <div class="t">${esc(topicLabel(t.topic))}</div>
        <div class="meta"><span>${t.count} câu trong ngân hàng</span><span>Độ chính xác: ${t.accuracy == null ? 'chưa có' : pct(t.accuracy)}</span></div>
        ${t.accuracy != null ? bar(t.accuracy) : ''}
        <div class="row"><select data-n="${t.topic}" style="width:auto"><option value="5">5 câu</option><option value="10" selected>10 câu</option><option value="20">20 câu</option></select>
        <button class="btn accent sm" data-topic="${t.topic}">Bắt đầu</button></div>
      </div>`).join('')}</div>`
    : '<div class="card empty"><div class="big">🎯</div>Chưa có câu hỏi để luyện. Hãy làm xong ít nhất một bài được giao nhé!</div>'}`);
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-topic]');
    if (!b) return;
    b.disabled = true;
    try {
      const n = main.querySelector(`select[data-n="${b.dataset.topic}"]`).value;
      const d = await post('/practice/start', { topic: b.dataset.topic, topicLabel: topicLabel(b.dataset.topic), count: n });
      d.title = 'Luyện tập: ' + topicLabel(b.dataset.topic);
      sessionStorage.setItem('practice.' + d.attemptId, JSON.stringify(d));
      location.hash = '#/practice/do/' + d.attemptId;
    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
  });
}

export async function history() {
  layout('<div class="loading">Đang tải…</div>');
  const stats = await get('/my/stats');
  const list = [...stats.attempts].reverse();
  const main = layout(`<div class="page-head"><div><h1>Kết quả & tiến bộ</h1><p>Tất cả các lần em đã nộp bài</p></div></div>
    <div class="grid g2 mb"><div class="card"><h3>Điểm qua các bài</h3><div class="chart-box"><canvas id="prog"></canvas></div></div>
      <div class="card"><h3>Theo chuyên đề (toàn bộ)</h3>${topicRows(stats.topics)}</div></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Bài</th><th>Loại</th><th>Điểm</th><th>Thang 10</th><th>Thời gian</th><th>Nộp lúc</th></tr></thead><tbody>
    ${list.map((t) => `<tr class="click" data-href="#/result/${t.id}"><td>${esc(t.title)}</td><td>${t.kind === 'practice' ? '<span class="chip blue">Luyện tập</span>' : '<span class="chip">Bài giao</span>'}</td>
      <td>${t.score}/${t.max_score} · ${pct(t.percent)}${t.needs_grading ? ' <span class="chip warn">chờ chấm</span>' : ''}</td><td><b>${score10(t.percent)}</b></td><td>${fmtDur(t.duration_sec)}</td><td>${fmtAgo(t.submitted_at)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Chưa có bài nào</td></tr>'}
    </tbody></table></div></div>`);
  drawProgress($('#prog', main), stats.attempts, stats.classAvg);
  main.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; });
}
