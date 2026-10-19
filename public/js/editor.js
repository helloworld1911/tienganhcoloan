// Ngân hàng đề: tải lên & quét đề, chỉnh sửa, giao bài
import { get, post, put, del, upload } from './api.js';
import { layout } from './app.js';
import { esc, toast, modal, confirmBox, formData, fmtDate, fmtAgo, pct, bar, topicLabel, $, $$ } from './ui.js';
import { TOPICS, QTYPES, htmlToBlocks, textToBlocks, pdfPagesToBlocks, parseExam, attachAnswerKey, finalizeExam, splitEmbeddedKey, summarize, interpretAnswer, stripTags, cleanHtml } from './parser.js';

// ------------------------------------------------------------- đọc file trong trình duyệt
let mammothReady = null;
function loadMammoth() {
  mammothReady ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '/vendor/mammoth.browser.min.js'; s.onload = () => res(window.mammoth); s.onerror = rej; document.head.appendChild(s);
  });
  return mammothReady;
}
async function pdfToBlocks(buf) {
  const pdfjs = await import('/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    await page.getOperatorList(); // nạp font để biết chữ nào in đậm
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => {
      let name = '';
      try { if (page.commonObjs.has(it.fontName)) name = page.commonObjs.get(it.fontName)?.name || ''; } catch { /* bỏ qua */ }
      return { str: it.str, x: it.transform[4], y: Math.round(it.transform[5]), w: it.width, bold: /bold|black|heavy|semibold|,B\b/i.test(name) };
    }));
  }
  const blocks = pdfPagesToBlocks(pages);
  if (blocks.length < 5) throw new Error('PDF này không có lớp chữ (có thể là ảnh scan). Hãy dùng file Word hoặc PDF xuất từ Word.');
  return blocks;
}
/** Thu nhỏ ảnh lớn (tối đa 520px, JPEG) để đề không quá nặng */
function shrinkImage(src) {
  if (src.length < 80_000) return Promise.resolve(src);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 520 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

/** Tải file nghe lên theo từng mảnh. onProgress(0..1). Trả về đường dẫn phát. */
export async function uploadAudio(file, onProgress = () => {}) {
  if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name)) throw new Error('Hãy chọn file âm thanh (.mp3, .m4a, .wav, .ogg)');
  if (file.size > 80 * 1024 * 1024) throw new Error('File nghe phải nhỏ hơn 80MB');
  const m = await post('/media', { name: file.name, size: file.size, mime: file.type || 'audio/mpeg' });
  for (let n = 0; n < m.chunks; n++) {
    const blob = file.slice(n * m.chunkSize, Math.min(file.size, (n + 1) * m.chunkSize));
    let ok = false;
    for (let tries = 0; tries < 3 && !ok; tries++) {
      try { await upload(`/media/${m.id}/${n}`, blob); ok = true; } catch (e) { if (tries === 2) throw e; }
    }
    onProgress((n + 1) / m.chunks);
  }
  return m.url;
}
/** Nhập file nghe từ link (Google Drive, Dropbox…) về máy chủ web để phát ổn định */
export async function importAudioLink(link, onProgress = () => {}) {
  link = String(link || '').trim();
  if (!link || link.startsWith('/api/media/')) return link;
  const m = await post('/media/import', { url: link });
  onProgress(0.02);
  for (let n = 0; n < m.chunks; n++) {
    let ok = false;
    for (let tries = 0; tries < 3 && !ok; tries++) {
      try { await post(`/media/${m.id}/fetch/${n}`); ok = true; } catch (e) { if (tries === 2) throw e; }
    }
    onProgress((n + 1) / m.chunks);
  }
  return m.url;
}
/** Gắn xử lý cho các ô file nghe [data-audio] trong root. onSet(key, url) được gọi khi có file mới. */
export function bindAudioInputs(root, onSet, pending = new Set()) {
  const run = async (box, job, label) => {
    const prog = box.querySelector('[data-aact="prog"]');
    const pick = box.querySelector('[data-aact="pick"]'); pick.disabled = true;
    const p = job((x) => { prog.textContent = `${label} ${Math.round(x * 100)}%`; });
    pending.add(p);
    try { const url = await p; onSet(box.dataset.audio, url); toast('Đã lưu file nghe lên máy chủ web', 'ok'); }
    catch (err) { toast(err.message, 'err'); prog.textContent = '⚠️ ' + err.message; }
    finally { pending.delete(p); pick.disabled = false; }
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aact]'); if (!b) return;
    const box = b.closest('[data-audio]');
    if (b.dataset.aact === 'pick') box.querySelector('[data-aact="file"]').click();
    if (b.dataset.aact === 'clear') onSet(box.dataset.audio, '');
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-aact]'); if (!el) return;
    const box = el.closest('[data-audio]');
    if (el.dataset.aact === 'url') {
      const v = el.value.trim();
      if (!v) { onSet(box.dataset.audio, ''); return; }
      if (v.startsWith('/api/media/')) { onSet(box.dataset.audio, v); return; }
      run(box, (pr) => importAudioLink(v, pr), 'Đang lấy file từ link…');
    }
    if (el.dataset.aact === 'file' && el.files[0]) run(box, (pr) => uploadAudio(el.files[0], pr), 'Đang tải lên…');
  });
  return pending;
}
function audioBox(target, url) {
  return `<div class="audio-box" data-audio="${target}">
    ${url ? `<audio controls preload="none" src="${esc(url)}"></audio>` : '<div class="small muted">Chưa có file nghe</div>'}
    <div class="row small">
      <button type="button" class="btn ghost sm" data-aact="pick">⬆️ ${url ? 'Đổi file nghe' : 'Tải file nghe (mp3)'}</button>
      <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" hidden data-aact="file">
      <input data-aact="url" value="${esc(url || '')}" placeholder="hoặc dán link Google Drive / Dropbox / mp3 rồi bấm ra ngoài" style="flex:1;min-width:200px">
      ${url ? '<button type="button" class="link-btn danger small" data-aact="clear">Bỏ file</button>' : ''}
      <span class="muted" data-aact="prog"></span>
    </div></div>`;
}

export async function fileToBlocks(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === 'docx') {
    const mammoth = await loadMammoth();
    const r = await mammoth.convertToHtml({ arrayBuffer: buf }, {
      styleMap: ['u => u', 'b => b', 'i => i'],
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!/^image\/(png|jpe?g|gif|webp|bmp)$/.test(image.contentType)) return { src: '' }; // ảnh EMF/WMF trình duyệt không hiển thị được
        const b64 = await image.read('base64');
        return { src: await shrinkImage(`data:${image.contentType};base64,${b64}`) };
      }),
    });
    return htmlToBlocks(r.value);
  }
  if (ext === 'pdf') return pdfToBlocks(buf);
  if (ext === 'txt' || ext === 'md') return textToBlocks(new TextDecoder().decode(buf));
  if (ext === 'doc') throw new Error('File .doc (Word 97-2003) chưa hỗ trợ. Mở bằng Word rồi “Lưu thành” .docx nhé.');
  throw new Error('Định dạng chưa hỗ trợ: .' + ext + ' (dùng .docx, .pdf hoặc .txt)');
}

// ------------------------------------------------------------- DANH SÁCH ĐỀ
export async function examList() {
  layout('<div class="loading">Đang tải…</div>');
  const list = await get('/exams');
  let q = '', g = '';
  const grades = [...new Set(list.map((e) => e.grade).filter(Boolean))].sort((a, b) => a - b);
  const main = layout(`<div class="page-head"><div><h1>Ngân hàng đề</h1><p>${list.length} đề · tải lên file Word/PDF, hệ thống tự tách thành các dạng bài</p></div>
    <a class="btn accent" href="#/admin/exams/new">⬆️ Tải đề lên</a></div>
    <div class="row mb"><input id="q" placeholder="Tìm theo tên đề…" style="max-width:320px"><select id="g" style="width:auto"><option value="">Tất cả khối</option>${grades.map((x) => `<option>${x}</option>`).join('')}</select></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Đề</th><th>Khối</th><th>Số câu</th><th>Dạng bài</th><th>Đã giao</th><th>Cập nhật</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const draw = () => {
    const rows = list.filter((e) => (!q || e.title.toLowerCase().includes(q)) && (!g || String(e.grade) === g));
    $('#tb', main).innerHTML = rows.map((e) => `<tr><td><a href="#/admin/exam/${e.id}"><b>${esc(e.title)}</b></a>${e.source_name ? `<br><span class="small muted">${esc(e.source_name)}</span>` : ''}</td>
      <td>${e.grade ?? '—'}</td><td>${e.question_count}<br><span class="small muted">${+e.total_points} điểm</span></td>
      <td style="max-width:320px">${(e.topics || []).map((t) => `<span class="chip" style="margin:1px">${esc(topicLabel(t))}</span>`).join('')}</td>
      <td>${e.assignment_count ? `<span class="chip blue">${e.assignment_count} lớp</span>` : '<span class="muted small">chưa</span>'}</td><td class="small">${fmtAgo(e.updated_at)}</td>
      <td class="nowrap"><a class="btn sm accent" href="#/admin/assignments?exam=${e.id}">Giao bài</a> <a class="btn sm ghost" href="#/admin/exam/${e.id}/preview">Xem</a>
        <button class="link-btn small" data-dup="${e.id}">Nhân bản</button> · <button class="link-btn danger small" data-del="${e.id}">Xoá</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Chưa có đề. Bấm “Tải đề lên” để bắt đầu.</td></tr>';
  };
  draw();
  $('#q', main).oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  $('#g', main).onchange = (e) => { g = e.target.value; draw(); };
  main.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]'), u = e.target.closest('[data-dup]');
    if (d && await confirmBox('Xoá đề này? Các bài đã giao và bài làm của học sinh với đề này cũng bị xoá.', { danger: true, ok: 'Xoá đề' })) { await del('/exams/' + d.dataset.del); examList(); }
    if (u) { const r = await post(`/exams/${u.dataset.dup}/duplicate`); toast('Đã nhân bản', 'ok'); location.hash = '#/admin/exam/' + r.id; }
  });
}

// ------------------------------------------------------------- TẢI ĐỀ LÊN
export function uploadView() {
  const files = { exam: null, key: null };
  const main = layout(`<div class="page-head"><div><div class="crumbs"><a href="#/admin/exams">Ngân hàng đề</a></div><h1>Tải đề lên</h1>
      <p>Hỗ trợ .docx (tốt nhất – giữ được gạch chân cho phần phát âm/tìm lỗi), .pdf có chữ, .txt</p></div></div>
    <div class="tabs" id="mode"><button class="on" data-m="file">Tải file</button><button data-m="paste">Dán văn bản</button></div>
    <div id="fileMode" class="grid g2">
      <div class="card"><h3>1. File đề bài <span class="chip accent">bắt buộc</span></h3><div class="dropzone" data-k="exam"><div class="big">📄</div><div class="file">Kéo thả hoặc bấm để chọn file</div><div class="small muted">.docx · .pdf · .txt</div></div></div>
      <div class="card"><h3>2. File đáp án <span class="chip">không bắt buộc</span></h3><div class="dropzone" data-k="key"><div class="big">✅</div><div class="file">Kéo thả hoặc bấm để chọn file</div><div class="small muted">Dạng danh sách (1. B, 2. C…) hoặc bản sao đề có in đậm đáp án + lời giải thích. Nếu đáp án nằm cuối file đề thì bỏ qua.</div></div></div>
    </div>
    <div id="pasteMode" class="grid g2" style="display:none">
      <div class="card"><h3>Nội dung đề</h3><textarea id="pe" rows="16" placeholder="SECTION I. ...&#10;Part 1. Choose the word...&#10;1. A. ... B. ... C. ... D. ..."></textarea></div>
      <div class="card"><h3>Đáp án</h3><textarea id="pk" rows="16" placeholder="1. B&#10;2. C&#10;36. could&#10;76. Are you good at making friends?"></textarea></div>
    </div>
    <div class="card mt flat"><h3>Tuỳ chọn</h3>
      <label class="row small"><input type="checkbox" id="dropL"> Bỏ phần <b>Nghe</b> (Listening) – để trống nếu muốn giữ, sau khi quét sẽ tải file nghe lên</label>
      <label class="row small mt-s"><input type="checkbox" id="dropW" checked> Bỏ phần <b>Viết đoạn văn / viết thư</b> (tự luận – cần giáo viên chấm)</label>
      <p class="small muted mt-s" style="margin:0">Phần <i>viết lại câu</i>, <i>dựng câu</i> luôn được giữ. Phần Nghe được giữ cùng tranh (câu chọn tranh) và lời thoại trong file đáp án.</p></div>
    <div class="card mt flat" id="audioCard"><h3>🎧 File nghe <span class="chip">không bắt buộc</span></h3>
      <p class="small muted" style="margin-top:0">Tải file mp3 từ máy, hoặc dán link <b>Google Drive</b> (đã chia sẻ “Bất kỳ ai có đường liên kết”) / Dropbox / link mp3 – web sẽ tự lấy file về để học sinh nghe ổn định. Dùng <b>file chung</b> nếu cả đề chỉ có 1 file nghe, hoặc điền riêng cho từng Part.</p>
      <div id="audioRows"><div class="small muted">Chọn file đề ở bước 1 để hiện các phần Nghe (Part 1, Part 2, Part 3…).</div></div></div>
    <div class="hint mt"><b>Mẹo để quét chính xác:</b> mỗi câu bắt đầu bằng số (<i>1.</i> hoặc <i>Câu 1:</i>), mỗi dạng bài có tiêu đề <i>Part 1.</i>/<i>Exercise 1.</i>/<i>I.</i> kèm câu hướng dẫn tiếng Anh (Choose…, Rewrite…, Read…). Đáp án dạng <i>1. B</i>, <i>1-B</i> hoặc bảng “Câu | Đáp án” đều được. Nhiều đáp án đúng cho một câu thì ngăn cách bằng “/” (điền từ) hoặc “|” (viết câu).</div>
    <div class="row mt"><button class="btn accent" id="scan">🔍 Quét đề</button><span class="small muted" id="st"></span></div>
    <input type="file" id="picker" accept=".docx,.pdf,.txt" hidden>`);
  let mode = 'file', pickFor = null;
  $('#mode', main).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; $$('#mode button', main).forEach((x) => x.classList.toggle('on', x === b)); $('#fileMode', main).style.display = mode === 'file' ? '' : 'none'; $('#pasteMode', main).style.display = mode === 'paste' ? '' : 'none'; });
  // ---- file nghe theo từng Part (chọn ngay khi tải đề)
  const audioSel = { all: '', parts: [] };
  let listenParts = [];
  let examCache = null; // { file, blocks }
  const pendingAudio = bindAudioInputs(main.querySelector('#audioCard'), (key, url) => {
    if (key === 'all') audioSel.all = url; else audioSel.parts[+key.slice(1)] = url;
    renderAudioRows();
  });
  const renderAudioRows = () => {
    const rows = [`<div class="audio-row"><b>File nghe chung cho cả đề</b> <span class="small muted">(đĩa nghe là 1 file liền cho tất cả các Part)</span>${audioBox('all', audioSel.all)}</div>`];
    listenParts.forEach((p, i) => rows.push(`<div class="audio-row"><b>🎧 ${esc(p.title || 'Phần ' + (i + 1))}</b> <span class="small muted">– ${esc((p.instruction || '').slice(0, 110))}${(p.instruction || '').length > 110 ? '…' : ''} (${p.questions.length} câu)</span>${audioBox('p' + i, audioSel.parts[i])}</div>`));
    if (!listenParts.length) rows.push('<div class="small muted">Không thấy phần Nghe trong đề (hoặc chưa chọn file đề). Có thể dùng file nghe chung ở trên.</div>');
    main.querySelector('#audioRows').innerHTML = rows.join('');
  };
  const detectListening = async () => {
    try {
      let blocks;
      if (mode === 'file') {
        if (!files.exam) return;
        if (examCache?.file !== files.exam) examCache = { file: files.exam, blocks: await fileToBlocks(files.exam) };
        blocks = examCache.blocks;
      } else blocks = textToBlocks($('#pe', main).value);
      const ex = parseExam(splitEmbeddedKey(blocks).exam, {});
      listenParts = ex.parts.filter((p) => p.topic === 'listening');
      renderAudioRows();
    } catch (e) { console.warn(e); }
  };
  const setFile = (k, f) => {
    files[k] = f; const dz = main.querySelector(`.dropzone[data-k="${k}"]`); dz.querySelector('.file').textContent = '📎 ' + f.name; dz.style.borderColor = 'var(--good)';
    if (k === 'exam') detectListening();
  };
  $('#pe', main).addEventListener('change', detectListening);
  $$('.dropzone', main).forEach((dz) => {
    dz.onclick = () => { pickFor = dz.dataset.k; $('#picker', main).click(); };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) setFile(dz.dataset.k, e.dataTransfer.files[0]); };
  });
  $('#picker', main).onchange = (e) => { if (e.target.files[0]) setFile(pickFor, e.target.files[0]); e.target.value = ''; };
  $('#scan', main).onclick = async () => {
    const st = $('#st', main);
    try {
      if (pendingAudio.size) { st.textContent = 'Đang chờ lấy xong file nghe…'; await Promise.allSettled([...pendingAudio]); }
      let examBlocks, keyBlocks = null, name = 'Đề mới';
      if (mode === 'file') {
        if (!files.exam) { toast('Hãy chọn file đề bài', 'err'); return; }
        st.textContent = 'Đang đọc file…';
        examBlocks = examCache?.file === files.exam ? examCache.blocks : await fileToBlocks(files.exam); name = files.exam.name;
        if (files.key) keyBlocks = await fileToBlocks(files.key);
      } else {
        examBlocks = textToBlocks($('#pe', main).value);
        if ($('#pk', main).value.trim()) keyBlocks = textToBlocks($('#pk', main).value);
      }
      const split = splitEmbeddedKey(examBlocks);
      const exam = parseExam(split.exam, { fileName: name });
      if (!exam.parts.length) throw new Error('Không nhận ra câu hỏi nào. Kiểm tra lại file hoặc dùng chế độ “Dán văn bản”.');
      const kb = keyBlocks || split.key;
      let applied = 0;
      if (kb) applied = attachAnswerKey(exam, kb).count;
      const drop = [$('#dropL', main).checked && 'listening', $('#dropW', main).checked && 'writing'].filter(Boolean);
      const removed = finalizeExam(exam, { drop });
      if (!exam.parts.length) throw new Error('Sau khi bỏ phần Nghe/Viết thì đề không còn câu nào. Bỏ chọn tuỳ chọn để giữ lại.');
      if (removed.questions) toast(`Đã bỏ ${removed.questions} câu thuộc phần bạn chọn bỏ`);
      // gắn file nghe đã chọn: Part Nghe thứ i ↔ ô thứ i
      if (audioSel.all) exam.audioUrl = audioSel.all;
      exam.parts.filter((p) => p.topic === 'listening').forEach((p, i) => { if (audioSel.parts[i]) p.audioUrl = audioSel.parts[i]; });
      exam.sourceName = mode === 'file' ? [files.exam?.name, files.key?.name].filter(Boolean).join(' + ') : 'Dán văn bản';
      sessionStorage.setItem('draftExam', JSON.stringify(exam));
      const sm = summarize(exam);
      toast(`Đã nhận ${sm.total} câu, ${sm.withAns} câu có đáp án`, 'ok');
      location.hash = '#/admin/exam/draft';
    } catch (e) { console.error(e); st.textContent = ''; toast(e.message, 'err'); }
  };
}

// ------------------------------------------------------------- SỬA ĐỀ
const TOPIC_OPTS = (sel) => Object.entries(TOPICS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
const TYPE_OPTS = (sel) => Object.entries(QTYPES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

export async function editExam({ id }) {
  let exam, meta;
  if (id === 'draft') {
    exam = JSON.parse(sessionStorage.getItem('draftExam') || 'null');
    if (!exam) { location.hash = '#/admin/exams/new'; return; }
    meta = { title: exam.title, grade: exam.grade, timeLimit: exam.timeLimit, tags: '', sourceName: exam.sourceName };
  } else {
    layout('<div class="loading">Đang tải…</div>');
    const e = await get('/exams/' + id);
    exam = e.content;
    meta = { title: e.title, grade: e.grade, timeLimit: e.time_limit, tags: e.tags || '', sourceName: e.source_name };
  }
  let dirty = id === 'draft';
  const main = layout(`<div class="page-head"><div><div class="crumbs"><a href="#/admin/exams">Ngân hàng đề</a> / ${id === 'draft' ? 'Đề mới (chưa lưu)' : 'Sửa đề'}</div>
      <h1>${id === 'draft' ? 'Kiểm tra kết quả quét' : 'Sửa đề'}</h1><p>Kiểm tra lại dạng bài, câu hỏi và đáp án trước khi lưu. Câu thiếu đáp án được tô vàng.</p></div>
      <div class="row">${id !== 'draft' ? `<a class="btn ghost" href="#/admin/exam/${id}/preview">👁 Xem trước</a><a class="btn ghost" href="#/admin/assignments?exam=${id}">📮 Giao bài</a>` : ''}<button class="btn ghost" id="dropBtn">✂️ Bỏ phần Viết tự luận</button><button class="btn ghost" id="keyBtn">✅ Nạp file đáp án</button></div></div>
    <div class="card mb"><div class="grid g4">
      <label class="f" style="grid-column:span 2">Tên đề<input id="m_title" value="${esc(meta.title || '')}"></label>
      <label class="f">Khối lớp<select id="m_grade"><option value="">—</option>${Array.from({ length: 12 }, (_, i) => `<option ${meta.grade === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label class="f">Thời gian (phút)<input id="m_time" type="number" min="0" value="${meta.timeLimit ?? ''}" placeholder="không giới hạn"></label>
    </div>
    <div class="mt"><b class="small">🎧 File nghe chung cho cả đề</b> <span class="small muted">(dùng khi đĩa nghe là một file liền cho tất cả các phần Nghe)</span>${audioBox('exam', exam.audioUrl)}</div>
    <div id="sum" class="row mt"></div></div>
    <div id="parts"></div>
    <button class="btn ghost" id="addPart">+ Thêm phần</button>
    <div class="sticky-actions row between"><span class="small muted" id="dirty"></span><div class="row"><button class="btn accent" id="save">💾 Lưu đề</button></div></div>
    <input type="file" id="keyPick" accept=".docx,.pdf,.txt" hidden>`);

  const markDirty = () => { dirty = true; $('#dirty', main).textContent = '● Có thay đổi chưa lưu'; drawSummary(); };
  const drawSummary = () => {
    const s = summarize(exam);
    const missing = s.total - s.withAns;
    $('#sum', main).innerHTML = `<span class="chip blue">${exam.parts.length} phần</span><span class="chip">${s.total} câu</span><span class="chip">${s.points} điểm</span>
      ${missing ? `<span class="chip warn">⚠ ${missing} câu chưa có đáp án</span>` : '<span class="chip good">✓ đủ đáp án</span>'}
      ${Object.entries(s.byTopic).map(([t, n]) => `<span class="chip">${esc(topicLabel(t))}: ${n}</span>`).join('')}`;
  };

  const qHtml = (p, pi, q, qi) => {
    const missing = q.type !== 'essay' && !q.answer;
    let ansField;
    if (q.type === 'mcq' || q.type === 'tf') {
      ansField = `<label class="f">Đáp án đúng<select data-f="answer"><option value="">— chọn —</option>${q.options.map((o) => `<option ${o.key === q.answer ? 'selected' : ''}>${o.key}</option>`).join('')}</select></label>`;
    } else if (q.type === 'essay') {
      ansField = `<label class="f">Bài mẫu / gợi ý chấm (không bắt buộc)<input data-f="answer" value="${esc(q.answer || '')}"></label>`;
    } else {
      ansField = `<label class="f">Đáp án (nhiều đáp án đúng ngăn bằng “ | ”)<input data-f="accepted" value="${esc((q.accepted?.length ? q.accepted : q.answer ? [q.answer] : []).join(' | '))}"></label>`;
    }
    return `<div class="ed-q ${missing ? 'missing' : ''}" data-p="${pi}" data-q="${qi}">
      <div class="numbox"><input data-f="num" value="${esc(q.num ?? q.label ?? '')}" title="Số câu"><button class="link-btn danger small" data-act="delq" title="Xoá câu">xoá</button></div>
      <div class="fields">
        <div class="row"><select data-f="type" style="width:auto">${TYPE_OPTS(q.type)}</select><label class="row small">Điểm <input data-f="points" type="number" step="0.05" min="0" value="${q.points}" style="width:80px"></label>
          ${q.type === 'rewrite' ? `<input data-f="lead" value="${esc(q.lead || '')}" placeholder="Phần đầu cho sẵn (→ …), dùng ___ cho chỗ trống" style="flex:1;min-width:220px">` : ''}</div>
        <div class="rich" contenteditable="true" data-f="stemHtml" data-ph="Đề câu hỏi">${q.stemHtml || ''}</div>
        ${q.type === 'mcq' ? `<div class="opts-ed">${q.options.map((o, oi) => `<div class="o"><b>${o.key}</b><div class="rich grow" contenteditable="true" data-opt="${oi}">${o.html}</div></div>`).join('')}
          <div class="row"><button class="link-btn small" data-act="addopt">+ phương án</button>${q.options.length > 2 ? '<button class="link-btn danger small" data-act="delopt">− bớt</button>' : ''}</div></div>` : ''}
        <div class="grid g2">${ansField}<label class="f">Giải thích (hiện cho học sinh khi sai)<textarea data-f="explanation" rows="2" style="min-height:0">${esc(q.explanation || '')}</textarea></label></div>
      </div></div>`;
  };
  const partHtml = (p, pi) => `<div class="ed-part" data-p="${pi}">
    <div class="ph"><b>${pi + 1}.</b><select data-pf="topic" style="width:auto">${TOPIC_OPTS(p.topic)}</select>
      <input data-pf="title" value="${esc(p.title || '')}" placeholder="Tiêu đề (Part 1…)" style="width:160px">
      <input data-pf="section" value="${esc(p.section || '')}" placeholder="Section" class="grow" style="min-width:160px">
      <span class="small muted">${p.questions.length} câu · ${Math.round(p.questions.reduce((s, q) => s + (+q.points || 0), 0) * 100) / 100}đ</span>
      <button class="link-btn small" data-act="up" title="Lên">▲</button><button class="link-btn small" data-act="down" title="Xuống">▼</button><button class="link-btn danger small" data-act="delp">Xoá phần</button></div>
    <div class="pb">
      <label class="f">Hướng dẫn<textarea data-pf="instruction" rows="2" style="min-height:0">${esc(p.instruction || '')}</textarea></label>
      <details ${p.passageHtml ? 'open' : ''}><summary class="small"><b>Bài đọc / đoạn văn / bảng</b> ${p.passageHtml ? '' : '(trống)'}</summary><div class="rich passage-ed mt-s" contenteditable="true" data-pf="passageHtml">${p.passageHtml || ''}</div></details>
      ${p.topic === 'listening' || p.audioUrl ? `<div><b class="small">🎧 File nghe của phần này</b> <span class="small muted">(bỏ trống nếu dùng file nghe chung của đề)</span>${audioBox(pi, p.audioUrl)}</div>
      <details ${p.transcript ? '' : ''}><summary class="small"><b>Lời thoại (transcript)</b> – học sinh xem được sau khi nộp bài ${p.transcript ? '' : '(trống)'}</summary><textarea data-pf="transcript" rows="6" class="mt-s">${esc(p.transcript || '')}</textarea></details>` : ''}
      <div>${p.questions.map((q, qi) => qHtml(p, pi, q, qi)).join('')}</div>
      <div class="row"><button class="btn ghost sm" data-act="addq">+ Thêm câu</button><label class="small row">Chia đều điểm: <input type="number" step="0.5" min="0" data-act-input="partpts" placeholder="tổng điểm phần" style="width:120px"></label></div>
    </div></div>`;
  const draw = () => { $('#parts', main).innerHTML = exam.parts.map(partHtml).join(''); drawSummary(); };
  draw();

  const partsEl = $('#parts', main);
  const getPQ = (el) => { const qe = el.closest('[data-q]'); const pe = el.closest('[data-p]'); return { p: exam.parts[+pe.dataset.p], q: qe ? exam.parts[+qe.dataset.p].questions[+qe.dataset.q] : null }; };
  partsEl.addEventListener('input', (e) => {
    const el = e.target;
    const { p, q } = getPQ(el);
    if (el.dataset.pf) { p[el.dataset.pf] = el.isContentEditable ? el.innerHTML : el.value; markDirty(); return; }
    if (el.dataset.opt != null) { q.options[+el.dataset.opt].html = cleanHtml(el.innerHTML); markDirty(); return; }
    const f = el.dataset.f;
    if (!f || !q) return;
    if (f === 'stemHtml') q.stemHtml = el.innerHTML;
    else if (f === 'num') { const n = parseInt(el.value, 10); if (Number.isFinite(n)) { q.num = n; delete q.label; } else { q.num = null; q.label = el.value; } }
    else if (f === 'points') q.points = parseFloat(el.value) || 0;
    else if (f === 'accepted') { q.accepted = el.value.split('|').map((s) => s.trim()).filter(Boolean); q.answer = q.accepted[0] || ''; el.closest('.ed-q').classList.toggle('missing', !q.answer); }
    else if (f === 'answer' || f === 'explanation' || f === 'lead') { q[f] = el.value; if (f === 'answer') el.closest('.ed-q').classList.toggle('missing', !q.answer && q.type !== 'essay'); }
    markDirty();
  });
  partsEl.addEventListener('change', (e) => {
    const el = e.target;
    const { p, q } = getPQ(el);
    if (el.dataset.pf === 'topic') { draw(); return; }
    if (el.dataset.f === 'type' && q) {
      q.type = el.value;
      if (q.type === 'tf') q.options = [{ key: 'T', html: 'True' }, { key: 'F', html: 'False' }];
      if (q.type === 'mcq' && q.options.length < 2) q.options = ['A', 'B', 'C', 'D'].map((k) => ({ key: k, html: '' }));
      if (q.type !== 'mcq' && q.type !== 'tf') q.options = [];
      if ((q.type === 'mcq' || q.type === 'tf') && !q.options.some((o) => o.key === q.answer)) q.answer = '';
      draw(); markDirty();
    }
    if (el.dataset.actInput === 'partpts') {
      const tot = parseFloat(el.value);
      if (tot > 0) { const per = Math.round((tot / p.questions.length) * 100) / 100; p.questions.forEach((x) => { x.points = per; }); p.points = tot; draw(); markDirty(); }
    }
  });
  partsEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const pi = +b.closest('[data-p]').dataset.p; const p = exam.parts[pi];
    const qe = b.closest('[data-q]'); const qi = qe ? +qe.dataset.q : null;
    switch (b.dataset.act) {
      case 'delq': p.questions.splice(qi, 1); break;
      case 'addq': {
        const last = p.questions[p.questions.length - 1];
        const maxNum = Math.max(0, ...exam.parts.flatMap((x) => x.questions.map((y) => y.num || 0)));
        const type = last?.type || 'mcq';
        p.questions.push({ id: `${p.id}q${Date.now().toString(36)}`, num: maxNum + 1, type, stemHtml: '', lead: '', options: type === 'mcq' ? ['A', 'B', 'C', 'D'].map((k) => ({ key: k, html: '' })) : type === 'tf' ? [{ key: 'T', html: 'True' }, { key: 'F', html: 'False' }] : [], answer: '', accepted: [], explanation: '', points: last?.points || 1 });
        break;
      }
      case 'addopt': { const q = p.questions[qi]; q.options.push({ key: String.fromCharCode(65 + q.options.length), html: '' }); break; }
      case 'delopt': { const q = p.questions[qi]; const o = q.options.pop(); if (q.answer === o.key) q.answer = ''; break; }
      case 'delp': if (!(await confirmBox(`Xoá phần ${pi + 1} (${p.questions.length} câu)?`, { danger: true, ok: 'Xoá' }))) return; exam.parts.splice(pi, 1); break;
      case 'up': if (pi > 0) [exam.parts[pi - 1], exam.parts[pi]] = [exam.parts[pi], exam.parts[pi - 1]]; break;
      case 'down': if (pi < exam.parts.length - 1) [exam.parts[pi + 1], exam.parts[pi]] = [exam.parts[pi], exam.parts[pi + 1]]; break;
      default: return;
    }
    draw(); markDirty();
  });
  $('#addPart', main).onclick = () => {
    const pid = 'p' + Date.now().toString(36);
    exam.parts.push({ id: pid, section: exam.parts.at(-1)?.section || '', title: 'Phần mới', instruction: '', topic: 'vocabulary_grammar', passageHtml: '', audioUrl: '', questions: [] });
    draw(); markDirty();
  };
  ['m_title', 'm_grade', 'm_time'].forEach((k) => $('#' + k, main).addEventListener('input', markDirty));

  $('#dropBtn', main).onclick = async () => {
    const before = summarize(exam).total;
    const copy = JSON.parse(JSON.stringify(exam));
    finalizeExam(copy);
    const n = before - summarize(copy).total;
    if (!n) { toast('Đề không có phần Viết đoạn văn / thư tự luận'); return; }
    if (!copy.parts.length) { toast('Bỏ xong sẽ không còn câu nào', 'err'); return; }
    if (!(await confirmBox(`Bỏ <b>${n}</b> câu thuộc phần Viết đoạn văn / thư (tự luận)? Muốn bỏ phần Nghe thì bấm “Xoá phần” ở phần đó. (Nhớ bấm Lưu đề sau đó)`, { ok: 'Bỏ' }))) return;
    exam.parts = copy.parts; draw(); markDirty();
  };
  // ---- file nghe (cả đề hoặc từng phần)
  const setAudio = (target, url) => {
    if (target === 'exam') { exam.audioUrl = url; const box = main.querySelector('[data-audio="exam"]'); box.outerHTML = audioBox('exam', url); }
    else { exam.parts[+target].audioUrl = url; draw(); }
    markDirty();
  };
  bindAudioInputs(main, setAudio);
  // nạp đáp án cho đề đã có
  $('#keyBtn', main).onclick = () => $('#keyPick', main).click();
  $('#keyPick', main).onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const blocks = await fileToBlocks(f);
      const n = attachAnswerKey(exam, splitEmbeddedKey(blocks).key || blocks).count;
      toast(`Đã gắn ${n} đáp án từ ${f.name}`, n ? 'ok' : 'err'); draw(); markDirty();
    } catch (err) { toast(err.message, 'err'); }
  };

  $('#save', main).onclick = async () => {
    const body = { title: $('#m_title', main).value.trim() || 'Đề mới', grade: $('#m_grade', main).value || null, timeLimit: $('#m_time', main).value || null, content: exam, sourceName: meta.sourceName, tags: meta.tags };
    const missing = summarize(exam); const miss = missing.total - missing.withAns;
    if (miss && !(await confirmBox(`Còn <b>${miss}</b> câu chưa có đáp án – những câu này sẽ luôn bị chấm sai. Vẫn lưu?`, { ok: 'Vẫn lưu' }))) return;
    const btn = $('#save', main); btn.disabled = true;
    try {
      if (id === 'draft') {
        const r = await post('/exams', body);
        sessionStorage.removeItem('draftExam');
        dirty = false;
        toast('Đã lưu đề vào ngân hàng', 'ok');
        const go = await confirmBox('Đề đã được lưu. Giao bài này cho lớp ngay?', { ok: 'Giao bài' });
        location.hash = go ? `#/admin/assignments?exam=${r.id}` : `#/admin/exam/${r.id}`;
      } else {
        await put('/exams/' + id, body); dirty = false; $('#dirty', main).textContent = '✓ Đã lưu'; toast('Đã lưu', 'ok');
      }
    } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
  };
  const guard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  const off = () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('hashchange', off); };
  window.addEventListener('hashchange', off);
}

// ------------------------------------------------------------- GIAO BÀI
const toLocalInput = (d) => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

function assignForm(exams, classes, a = {}, { pickExam = true, pickClass = true } = {}) {
  return `<form id="af" class="form-grid">
    ${pickExam ? `<label class="f">Đề<select name="examId" required><option value="">— chọn đề —</option>${exams.map((e) => `<option value="${e.id}" ${+a.exam_id === e.id ? 'selected' : ''}>${esc(e.title)}${e.grade ? ` (khối ${e.grade})` : ''}</option>`).join('')}</select></label>` : ''}
    ${pickClass ? `<div class="f"><span style="font-size:.85rem;font-weight:600">Giao cho lớp</span><div class="row">${classes.map((c) => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="cls" value="${c.id}" ${+a.class_id === c.id ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="muted small">Chưa có lớp – hãy tạo lớp trước</span>'}</div></div>` : ''}
    <label class="f">Tên hiển thị cho học sinh (để trống = tên đề)<input name="title" value="${esc(a.title || '')}"></label>
    <div class="grid g2"><label class="f">Mở từ<input type="datetime-local" name="opensAt" value="${toLocalInput(a.opens_at)}"></label>
      <label class="f">Hạn nộp<input type="datetime-local" name="dueAt" value="${toLocalInput(a.due_at)}"></label></div>
    <div class="grid g2"><label class="f">Thời gian làm (phút, trống = theo đề)<input type="number" name="timeLimit" min="0" value="${a.time_limit ?? ''}"></label>
      <label class="f">Số lần làm tối đa (0 = không giới hạn)<input type="number" name="maxAttempts" min="0" value="${a.max_attempts ?? 1}"></label></div>
    <label class="f">Hiện đáp án & giải thích<select name="showAnswers">
      <option value="after_submit" ${a.show_answers === 'after_submit' || !a.show_answers ? 'selected' : ''}>Ngay sau khi nộp bài</option>
      <option value="after_due" ${a.show_answers === 'after_due' ? 'selected' : ''}>Sau khi hết hạn nộp</option>
      <option value="never" ${a.show_answers === 'never' ? 'selected' : ''}>Không hiện (chỉ báo đúng/sai)</option></select></label>
    ${a.id ? `<label class="f">Trạng thái<select name="status"><option value="published" ${a.status !== 'closed' ? 'selected' : ''}>Đang mở</option><option value="closed" ${a.status === 'closed' ? 'selected' : ''}>Đóng (không nhận bài)</option></select></label>` : ''}
  </form>`;
}

export async function assignmentList() {
  layout('<div class="loading">Đang tải…</div>');
  const [list, exams, classes] = await Promise.all([get('/assignments'), get('/exams'), get('/classes')]);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  let cf = qs.get('class') || '';
  const main = layout(`<div class="page-head"><div><h1>Bài đã giao</h1><p>Công bố đề cho lớp – học sinh trong lớp sẽ thấy bài ngay</p></div><button class="btn accent" id="add">+ Giao bài</button></div>
    <div class="row mb"><select id="cf" style="width:auto"><option value="">Tất cả lớp</option>${classes.map((c) => `<option value="${c.id}" ${String(c.id) === cf ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Bài</th><th>Lớp</th><th>Hạn nộp</th><th>Đã nộp</th><th>Điểm TB</th><th>Đáp án</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const showName = { after_submit: 'sau khi nộp', after_due: 'sau hạn', never: 'không hiện' };
  const draw = () => {
    const rows = list.filter((a) => !cf || String(a.class_id) === cf);
    $('#tb', main).innerHTML = rows.map((a) => `<tr><td><a href="#/admin/assignment/${a.id}"><b>${esc(a.display_title)}</b></a>${a.status === 'closed' ? ' <span class="chip bad">đã đóng</span>' : ''}${a.pending_count ? ` <span class="chip warn">${a.pending_count} chờ chấm</span>` : ''}<br><span class="small muted">giao ${fmtDate(a.created_at, false)} · ${a.question_count} câu</span></td>
      <td>${esc(a.class_name)}</td><td class="small">${a.due_at ? fmtDate(a.due_at) : 'không hạn'}</td>
      <td style="min-width:130px"><div class="row" style="gap:8px">${bar(a.student_count ? (a.done_count / a.student_count) * 100 : 0)}<span class="small">${a.done_count}/${a.student_count}</span></div></td>
      <td>${pct(a.avg_percent)}</td><td class="small">${showName[a.show_answers]}</td>
      <td class="nowrap"><a class="small" href="#/admin/assignment/${a.id}">Kết quả</a> · <button class="link-btn small" data-edit="${a.id}">Sửa</button> · <button class="link-btn danger small" data-del="${a.id}">Xoá</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Chưa giao bài nào</td></tr>';
  };
  draw();
  $('#cf', main).onchange = (e) => { cf = e.target.value; draw(); };
  const openNew = (preset = {}) => modal(`<h2>Giao bài cho lớp</h2>${assignForm(exams, classes, preset)}<div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn accent" id="ok">Giao bài</button></div>`, {
    onMount: (m, close) => m.querySelector('#ok').onclick = async () => {
      const f = m.querySelector('#af'); if (!f.reportValidity()) return;
      const d = formData(f);
      d.classIds = $$('input[name=cls]:checked', m).map((x) => +x.value);
      if (!d.classIds.length) { toast('Chọn ít nhất một lớp', 'err'); return; }
      d.opensAt = fromLocalInput(d.opensAt); d.dueAt = fromLocalInput(d.dueAt);
      try { await post('/assignments', d); toast(`Đã giao bài cho ${d.classIds.length} lớp`, 'ok'); close(); if (location.hash !== '#/admin/assignments') location.hash = '#/admin/assignments'; else assignmentList(); } catch (e) { toast(e.message, 'err'); }
    },
  });
  $('#add', main).onclick = () => openNew({ class_id: cf });
  if (qs.get('exam')) openNew({ exam_id: qs.get('exam'), class_id: cf });
  main.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
    if (ed) {
      const a = list.find((x) => x.id === +ed.dataset.edit);
      modal(`<h2>Sửa bài đã giao</h2><p class="muted">${esc(a.exam_title)} → ${esc(a.class_name)}</p>${assignForm(exams, classes, a, { pickExam: false, pickClass: false })}<div class="actions"><button class="btn ghost" data-close>Huỷ</button><button class="btn" id="ok">Lưu</button></div>`, {
        onMount: (m, close) => m.querySelector('#ok').onclick = async () => {
          const d = formData(m.querySelector('#af')); d.opensAt = fromLocalInput(d.opensAt); d.dueAt = fromLocalInput(d.dueAt);
          try { await put('/assignments/' + a.id, d); close(); assignmentList(); } catch (err) { toast(err.message, 'err'); }
        },
      });
    }
    if (dl && await confirmBox('Xoá bài đã giao? Toàn bộ bài làm của học sinh cho bài này cũng bị xoá.', { danger: true, ok: 'Xoá' })) { await del('/assignments/' + dl.dataset.del); assignmentList(); }
  });
}

export { interpretAnswer, stripTags };
