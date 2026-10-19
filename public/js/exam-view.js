// Hiển thị đề: làm bài, xem trước, xem kết quả / chấm tay
import { get, post, put } from './api.js';
import { layout, state } from './app.js';
import { esc, toast, confirmBox, fmtDate, fmtDur, pct, topicLabel, topicRows, driveAudio, debounce, score10, $, $$ } from './ui.js';
import { stripTags } from './parser.js';

const qLabel = (q) => q.num ?? q.label ?? '•';

// ------------------------------------------------------------- render 1 câu
function inputFor(q, value, mode) {
  const dis = mode !== 'take' ? 'disabled' : '';
  const v = value ?? '';
  if (q.type === 'mcq' || q.type === 'tf') {
    return `<div class="opts">${q.options.map((o) => {
      const text = o.html || (q.type === 'mcq' ? '' : o.key);
      return `<label class="opt${v === o.key ? ' sel' : ''}" data-key="${o.key}">
        <input type="radio" name="${q.id}" value="${o.key}" ${v === o.key ? 'checked' : ''} ${dis}><span class="k">${o.key}</span><span>${text}</span></label>`;
    }).join('')}</div>`;
  }
  if (q.type === 'essay') {
    return `<div class="essay"><textarea data-qid="${q.id}" ${dis} placeholder="Viết bài của em ở đây…">${esc(v)}</textarea>
      <div class="small muted wc">${countWords(v)} từ</div></div>`;
  }
  // gap / rewrite
  const lead = q.lead || '';
  if (lead && /_{2,}/.test(lead)) {
    const [a, ...rest] = lead.split(/_{2,}/);
    return `<div class="ans-line"><span>→</span><span class="lead">${esc(a)}</span><input class="inline" data-qid="${q.id}" value="${esc(v)}" ${dis} autocomplete="off" spellcheck="false"><span class="lead">${esc(rest.join(' '))}</span></div>`;
  }
  return `<div class="ans-line">${q.type === 'rewrite' ? '<span>→</span>' : ''}${lead ? `<span class="lead">${esc(lead)}</span>` : ''}
    <input data-qid="${q.id}" value="${esc(v)}" ${dis} autocomplete="off" spellcheck="false" placeholder="${q.type === 'gap' ? 'Điền đáp án' : lead ? 'Viết tiếp câu…' : 'Viết câu hoàn chỉnh…'}"></div>`;
}
const countWords = (s) => (String(s || '').trim().match(/\S+/g) || []).length;

function answerText(q, r) {
  const a = r?.answer ?? q.answer;
  if (!a && !(r?.accepted || q.accepted || []).length) return '';
  if (q.type === 'mcq' || q.type === 'tf') {
    const o = q.options.find((x) => x.key === a);
    return `<b>${esc(a)}</b>${o && stripTags(o.html) ? '. ' + o.html : ''}`;
  }
  // chỉ hiện vài cách viết chính (bỏ các biến thể kiểu "fewer → less")
  const all = (r?.accepted?.length ? r.accepted : q.accepted?.length ? q.accepted : [a]).filter(Boolean);
  const acc = [a, ...all.filter((x) => x !== a && !/(→|->|=>|\s-\s|sửa thành|^xoá |^delete )/.test(x))].filter(Boolean).slice(0, 3);
  return acc.map((x) => `<b>${esc(x)}</b>`).join(' <span class="muted">hoặc</span> ');
}
function givenText(q, given) {
  if (given == null || given === '') return '<i class="muted">(bỏ trống)</i>';
  if (q.type === 'mcq' || q.type === 'tf') { const o = q.options.find((x) => x.key === given); return `${esc(given)}${o && stripTags(o.html) ? '. ' + o.html : ''}`; }
  return esc(given);
}

function reviewBox(q, r, { showAnswers, grading }) {
  if (!r) return '';
  const cls = r.pending ? 'rv-wait' : r.correct ? 'rv-ok' : 'rv-no';
  let html = '';
  if (r.pending) html += `<b>⏳ Chờ giáo viên chấm</b>`;
  else if (r.correct) html += `<b>✅ Đúng</b> <span class="muted">(+${r.earned} điểm)</span>`;
  else if (q.type === 'essay' || r.manual) html += `<b>📝 Giáo viên chấm: ${r.earned}/${r.max} điểm</b>`;
  else html += `<b>❌ Sai.</b> Em chọn/viết: <span class="yours">${givenText(q, r.given)}</span>`;
  if (!r.correct && !r.pending && showAnswers && q.type !== 'essay') html += `<div>Đáp án đúng: ${answerText(q, r) || '<i class="muted">chưa có</i>'}</div>`;
  if (showAnswers && (r.explanation || q.explanation)) html += `<div class="exp">${esc(r.explanation || q.explanation)}</div>`;
  if (r.comment) html += `<div class="exp" style="--x:0">Nhận xét: ${esc(r.comment)}</div>`;
  if (grading) {
    html += `<div class="row mt-s small"><span>Chấm điểm:</span><input type="number" step="0.25" min="0" max="${r.max}" value="${r.earned}" data-grade="${r.id}" style="width:90px"> / ${r.max}
      <input placeholder="Nhận xét (không bắt buộc)" data-comment="${r.id}" value="${esc(r.comment || '')}" style="flex:1;min-width:180px"></div>`;
  }
  return `<div class="review ${cls}">${html}</div>`;
}

export function renderExam(content, { mode = 'take', answers = {}, results = null, showAnswers = false, grading = false, filter = 'all' } = {}) {
  const rmap = results ? Object.fromEntries(results.map((r) => [r.id, r])) : {};
  let lastSection = null;
  let html = '';
  for (const p of content.parts) {
    let qs = p.questions;
    if (results && filter === 'wrong') qs = qs.filter((q) => rmap[q.id] && !rmap[q.id].correct && !rmap[q.id].pending);
    if (results && filter === 'pending') qs = qs.filter((q) => rmap[q.id]?.pending || q.type === 'essay');
    if (!qs.length) continue;
    if (p.section && p.section !== lastSection) { html += `<div class="section-title">${esc(p.section)}</div>`; lastSection = p.section; }
    html += `<div class="card part" id="part-${p.id}">
      <div class="head"><div class="row between"><span class="chip blue">${esc(topicLabel(p.topic))}</span><span class="small muted">${esc(p.title || '')}</span></div>
      <div class="instr mt-s">${esc(p.instruction || '')}</div></div>
      ${p.audioUrl ? `<audio controls preload="none" src="${esc(driveAudio(p.audioUrl))}"></audio>` : ''}
      ${p.passageHtml ? `<div class="passage">${p.passageHtml}</div>` : ''}
      ${qs.map((q) => {
        const r = rmap[q.id];
        const given = results ? r?.given : answers[q.id];
        let body = inputFor(q, given, mode);
        if (results && (q.type === 'mcq' || q.type === 'tf')) {
          body = body.replace(/class="opt( sel)?" data-key="(\w+)"/g, (m0, sel, k) => {
            const isAns = showAnswers && k === r?.answer;
            const isWrong = sel && !r?.correct;
            return `class="opt${sel ? ' sel' : ''}${isAns ? ' right' : ''}${isWrong ? ' wrong' : ''}" data-key="${k}"`;
          });
        }
        return `<div class="q" id="q-${q.id}">
          <div class="stem"><span class="no">${esc(qLabel(q))}</span><div class="stem-text">${q.stemHtml || (q.type === 'gap' ? `<span class="muted">Chỗ trống (${esc(qLabel(q))}) trong bài</span>` : q.type === 'essay' ? '<span class="muted">Bài viết</span>' : '')}
          ${q.keyword ? ` <span class="chip accent">${esc(q.keyword)}</span>` : ''}</div></div>
          ${body}
          ${results ? reviewBox(q, r, { showAnswers, grading }) : ''}
        </div>`;
      }).join('')}
    </div>`;
  }
  return html || '<div class="card empty">Không có câu nào phù hợp bộ lọc.</div>';
}

function navGrid(content, answers, results) {
  const rmap = results ? Object.fromEntries(results.map((r) => [r.id, r])) : null;
  return `<div class="qgrid">${content.parts.flatMap((p) => p.questions).map((q) => {
    let c = '';
    if (rmap) { const r = rmap[q.id]; c = r?.pending ? 'wait' : r?.correct ? 'ok' : 'no'; }
    else if (answers[q.id] != null && String(answers[q.id]).trim() !== '') c = 'done';
    return `<a href="#" data-goto="${q.id}" class="${c}" title="Câu ${esc(qLabel(q))}">${esc(qLabel(q))}</a>`;
  }).join('')}</div>`;
}
function bindGoto(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    document.getElementById('q-' + a.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ------------------------------------------------------------- làm bài
export async function take({ id }) {
  layout('<div class="loading">Đang mở đề…</div>');
  let data;
  try { data = await post(`/my/assignments/${id}/start`); } catch (e) { toast(e.message, 'err'); location.hash = '#/assignments'; return; }
  runExam(data, '#/assignments');
}
export async function takePractice({ id }) {
  const raw = sessionStorage.getItem('practice.' + id);
  if (!raw) { location.hash = '#/practice'; return; }
  runExam(JSON.parse(raw), '#/practice');
}

function runExam(data, backHash) {
  const content = data.content;
  const key = 'ans.' + data.attemptId;
  let answers = { ...(data.answers || {}) };
  try { Object.assign(answers, JSON.parse(localStorage.getItem(key) || '{}')); } catch {}
  const total = content.parts.reduce((s, p) => s + p.questions.length, 0);
  const main = layout(`
    <div class="page-head"><div><div class="crumbs"><a href="${backHash}">← Quay lại</a></div><h1>${esc(data.title)}</h1>
      <p>${total} câu${data.timeLimit ? ` · ${data.timeLimit} phút` : ''}${data.dueAt ? ` · Hạn nộp ${fmtDate(data.dueAt)}` : ''}</p></div></div>
    <div class="exam-layout">
      <div id="paper">${renderExam(content, { mode: 'take', answers })}</div>
      <aside class="exam-nav card">
        <div class="small muted">Thời gian còn lại</div>
        <div class="timer" id="timer">${data.timeLimit ? '--:--' : 'Không giới hạn'}</div>
        <div class="small muted mt-s"><span id="cnt">0</span>/${total} câu đã làm · <span id="saveSt">Đã lưu</span></div>
        <div id="nav">${navGrid(content, answers)}</div>
        <button class="btn accent block" id="submitBtn">Nộp bài</button>
      </aside>
    </div>`);
  const paper = $('#paper', main);
  let submitted = false;
  const updateNav = () => {
    $('#nav', main).innerHTML = navGrid(content, answers);
    $('#cnt', main).textContent = Object.values(answers).filter((v) => String(v ?? '').trim() !== '').length;
  };
  updateNav();
  bindGoto(main);
  const saveServer = debounce(async () => {
    if (submitted) return;
    try { await put(`/attempts/${data.attemptId}/save`, { answers }); $('#saveSt', main).textContent = 'Đã lưu'; }
    catch { $('#saveSt', main).textContent = 'Chưa lưu được (sẽ thử lại)'; }
  }, 2500);
  const onChange = (qid, val) => {
    answers[qid] = val;
    try { localStorage.setItem(key, JSON.stringify(answers)); } catch {}
    $('#saveSt', main).textContent = 'Đang lưu…';
    updateNav();
    saveServer();
  };
  paper.addEventListener('change', (e) => {
    const r = e.target.closest('input[type=radio]');
    if (r) {
      $$(`input[name="${r.name}"]`, paper).forEach((x) => x.closest('.opt').classList.toggle('sel', x.checked));
      onChange(r.name, r.value);
    }
  });
  paper.addEventListener('input', (e) => {
    const el = e.target.closest('[data-qid]');
    if (!el) return;
    if (el.tagName === 'TEXTAREA') el.parentElement.querySelector('.wc').textContent = countWords(el.value) + ' từ';
    onChange(el.dataset.qid, el.value);
  });

  const submit = async (auto = false) => {
    if (submitted) return;
    if (!auto) {
      const done = Object.values(answers).filter((v) => String(v ?? '').trim() !== '').length;
      const ok = await confirmBox(done < total ? `Em còn <b>${total - done}</b> câu chưa làm. Vẫn nộp bài?` : 'Em chắc chắn muốn nộp bài?', { ok: 'Nộp bài' });
      if (!ok) return;
    }
    submitted = true;
    saveServer.cancel();
    const btn = $('#submitBtn', main); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang chấm…';
    try {
      await post(`/attempts/${data.attemptId}/submit`, { answers });
      try { localStorage.removeItem(key); } catch {}
      cleanup();
      if (auto) toast('Hết giờ – bài đã được nộp tự động');
      location.hash = '#/result/' + data.attemptId;
    } catch (e) { submitted = false; btn.disabled = false; btn.textContent = 'Nộp bài'; toast(e.message, 'err'); }
  };
  $('#submitBtn', main).onclick = () => submit(false);

  // đồng hồ
  let timerId = null;
  const offset = data.serverNow ? new Date(data.serverNow).getTime() - Date.now() : 0;
  let deadline = data.timeLimit ? new Date(data.startedAt).getTime() + data.timeLimit * 60000 : null;
  if (data.dueAt) deadline = deadline ? Math.min(deadline, new Date(data.dueAt).getTime()) : null;
  if (deadline) {
    const tick = () => {
      const left = Math.max(0, deadline - (Date.now() + offset));
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      const el = $('#timer');
      if (!el) return;
      el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      el.classList.toggle('low', left < 5 * 60000);
      if (left <= 0) { clearInterval(timerId); submit(true); }
    };
    tick();
    timerId = setInterval(tick, 1000);
  }
  const beforeUnload = (e) => { if (!submitted) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const cleanup = () => { saveServer.cancel(); clearInterval(timerId); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
}

// ------------------------------------------------------------- kết quả
export async function result({ id }) {
  layout('<div class="loading">Đang tải kết quả…</div>');
  const d = await get('/attempts/' + id);
  const staff = state.user.role !== 'student';
  let filter = 'all';
  const content = d.content;
  if (!content) { layout('<div class="card empty">Đề gốc đã bị xoá.</div>'); return; }
  const byTopic = {};
  for (const r of d.results) {
    if (r.pending) continue;
    byTopic[r.topic] ??= { topic: r.topic, earned: 0, max: 0 };
    byTopic[r.topic].earned += +r.earned; byTopic[r.topic].max += +r.max;
  }
  const right = d.results.filter((r) => r.correct).length;
  const wrong = d.results.filter((r) => !r.correct && !r.pending).length;
  const pendingN = d.results.filter((r) => r.pending).length;
  const p = d.percent ?? 0;
  const color = p >= 80 ? 'var(--good)' : p >= 50 ? 'var(--accent-2)' : 'var(--bad)';
  const back = staff ? `#/admin/student/${d.student.id}` : (d.kind === 'practice' ? '#/practice' : '#/assignments');
  const main = layout(`
    <div class="page-head"><div><div class="crumbs"><a href="${back}">← Quay lại</a></div>
      <h1>${esc(d.title || 'Kết quả')}</h1>
      <p>${staff ? `${esc(d.student.fullName)} · ${esc(d.student.className || '')} · ` : ''}Nộp lúc ${fmtDate(d.submittedAt)} · Thời gian làm ${fmtDur(d.durationSec)}</p></div>
      ${staff ? '' : `<a class="btn ghost" href="${d.kind === 'practice' ? '#/practice' : '#/assignments'}">${d.kind === 'practice' ? 'Luyện tiếp' : 'Danh sách bài'}</a>`}
    </div>
    <div class="grid g2 mb">
      <div class="card scorebox">
        <div class="ring" style="--p:${p};--c:${color}"><div><div><b>${score10(p)}</b><br><span class="small muted">/ 10 điểm</span></div></div></div>
        <div>
          <div class="kpi"><span class="v">${d.score} / ${d.maxScore}</span><span class="l">điểm theo đề (${pct(p)})</span></div>
          <div class="row mt-s"><span class="chip good">✓ ${right} đúng</span><span class="chip bad">✗ ${wrong} sai</span>${pendingN ? `<span class="chip warn">⏳ ${pendingN} chờ chấm</span>` : ''}</div>
          ${d.needsGrading ? '<p class="small muted mt-s">Điểm sẽ được cập nhật khi giáo viên chấm phần tự luận.</p>' : ''}
          ${!d.showAnswers ? '<p class="small muted mt-s">Đáp án sẽ được hiển thị sau khi hết hạn nộp bài.</p>' : ''}
        </div>
      </div>
      <div class="card"><h3>Kết quả theo chuyên đề</h3>${topicRows(Object.values(byTopic))}</div>
    </div>
    <div class="row between mb">
      <div class="seg" id="flt"><button data-f="all" class="on">Tất cả</button><button data-f="wrong">Câu sai (${wrong})</button>${pendingN || staff ? `<button data-f="pending">Tự luận / chờ chấm</button>` : ''}</div>
      ${staff ? '<button class="btn good" id="saveGrade">Lưu điểm chấm</button>' : ''}
    </div>
    <div class="exam-layout"><div id="paper"></div><aside class="exam-nav card"><div class="small muted">Bản đồ câu hỏi</div><div id="nav">${navGrid(content, {}, d.results)}</div>
      <div class="small muted"><span class="chip good">đúng</span> <span class="chip bad">sai</span> <span class="chip warn">chờ chấm</span></div></aside></div>`);
  const draw = () => { $('#paper', main).innerHTML = renderExam(content, { mode: 'review', results: d.results, showAnswers: d.showAnswers, grading: staff, filter }); };
  draw();
  bindGoto(main);
  $('#flt', main).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.f; $$('#flt button', main).forEach((x) => x.classList.toggle('on', x === b)); draw();
  });
  if (staff) {
    $('#saveGrade', main).onclick = async () => {
      const items = {};
      for (const inp of $$('[data-grade]', main)) {
        const r = d.results.find((x) => x.id === inp.dataset.grade);
        const comment = $(`[data-comment="${inp.dataset.grade}"]`, main).value;
        if (+inp.value !== +r.earned || comment !== (r.comment || '') || r.pending) items[r.id] = { earned: +inp.value, comment };
      }
      if (!Object.keys(items).length) { toast('Không có thay đổi'); return; }
      try { await post(`/attempts/${d.id}/grade`, { items }); toast('Đã lưu điểm', 'ok'); result({ id }); } catch (e) { toast(e.message, 'err'); }
    };
  }
}

// ------------------------------------------------------------- xem trước (giáo viên)
export async function preview({ id }) {
  const e = await get('/exams/' + id);
  const main = layout(`<div class="page-head"><div><div class="crumbs"><a href="#/admin/exam/${id}">← Sửa đề</a></div><h1>${esc(e.title)}</h1>
    <p>Xem trước giao diện học sinh (có hiện đáp án)</p></div><div class="seg"><button class="on" data-m="s">Như học sinh</button><button data-m="a">Kèm đáp án</button></div></div><div id="paper"></div>`);
  const draw = (m) => {
    const results = m === 'a' ? e.content.parts.flatMap((p) => p.questions.map((q) => ({ id: q.id, correct: true, earned: q.points, max: q.points, given: q.answer, answer: q.answer, accepted: q.accepted, explanation: q.explanation, pending: q.type === 'essay' }))) : null;
    $('#paper', main).innerHTML = renderExam(e.content, { mode: 'preview', results, showAnswers: true });
  };
  draw('s');
  main.querySelector('.seg').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; $$('.seg button', main).forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.m); });
}
