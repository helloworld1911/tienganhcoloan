// ============================================================================
//  Bộ phân tích đề tiếng Anh (chạy được cả trên trình duyệt lẫn Node)
//  Đầu vào: HTML do mammoth sinh ra từ .docx, hoặc văn bản thuần (PDF/TXT)
//  Đầu ra: { title, grade, timeLimit, parts:[{ section, title, instruction,
//            topic, kind, points, passage, audioUrl, questions:[...] }] }
// ============================================================================

export const TOPICS = {
  listening: 'Nghe hiểu',
  pronunciation: 'Phát âm',
  stress: 'Trọng âm',
  vocabulary_grammar: 'Trắc nghiệm từ vựng – ngữ pháp',
  communication: 'Giao tiếp – tình huống',
  synonym_antonym: 'Đồng nghĩa – trái nghĩa',
  verb_form: 'Chia động từ',
  preposition: 'Giới từ',
  word_form: 'Từ loại (word form)',
  error_identification: 'Tìm lỗi sai',
  reading_cloze: 'Đọc điền từ',
  reading_comprehension: 'Đọc hiểu',
  sentence_transformation: 'Viết lại câu',
  sentence_building: 'Sắp xếp / dựng câu',
  writing: 'Viết đoạn / thư',
  other: 'Dạng khác',
};

export const QTYPES = {
  mcq: 'Trắc nghiệm',
  tf: 'Đúng / Sai',
  gap: 'Điền từ',
  rewrite: 'Viết câu',
  essay: 'Tự luận (giáo viên chấm)',
};

// ---------------------------------------------------------------- tiện ích
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export function decode(s) {
  return String(s || '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
export function stripTags(html) {
  return decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/[ \t ]+/g, ' ').trim();
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Chỉ giữ thẻ định dạng an toàn. */
export function cleanHtml(html) {
  return String(html || '')
    // giữ ảnh (tranh trong đề nghe): chỉ giữ thuộc tính src an toàn
    .replace(/<img\b[^>]*?\ssrc="((?:data:image\/[a-z+]+;base64,[^"]+)|(?:https:\/\/[^"]+))"[^>]*>/gi, '<img src="$1">')
    .replace(/<(\/?)(strong|b)>/gi, '<$1b>')
    .replace(/<(\/?)(em|i)>/gi, '<$1i>')
    .replace(/<(?!\/?(u|b|i|sup|sub|br)\b|img src=")[^>]*>/gi, '')
    .replace(/<(u|b|i|sup|sub)\s[^>]*>/gi, '<$1>')
    .replace(/<u>\s*<\/u>/g, '')
    .replace(/[ \t ]+/g, ' ')
    .trim();
}
/** Bỏ thẻ mở/đóng bị lẻ (sau khi cắt chuỗi HTML). */
export function balanceTags(html) {
  const out = [];
  const stack = [];
  const parts = String(html || '').split(/(<\/?(?:u|b|i|sup|sub)>)/i);
  for (const t of parts) {
    const m = t.match(/^<(\/?)(u|b|i|sup|sub)>$/i);
    if (!m) { out.push(t); continue; }
    const tag = m[2].toLowerCase();
    if (!m[1]) { stack.push({ tag, idx: out.length }); out.push(t); continue; }
    const k = stack.map((x) => x.tag).lastIndexOf(tag);
    if (k < 0) continue; // thẻ đóng lẻ
    while (stack.length > k + 1) out[stack.pop().idx] = '';
    stack.pop(); out.push(t);
  }
  for (const x of stack) out[x.idx] = '';
  return out.join('').replace(/<(u|b|i)>\s*<\/\1>/g, '');
}
const trimHtml = (h) => h.replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '');

// ------------------------------------------------- HTML (mammoth) -> blocks
/**
 * blocks: [{ kind:'p'|'li'|'row', text, html, cells? }]
 */
export function htmlToBlocks(html) {
  const blocks = [];
  const pushPara = (inner, kind) => {
    // tách theo <br> (xuống dòng mềm)
    for (const piece of inner.split(/<br\s*\/?>/i)) {
      const h = cleanHtml(piece);
      const t = stripTags(h);
      if (t || /<img /.test(h)) blocks.push({ kind, text: t, html: h });
    }
  };
  // đánh dấu <li> thuộc danh sách đánh số (ol) hay gạch đầu dòng (ul)
  const stack = [];
  const src = String(html || '').replace(/\r/g, '').replace(/<(\/?)(ol|ul)\b[^>]*>|<li\b/gi, (m0, close, tag) => {
    if (tag) { if (close) stack.pop(); else stack.push(tag.toLowerCase()); return m0; }
    return `<li data-k="${stack[stack.length - 1] || 'ol'}"`;
  });
  const re = /<table[\s\S]*?<\/table>|<(p|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].toLowerCase().startsWith('<table')) {
      const rows = m[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        const cells = (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => {
          const inner = c.replace(/^<t[dh]\b[^>]*>|<\/t[dh]>$/gi, '');
          const paras = inner.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [inner];
          const h = paras.map((p) => cleanHtml(p.replace(/<\/?p\b[^>]*>/gi, ''))).filter((x) => stripTags(x) || /<img /.test(x)).join('<br>');
          return { html: h, text: stripTags(h.replace(/<br>/g, '\n')).trim(), lines: paras.map((p) => stripTags(p)).filter(Boolean) };
        });
        if (cells.some((c) => c.text || /<img /.test(c.html))) {
          blocks.push({ kind: 'row', cells, text: cells.map((c) => c.text).filter(Boolean).join(' | '), html: cells.map((c) => c.html).join(' | ') });
        }
      }
    } else {
      const kind = m[1].toLowerCase() === 'li' ? (/data-k="ul"/.test(m[0].slice(0, 20)) ? 'uli' : 'li') : 'p';
      pushPara(m[2], kind);
    }
  }
  return blocks;
}

/**
 * PDF -> blocks. pages: [[{ str, x, y, w, bold }]] (lấy từ pdf.js getTextContent + tên font).
 * Giữ chữ in đậm thành <b> để nhận ra đáp án được tô đậm trong file đáp án PDF.
 */
export function pdfPagesToBlocks(pages) {
  const blocks = [];
  for (const items of pages) {
    const lines = [];
    for (const it of items) {
      if (!it.str) continue;
      let line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let text = '', html = '', end = null, boldOpen = false;
      for (const it of l.items) {
        let piece = it.str;
        if (end != null && it.x - end > 2 && !text.endsWith(' ') && !piece.startsWith(' ')) piece = ' ' + piece;
        const lead = piece.match(/^\s*/)[0];
        const body = piece.slice(lead.length);
        if (!!it.bold !== boldOpen && body.trim()) { html += lead + (it.bold ? '<b>' : '</b>'); boldOpen = !!it.bold; html += escapeHtml(body); }
        else html += escapeHtml(piece);
        text += piece; end = it.x + it.w;
      }
      if (boldOpen) html += '</b>';
      text = text.replace(/[ \t\u00a0]+/g, ' ').trim();
      html = html.replace(/[ \t\u00a0]+/g, ' ').replace(/<\/b>(\s*)<b>/g, '$1').trim();
      if (text) blocks.push({ kind: 'p', text, html, plain: true });
    }
  }
  return blocks;
}

/** Văn bản thuần (PDF, TXT, dán vào) -> blocks */
export function textToBlocks(text) {
  return String(text || '').replace(/\r/g, '').split('\n')
    .map((l) => l.replace(/\\([.!_\-*])/g, '$1').replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .map((t) => ({ kind: 'p', text: t, html: escapeHtml(t), plain: true }));
}

// ------------------------------------------------------------- nhận dạng
const SECTION_RE = /^(?:SECTION|PHẦN|PHAN|PAPER)\s+([IVXLC]+|\d+|[A-H])\b\s*[.:\-–]?\s*(.*)$/i;
const SECTION_ALT_RE = /^(?:[A-H]|[IVX]{1,4})[.)]\s+([A-ZĐ][A-ZĐ&,\- ]{3,}[A-ZĐ])\.?\s*(\(.*\))?\s*$/;
const PART_RE = /^(?:PART|EXERCISE|TASK|BÀI|BAI|DẠNG|QUESTION|CÂU)\s+([IVXLC]+|\d+|[A-H])\s*(?:[.:\-–)]|(?=\(\s*\d))\s*(.*)$/i;
const ROMAN_RE = /^([IVX]{1,5})\s*[.)\-–]\s+(.{8,})$/;
const QNUM_RE = /^(?:Question|Câu|Cau|Q)?\s*(\d{1,3})\s*[.):]\s*(.*)$/i;
const ARROW_RE = /^(?:→|->|=>|⇒|➝|➞|►)\s*(.*)$/;
const LETTERS_ONLY_RE = /^\(?A\)?[\s.]+\(?B\)?[\s.]+\(?C\)?[\s.]+\(?D\)?\.?$/;
const POINTS_RE = /\((\d+(?:[.,]\d+)?)\s*(?:pts?|points?|điểm|marks?)\)/i;
const INSTRUCTION_RE = /^(?:Choose|Mark|Read|Complete|Fill|Give|Put|Rewrite|Re-write|Finish|Write|Find|Identify|Listen|Use|Supply|Rearrange|Reorder|Circle|Match|Decide|Underline|Combine|Select|Pick|Answer|Make|Change|Correct|Look|There\s+(?:are|is)|Chọn|Đọc|Viết|Điền|Hoàn thành|Sắp xếp|Nghe|Tìm|Khoanh)\b/i;
const KEY_HEAD_RE = /^(?:ĐÁP ÁN|DAP AN|ANSWER KEYS?|KEYS?|HƯỚNG DẪN CHẤM|HUONG DAN CHAM)\b/i;
const END_RE = /^[-–—_*\s]*(?:THE END|HẾT|-?\s*HẾT\s*-?)[-–—_*\s]*$/i;
// Phiếu trả lời in sẵn trong đề ("Your answers: 1. ____ 2. ____", bảng Line/Error/Correction) – không phải câu hỏi
const ANSWER_SHEET_RE = /^(?:Your answers?|Answers?|Answer sheet|Đáp án của em|Phần trả lời|Trả lời|Bài làm)\s*:/i;
const isSheetLine = (t) => !String(t).replace(/\b(?:Line|Error|Correction|Câu|Question|Answers?|Đáp án)\b/gi, '').replace(/\d{1,3}\s*[.):]?|[_…|.:\-–\s]/g, '');
const blankRuns = (t) => (String(t).match(/[_…]{3,}|\.{5,}/g) || []).length;
// Phần có "ngân hàng" phương án dùng chung (chọn câu A–G điền vào chỗ trống, ghép tiêu đề A–F với đoạn văn…)
const BANK_INSTR_RE = /headings?\b|from the (?:options|sentences|list)|options? (?:given|below|in the box)|sentences? (?:given )?below|\(?\bA\s*[-–]\s*[A-H]\b\)?|most suitable (?:sentence|option)|\bmatch/i;
const ROMAN_VAL = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
const labelNum = (x) => { const t = String(x || '').toUpperCase(); return /^\d+$/.test(t) ? +t : ROMAN_VAL[t] ?? (/^[A-H]$/.test(t) ? t.charCodeAt(0) - 64 : null); };
const GAP_IN_TEXT_RE = /\((\d{1,3})\)\s*(?:[_….]{2,})?|(?:[_….]{2,})\s*\((\d{1,3})\)/g;

export function detectTopic(text, info = {}) {
  const s = (text || '').toLowerCase();
  if (/listen|nghe|recording|you will hear/.test(s)) return 'listening';
  if (/stress|trọng âm/.test(s)) return 'stress';
  if (/closest in meaning|opposite in meaning|synonym|antonym|đồng nghĩa|trái nghĩa/.test(s)) return 'synonym_antonym';
  if (/pronounc|underlined part|phát âm|sound/.test(s) && !/mistake|error/.test(s)) return 'pronunciation';
  if (/mistake|error|lỗi sai|incorrect|needs? correct|extra word|từ thừa/.test(s)) return 'error_identification';
  if (/using the (?:given )?words|words? given to (?:make|complete|write)|sentence building|cues|sắp xếp|rearrange|reorder|in (?:the )?correct order|meaningful sentence|make (?:complete )?sentences/.test(s)) return 'sentence_building';
  if (/same meaning|means? the same|second sentence|similar|rewrite|re-write|finish (?:each|the)|means? exactly|viết lại|beginning with|given word|word given|keyword|combine|join each pair/.test(s)) return 'sentence_transformation';
  if (/write (?:an?|a short|your)?\s*(?:email|e-mail|letter|paragraph|essay|passage|reply|story|note)|about \d+\s*words|viết (?:đoạn|thư|bài)/.test(s)) return 'writing';
  if (/verbs? (?:given )?in (?:brackets|parentheses)|correct (?:tense|form) of (?:the )?verb|tenses?|chia động từ/.test(s)) return 'verb_form';
  if (/preposition|giới từ/.test(s)) return 'preposition';
  if (/form of the words?|word in (?:block )?capitals|capital letters|word formation|từ loại|dạng đúng của từ/.test(s)) return 'word_form';
  if (/\brespon(?:se|d|ses)\b|exchange|conversation|dialogue|giao tiếp|tình huống/.test(s)) return 'communication';
  if (info.hasPassage && info.hasGaps) return 'reading_cloze';
  if (/passage|read the (?:text|following)|\bread\b.{0,30}\b(?:texts?|articles?|emails?|letters?|advertisements?|notices?)\b|đọc/.test(s)) return info.hasGaps ? 'reading_cloze' : 'reading_comprehension';
  if (/best completes|best option|choose the (?:word|best|correct)|trắc nghiệm/.test(s)) return 'vocabulary_grammar';
  return info.hasOptions ? 'vocabulary_grammar' : 'other';
}

/** Tách "A. xxx B. yyy C. zzz D. ttt" (giữ HTML gạch chân). Trả về {before, options} hoặc null. */
export function splitOptions(html, firstLetter = 'A') {
  const collect = (re) => { const out = []; let m; while ((m = re.exec(html))) out.push({ letter: m[2], start: m.index + m[1].length, end: re.lastIndex }); return out; };
  const best = (marks) => {
    let top = null;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].letter !== firstLetter) continue;
      const seq = [marks[i]];
      let expect = String.fromCharCode(firstLetter.charCodeAt(0) + 1);
      for (let j = i + 1; j < marks.length; j++) {
        if (marks[j].letter === expect) { seq.push(marks[j]); expect = String.fromCharCode(expect.charCodeAt(0) + 1); }
      }
      if (seq.length >= 2 || /^\s*$/.test(stripTags(html.slice(0, seq[0].start)))) { top = seq; break; }
    }
    return top;
  };
  let seq = best(collect(/(^|[\s>(])([A-H])\s*[.)]\s+/g));
  if (!seq || (seq.length < 4 && firstLetter === 'A')) {
    // đề gõ thiếu dấu cách / dấu chấm: "B.Ø/a", "D.the", "D Why not?" – chỉ nhận khi tạo được dãy A B C D trọn vẹn
    const loose = collect(/(^|[\s>(])([A-H])\s*[.)]\s*(?=\S)/g)
      .concat(collect(/(^|[\s>])([C-H])\s+(?=[A-Z“"‘'(])/g)).sort((x, y) => x.start - y.start)
      .filter((x, k, arr) => !k || x.start !== arr[k - 1].start);
    const alt = best(loose);
    if (alt && alt.length >= 4 && alt.length > (seq?.length || 0)) seq = alt;
  }
  if (!seq) return null;
  const options = seq.map((sq, k) => {
    const raw = html.slice(sq.end, k + 1 < seq.length ? seq[k + 1].start : undefined);
    const prefix = html.slice(Math.max(0, sq.start - 12), sq.start);
    // đáp án được in đậm / gạch chân cả phương án (dùng khi đọc file đáp án)
    const marked = /<(b|u)>\s*(<(b|u)>\s*)?$/.test(prefix) || /^\s*<(b|u)>[^<]{1,80}<\/(b|u)>\s*$/.test(raw.replace(/<\/(b|u)>\s*<(b|u)>/g, ''));
    return { key: sq.letter, html: trimHtml(balanceTags(cleanHtml(raw))), ...(marked ? { marked: true } : {}) };
  });
  return { before: trimHtml(balanceTags(html.slice(0, seq[0].start))), options };
}

const ptsOf = (t) => { const m = (t || '').match(POINTS_RE); return m ? parseFloat(m[1].replace(',', '.')) : null; };

/** Phân tích đề. */
export function parseExam(blocks, opts = {}) {
  const exam = { title: opts.fileName ? opts.fileName.replace(/\.[^.]+$/, '') : 'Đề bài mới', grade: null, timeLimit: null, parts: [] };
  let section = '';
  let part = null;
  let q = null;
  let lastNum = 0;
  let headerDone = false;
  let phase = null, romanCtx = null, skipSheet = false, phaseSection = '', romanSection = false; // nhãn phần (Phần 1/2, I/II…) để khớp với đáp án

  const allText = blocks.slice(0, 15).map((b) => b.text).join('\n');
  const g = allText.match(/(?:TIẾNG ANH|TIENG ANH|ENGLISH|LỚP|LOP|GRADE|KHỐI|ANH)\s*(\d{1,2})\b/i);
  if (g && +g[1] >= 1 && +g[1] <= 12) exam.grade = +g[1];
  const tl = allText.match(/(\d{2,3})\s*phút/i) || allText.match(/(\d{2,3})\s*minutes/i);
  if (tl) exam.timeLimit = +tl[1];

  const newPart = (title, instruction) => {
    finishQ();
    part = { section, title: title || '', instruction: instruction || '', points: ptsOf(instruction), passage: [], audioUrl: '', questions: [], _raw: [],
      _phase: phase, _roman: null, _partNo: null, _bankable: BANK_INSTR_RE.test(instruction || ''), _bank: [] };
    exam.parts.push(part);
  };
  const ensurePart = () => { if (!part) newPart('', ''); };
  const finishQ = () => { q = null; };
  const startQ = (num, html) => {
    ensurePart();
    finishQ();
    q = { num, stemHtml: '', lead: '', options: [], answer: '', accepted: [], explanation: '', notes: [] };
    part.questions.push(q);
    lastNum = num;
    const sp = splitOptions(html);
    if (sp && (sp.options.length >= 2) && (sp.before === '' || sp.options.length >= 3)) {
      q.stemHtml = sp.before; q.options = sp.options;
    } else q.stemHtml = trimHtml(balanceTags(html));
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let text = b.text.replace(/\\([.!_\-*])/g, '$1');
    let html = b.html.replace(/\\([.!_\-*])/g, '$1');
    if (KEY_HEAD_RE.test(text) && i > 5) break;          // phần đáp án nằm chung file
    if (END_RE.test(text)) { finishQ(); continue; }
    // Phiếu trả lời in sẵn ("Your answers: 1. ___ 2. ___", bảng Line | Error | Correction): bỏ qua
    if (!opts.keyMode) {
      if (ANSWER_SHEET_RE.test(text)) { finishQ(); skipSheet = true; continue; }
      if (isSheetLine(text) && (skipSheet ? true : blankRuns(text) >= 2)) { finishQ(); continue; }
      skipSheet = false;
    }
    // Lời thoại bài nghe trong file đáp án
    if (opts.keyMode && part && /^(?:TRANSCRIPTS?|TAPESCRIPTS?|AUDIO ?SCRIPTS?|SCRIPT)\s*:?$/i.test(text)) { finishQ(); part._tr = []; continue; }
    if (opts.keyMode && part?._tr && !SECTION_RE.test(text) && !SECTION_ALT_RE.test(text) && !PART_RE.test(text)) { part._tr.push(text); continue; }
    // hướng dẫn bị ngắt dòng (PDF): nối vào dòng hướng dẫn trước
    if (b.plain && part && !q && !part.questions.length && !part.passage.length && part.instruction && !/[.:?!)]\s*$/.test(part.instruction)
        && (!QNUM_RE.test(text) || /\b(?:to|and|or|from|questions?|numbers?|sentences?)\s*$/i.test(part.instruction))
        && !PART_RE.test(text) && !SECTION_ALT_RE.test(text) && !/^example/i.test(text)) {
      part.instruction += ' ' + text; if (!part.points) part.points = ptsOf(part.instruction); continue;
    }

    // Bảng tiêu đề đầu đề thi
    if (!headerDone && b.kind === 'row' && exam.parts.length === 0 && !part) {
      const lines = b.cells.flatMap((c) => c.html.split(/<br\s*\/?>/i).map(stripTags)).filter(Boolean);
      const titleLine = lines.find((l) => /ĐỀ THI|KIỂM TRA|KỲ THI|ĐỀ KHẢO SÁT|ĐỀ ÔN|TEST|EXAM/i.test(l));
      if (titleLine && !opts.keepFileTitle) {
        const subj = lines.find((l) => /^Môn( thi)?\s*:/i.test(l));
        const year = lines.find((l) => /NĂM HỌC\s*\d{4}/i.test(l) && l !== titleLine);
        exam.title = [titleLine.replace(/\s+/g, ' ').trim(), subj && subj.replace(/^Môn( thi)?\s*:\s*/i, ''), year].filter(Boolean).join(' – ');
      }
      continue;
    }

    let m;
    if (/^\d{1,2}$/.test(text)) continue;                  // số trang (PDF)
    if (((m = text.match(SECTION_RE)) && !/^PART\b/i.test(text)) || SECTION_ALT_RE.test(text)) {
      headerDone = true; finishQ();
      section = text; part = null;
      if (m && /^(?:PHẦN|PHAN|SECTION|PAPER)\b/i.test(text)) { phase = labelNum(m[1]); romanCtx = null; phaseSection = text; romanSection = false; }
      else { const r0 = text.match(/^([IVX]{1,4})[.)]/); romanCtx = r0 ? r0[1] : null; romanSection = !!r0; }
      continue;
    }
    if ((m = text.match(PART_RE)) && !(/^(?:CÂU|QUESTION)\s+\d/i.test(text) && QNUM_RE.test(text) && part)) {
      headerDone = true;
      newPart(text.match(/^\S+\s+[IVXLC\dA-H]+/i)[0], m[2] || text);
      part._partNo = labelNum(m[1]); part._roman = romanCtx;
      continue;
    }
    if ((m = text.match(ROMAN_RE)) && INSTRUCTION_RE.test(m[2])) {
      headerDone = true;
      // "II. …" sau nhóm "I. LISTENING": hết nhóm → quay về tiêu đề Phần lớn
      if (romanSection && romanCtx !== m[1]) { section = phaseSection; romanSection = false; }
      newPart(m[1], m[2]); part._roman = romanCtx = m[1]; continue;
    }
    // Phần đầu trang (trước SECTION/Part đầu tiên) -> lấy tiêu đề, bỏ qua
    if (!headerDone && !part && !QNUM_RE.test(text) && !INSTRUCTION_RE.test(text)) {
      if (/ĐỀ THI|KIỂM TRA|KỲ THI|ĐỀ KHẢO SÁT/i.test(text) && !opts.keepFileTitle && exam.title === (opts.fileName || '').replace(/\.[^.]+$/, '')) {
        let t = text.slice(text.search(/ĐỀ THI|KIỂM TRA|KỲ THI|ĐỀ KHẢO SÁT/i)).trim();
        const yr = !/NĂM HỌC/i.test(t) && allText.match(/NĂM HỌC\s*\d{4}\s*[-–]\s*\d{4}/i);
        exam.title = yr ? `${t} – ${yr[0]}` : t;
      }
      continue;
    }
    // Dòng hướng dẫn không có nhãn "Part"
    if (INSTRUCTION_RE.test(text) && text.length > 30 && !QNUM_RE.test(text) && (!part || part.questions.length > 0) && !ARROW_RE.test(text)
        && (!opts.keyMode || /^\s*<b>/.test(html))) {
      if (!(part && part.questions.length && /write|imagine/i.test(text) && false)) {
        headerDone = true; newPart('', text); continue;
      }
    }

    // Câu chọn tranh: hàng ảnh + hàng chữ cái A B C ngay dưới câu hỏi
    if (b.kind === 'row' && q && !q.options.length) {
      const cells = b.cells.filter((c) => c.text || /<img /.test(c.html));
      if (cells.length >= 2 && cells.every((c) => /<img /.test(c.html) && !c.text.replace(/^[A-H][.)]?$/, ''))) {
        q._imgs = cells.map((c) => c.html.replace(/<br>/g, '')); continue;
      }
      const letters = cells.map((c) => c.text.replace(/[.)\s]/g, ''));
      if (cells.length >= 2 && letters.every((l, k) => l === String.fromCharCode(65 + k))) {
        q.options = letters.map((l, k) => ({ key: l, html: q._imgs?.[k] || '', ...(opts.keyMode && /<(b|u)>/.test(cells[k].html) ? { marked: true } : {}) }));
        delete q._imgs; continue;
      }
    }
    if (b.kind === 'row') {
      // bảng trong đề (ví dụ bảng điền thông tin phần nghe)
      ensurePart();
      if (q && part.questions.length) finishQ();
      part.passage.push({ row: b.cells.map((c) => c.html) });
      continue;
    }

    // Dòng chỉ có "A B C D" (dạng tìm lỗi sai)
    if (LETTERS_ONLY_RE.test(text)) {
      if (q) {
        q._errorLetters = true;
        const bl = html.match(/<(?:b|u)>\s*\(?([A-D])\)?\s*<\/(?:b|u)>/);  // đáp án in đậm trên dòng A B C D
        if (bl) q.keyLetter = bl[1];
      }
      continue;
    }

    // Mũi tên viết lại câu
    if ((m = text.match(ARROW_RE))) {
      if (q) {
        let lead = stripTags(m[1]).replace(/_{2,}|…{2,}|\.{4,}/g, ' ___ ').replace(/\s+/g, ' ').trim();
        if (/^(___\s*)*$/.test(lead)) lead = '';
        if (opts.keyMode && q.lead) q.notes.push(text); else q.lead = lead;
      }
      continue;
    }

    // Chỗ trống đánh số giữa dòng: "show on: 16. ______ evening" -> "(16) ______"
    if (/[^\s\d][^\d]*?\b\d{1,3}\.\s*(?:[£$€]\s*)?[_…]{3,}/.test(text) && !QNUM_RE.test(text)) {
      html = html.replace(/(^|[\s:])(\d{1,3})\.\s*((?:[£$€]\s*)?[_…]{3,})/g, '$1($2) $3');
      text = stripTags(html);
    }
    // Câu ví dụ "0." -> đưa vào phần đề, không tính là câu hỏi
    if (/^0\s*[.)]\s/.test(text) && part) { finishQ(); part.passage.push({ html: '<i>' + html + '</i>' }); continue; }
    // Số câu không có dấu chấm: "12 Where does…" (khi đúng thứ tự câu tiếp theo)
    if (!QNUM_RE.test(text) && part && (m = text.match(/^(\d{1,3})\s+([A-Z“"‘].{4,})$/)) && +m[1] === lastNum + 1) {
      text = `${m[1]}. ${m[2]}`; html = html.replace(/^(\s*(?:<[^>]+>)*\s*\d{1,3})\s+/, '$1. ');
    }
    // Ngân hàng phương án dùng chung (A. …, B. … hoặc danh sách tự đánh chữ của Word) trước các câu hỏi
    if (!opts.keyMode && part?._bankable && !q && !part.questions.length) {
      const next = String.fromCharCode(65 + part._bank.length);
      const lm = text.match(/^([A-H])\s*[.)]\s+(.{2,})$/);
      if (b.kind === 'li' || b.kind === 'uli' || (lm && lm[1] === next)) {
        const body = lm && lm[1] === next ? html.replace(/^((?:\s*<[^>]+>)*)\s*[A-H]\s*[.)]\s*/, '$1') : html;
        part._bank.push({ key: next, html: trimHtml(balanceTags(body)) });
        continue;
      }
    }
    // Câu hỏi có số
    if ((m = text.match(QNUM_RE)) && !/^\d{1,3}\s*[.):]\s*\d/.test(text)) {
      const num = +m[1];
      const htmlRest = html.replace(/^\s*(?:<[^>]+>)*\s*(?:Question|Câu|Cau|Q)?\s*\d{1,3}\s*[.):]\s*/i, '');
      startQ(num, htmlRest);
      continue;
    }
    // Danh sách tự đánh số của Word
    if (b.kind === 'li' && part && (opts.keyMode ? blocks[i + 1]?.kind === 'row' : (part.questions.length || part.passage.length === 0))) {
      startQ(lastNum + 1, html); continue;
    }

    // PDF: phương án / đề câu bị ngắt sang dòng sau
    if (q && b.plain && !/^[-–+•(]/.test(text) && !/\(\d{1,3}\)/.test(text) && text.length <= 80) {
      const lastOpt = q.options[q.options.length - 1];
      const nextLetter = String.fromCharCode(65 + q.options.length);
      const isOptLine = splitOptions(html, nextLetter)?.before === '';
      if (lastOpt && !isOptLine && !/[.?!)"”]\s*$/.test(stripTags(lastOpt.html)) && (!opts.keyMode || !q.notes.length)) {
        lastOpt.html = /-$/.test(lastOpt.html) ? lastOpt.html + html : `${lastOpt.html} ${html}`; continue;
      }
      if (opts.keyMode && !q.options.length && !q.notes.length && !isOptLine && !/[.?!:]\s*$/.test(stripTags(q.stemHtml))) {
        q.stemHtml += ' ' + html; continue;
      }
    }
    // Dòng phương án nối tiếp câu hỏi
    if (q) {
      const nextLetter = String.fromCharCode(65 + q.options.length);
      const sp = splitOptions(html, nextLetter);
      if (sp && sp.before === '' && sp.options.length && b.kind !== 'uli') { q.options.push(...sp.options); continue; }
      if (opts.keyMode) {
        // trong file đáp án: các dòng sau câu hỏi là lời giải thích (trừ đoạn văn có chỗ trống)
        if (!/\(\d{1,3}\)\s*[_…]{2,}/.test(text)) { q.notes.push(text); continue; }
      } else if (!q.options.length && b.kind !== 'uli') { q.stemHtml += (q.stemHtml ? (b.plain ? ' ' : '<br>') : '') + html; continue; }
    }
    // Còn lại: đoạn văn / bài đọc / đề bài viết
    ensurePart();
    if (q) finishQ();
    const last = part.passage[part.passage.length - 1];
    if (b.plain && last && last.plain && last.len >= 60) { last.html += ' ' + html; last.len = text.length; }
    else part.passage.push({ html, plain: !!b.plain, len: text.length });
  }

  // ---------------------------------------------------- hậu xử lý từng phần
  let wId = 0;
  for (const p of exam.parts) {
    const passageText = p.passage.map((x) => x.row ? x.row.map(stripTags).join(' ') : stripTags(x.html)).join('\n');
    // các chỗ trống được đánh số trong bài đọc / bảng
    const gapNums = [];
    let gm;
    GAP_IN_TEXT_RE.lastIndex = 0;
    while ((gm = GAP_IN_TEXT_RE.exec(passageText))) gapNums.push(+(gm[1] || gm[2]));
    const qNums = new Set(p.questions.map((x) => x.num));
    const missingGaps = gapNums.filter((n) => !qNums.has(n));
    if (missingGaps.length) {
      for (const n of missingGaps) p.questions.push({ num: n, stemHtml: '', lead: '', options: [], answer: '', accepted: [], explanation: '', _gap: true });
      p.questions.sort((a, b) => a.num - b.num);
    }
    // ngân hàng phương án dùng chung → phương án cho từng câu (hoặc trả lại thành câu hỏi nếu phần không có câu nào)
    if (p._bank?.length >= 2) {
      const noOpt = p.questions.filter((x) => !x.options.length);
      if (noOpt.length) { for (const x of noOpt) x.options = p._bank.map((o) => ({ ...o })); p._bankUsed = true; }
      else if (!p.questions.length) p.questions = p._bank.map((o, k) => ({ num: k + 1, stemHtml: o.html, lead: '', options: [], answer: '', accepted: [], explanation: '' }));
    } else if (p._bank?.length === 1 && !p.questions.length) {
      p.passage.unshift({ html: p._bank[0].html });
    }
    delete p._bank; delete p._bankable;
    if (!p.points) p.points = ptsOf(passageText);
    p.passageRaw = p.passage.map((x) => (x.row ? x.row.join(' | ') : x.html)).join('\n');
    // Dạng ghép: các đoạn có tiêu đề "A. Jeanne", "B. Laura"… và câu hỏi không có phương án
    const heads = p.passage.filter((x) => !x.row).map((x) => stripTags(x.html).match(/^([A-H])[.)]\s+([^.!?]{1,40})$/)).filter(Boolean);
    const noOpt = p.questions.filter((x) => x.options.length === 0);
    if (heads.length >= 2 && heads.every((h, k) => h[1] === String.fromCharCode(65 + k)) && noOpt.length >= 2 && noOpt.length >= p.questions.length / 2) {
      for (const x of noOpt) x.options = heads.map((h) => ({ key: h[1], html: escapeHtml(h[2].trim()) }));
      p._matching = true;
    }
    const hasOptions = p.questions.some((x) => x.options.length >= 2);
    const info = { hasPassage: p.passage.length > 0 && passageText.length > 120, hasGaps: gapNums.length > 0, hasOptions };
    const sectionTopic = detectTopic(p.section, info);
    let topic = detectTopic(p.instruction, info);
    if (topic === 'other' || (sectionTopic === 'listening')) topic = sectionTopic !== 'other' ? sectionTopic : topic;
    if (topic === 'other') topic = detectTopic(p.instruction + ' ' + passageText, info);
    if (p.questions.length === 0 && /write|viết/i.test(p.instruction + ' ' + passageText)) topic = 'writing';
    if (topic === 'other' && p.questions.length === 0) topic = 'writing';
    if (p._matching && !['listening'].includes(topic)) topic = 'reading_comprehension';
    p.topic = topic;

    const isTF = /true.*false|\(T\)|\bT\s*\/\s*F\b|đúng.*sai|not given/i.test(p.instruction);
    // phân loại câu
    for (const qq of p.questions) {
      const stemText = stripTags(qq.stemHtml);
      if (qq._errorLetters || (topic === 'error_identification' && qq.options.length === 0)) {
        const us = [...qq.stemHtml.matchAll(/<u>([\s\S]*?)<\/u>/g)].map((x) => stripTags(x[1]));
        qq.options = ['A', 'B', 'C', 'D'].map((k, i) => ({ key: k, html: us.length === 4 ? escapeHtml(us[i]) : '' }));
        if (us.length === 4) {
          let idx = 0; // gắn chữ cái lên phần gạch chân
          qq.stemHtml = qq.stemHtml.replace(/<u>([\s\S]*?)<\/u>/g, (_, inner) => `<u>${inner}</u><sup class="mk">${'ABCD'[idx++]}</sup>`);
        }
        qq.type = 'mcq';
      } else if (isTF) {
        qq.type = 'tf';
        qq.options = /not given/i.test(p.instruction)
          ? [{ key: 'T', html: 'True' }, { key: 'F', html: 'False' }, { key: 'NG', html: 'Not Given' }]
          : [{ key: 'T', html: 'True' }, { key: 'F', html: 'False' }];
      } else if (qq.options.length >= 2) qq.type = 'mcq';
      else if (topic === 'writing' && !qq._gap) qq.type = 'essay';
      else if (topic === 'sentence_transformation' || topic === 'sentence_building' || qq.lead || (/→|=>/.test(stemText))) qq.type = 'rewrite';
      else qq.type = 'gap';
      if (qq.type === 'rewrite') {
        const kw = stemText.match(/\(([A-Z][A-Z' -]{1,20})\)\s*$/);
        if (kw) qq.keyword = kw[1].trim();
      }
      if (qq.type === 'gap') {
        const w = stemText.match(/\(([A-Z][A-Z]{1,20})\)\s*\.?$/); // từ gốc dạng word form
        if (w) qq.baseWord = w[1];
      }
      delete qq._errorLetters; delete qq._gap;
      if (!opts.keyMode) { delete qq.notes; qq.options.forEach((o) => delete o.marked); }
    }
    // Phần không có câu hỏi -> bài viết tự luận
    if (p.questions.length === 0 && (topic === 'writing' || passageText.length > 0 || p.instruction)) {
      wId++;
      p.questions.push({ num: null, label: `W${wId}`, type: 'essay', stemHtml: '', lead: '', options: [], answer: '', accepted: [], explanation: '' });
    }
    p.kind = p.questions.length ? p.questions[0].type : 'essay';
    // điểm
    const n = p.questions.length || 1;
    const per = p.points ? Math.round((p.points / n) * 100) / 100 : 1;
    p.questions.forEach((x) => { x.points = x.type === 'essay' && !p.points ? 10 : per; });
    // bài đọc -> html
    p.passageHtml = renderPassage(p.passage);
    p.title = p.title || TOPICS[p.topic];
    p.instruction = p.instruction.replace(POINTS_RE, '').replace(/^[\s.:\-–)]+/, '').replace(/\s*\.\s*\.\s*$/, '.').replace(/\s+([.,])/g, '$1').trim();
    if (p._tr) { p.transcript = p._tr.join('\n'); delete p._tr; }
    delete p.passage; delete p._raw;
  }
  exam.parts = exam.parts.filter((p) => p.questions.length);
  exam.parts.forEach((p, i) => { p.id = `p${i + 1}`; p.questions.forEach((x, j) => { x.id = `${p.id}q${j + 1}`; }); });
  return exam;
}

function renderPassage(items) {
  let out = '';
  let rows = [];
  const flush = () => { if (rows.length) { out += `<table class="ptable">${rows.map((r) => `<tr>${r.map((c) => `<td>${gapify(c)}</td>`).join('')}</tr>`).join('')}</table>`; rows = []; } };
  for (const it of items) {
    if (it.row) rows.push(it.row);
    else { flush(); out += `<p>${gapify(it.html)}</p>`; }
  }
  flush();
  return out;
}
/** đánh dấu chỗ trống (56) ____ thành <span class="gap">(56)</span> */
function gapify(html) {
  return html.replace(/\((\d{1,3})\)\s*(?:[_….]{2,})?/g, '<span class="gap" data-n="$1">($1)</span>').replace(/(?:_{3,}|…{2,}|\.{5,})/g, '<span class="blank">______</span>');
}

// ------------------------------------------------------------------ ĐÁP ÁN
/** Tách phần đáp án nằm chung trong file đề (nếu có). */
export function splitEmbeddedKey(blocks) {
  const idx = blocks.findIndex((b, i) => i > 5 && KEY_HEAD_RE.test(b.text));
  if (idx < 0) return { exam: blocks, key: null };
  return { exam: blocks.slice(0, idx), key: blocks.slice(idx) };
}

/**
 * Đọc file đáp án -> Map(số câu -> chuỗi đáp án thô)
 * Hỗ trợ: "1. B", "1-B", "Câu 1: B", "1. B 2. C 3. A" trên cùng dòng,
 * bảng dọc (Câu | Đáp án) và bảng ngang (hàng số câu + hàng đáp án).
 */
export function parseAnswerKey(blocks, expected = null) {
  const map = new Map();
  const ok = (n) => !expected || expected.has(n);
  const put = (n, v) => { v = String(v || '').trim(); if (ok(n) && v && !map.has(n)) map.set(n, v); };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'row') {
      const cells = b.cells.map((c) => c.text.trim());
      const nums = cells.map((c) => (/^(?:Câu|Question|Q)?\s*(\d{1,3})\s*[.:)]?$/i.exec(c) || [])[1]);
      const numCount = nums.filter(Boolean).length;
      const next = blocks[i + 1];
      // bảng ngang: hàng này toàn số câu, hàng sau là đáp án
      if (numCount >= 2 && numCount >= cells.length - 1 && next && next.kind === 'row' && next.cells.length === cells.length) {
        next.cells.forEach((c, k) => { if (nums[k]) put(+nums[k], c.text); });
        i++; continue;
      }
      // bảng dọc: cặp (số, đáp án) xen kẽ
      let handled = false;
      for (let k = 0; k + 1 < cells.length; k++) {
        if (nums[k] && cells[k + 1] && !nums[k + 1]) { put(+nums[k], cells[k + 1]); handled = true; k++; }
      }
      if (handled) continue;
      scanLine(b.text.replace(/\s*\|\s*/g, '  '), put);
      continue;
    }
    if (SECTION_RE.test(b.text) || PART_RE.test(b.text) || KEY_HEAD_RE.test(b.text)) continue;
    const next = blocks[i + 1];
    // "1" xuống dòng "C" (bảng bị mất cấu trúc khi xuất văn bản)
    if (/^\d{1,3}$/.test(b.text) && next && !/^\d{1,3}$/.test(next.text) && next.text.length < 60) { put(+b.text, next.text); i++; continue; }
    // "1 2 3 4 5" xuống dòng "C A B B A"
    if (/^(\d{1,3}\s+){1,}\d{1,3}$/.test(b.text) && next) {
      const ns = b.text.split(/\s+/), vs = next.text.split(/\s+/);
      if (ns.length === vs.length) { ns.forEach((n, k) => put(+n, vs[k])); i++; continue; }
    }
    scanLine(b.text, put);
  }
  return map;
}
function scanLine(text, put) {
  text = text.replace(/\\([.!_\-*])/g, '$1');
  const re = /(?:^|[\s,;])(?:Câu|Cau|Question|Q)?\s*(\d{1,3})\s*(?:[.):]|[-–](?!\d)|,(?=\s*\(?[A-H]\)?(?:[\s.,;]|$)))\s*/gi;
  const marks = [];
  let m;
  while ((m = re.exec(text))) {
    // tránh nhận nhầm số trong nội dung như "7 a.m." hoặc "8.50"
    if (/\d/.test(text[re.lastIndex] || '') && !/\s/.test(text[re.lastIndex - 1])) continue;
    marks.push({ n: +m[1], s: m.index, e: re.lastIndex });
  }
  // chỉ giữ dãy số tăng dần
  const seq = [];
  for (const mk of marks) if (!seq.length || mk.n > seq[seq.length - 1].n) seq.push(mk);
  seq.forEach((mk, k) => put(mk.n, text.slice(mk.e, k + 1 < seq.length ? seq[k + 1].s : undefined).replace(/[\s,;]+$/, '')));
}

/** Gắn đáp án vào đề. Trả về số câu đã gắn. */
export function applyAnswerKey(exam, map) {
  let count = 0;
  for (const p of exam.parts) for (const q of p.questions) {
    if (q.num == null || !map.has(q.num)) continue;
    const raw = map.get(q.num).replace(/^[\s:→\-–]+/, '').trim();
    Object.assign(q, interpretAnswer(q, raw));
    count++;
  }
  return count;
}

export function interpretAnswer(q, raw) {
  const out = { answer: '', accepted: [], explanation: q.explanation || '' };
  if (q.type === 'mcq') {
    const m = raw.match(/^\(?([A-H])\)?(?:[.):\s]|$)\s*([\s\S]*)$/);
    if (m) {
      out.answer = m[1];
      let rest = m[2].trim();
      const opt = q.options.find((o) => o.key === m[1]);
      if (opt && rest && stripTags(opt.html) && rest.toLowerCase().startsWith(stripTags(opt.html).toLowerCase())) rest = rest.slice(stripTags(opt.html).length).trim();
      rest = rest.replace(/^[(\-–:]\s*|\)$/g, '').trim();
      if (rest) out.explanation = rest;
    } else out.answer = raw.slice(0, 1).toUpperCase();
  } else if (q.type === 'tf') {
    const m = raw.match(/^(T|F|NG|True|False|Not Given|Đúng|Sai)\b\s*([\s\S]*)$/i);
    const v = m ? m[1].toLowerCase() : raw.toLowerCase();
    out.answer = /^(t|true|đúng)/.test(v) ? 'T' : /^(ng|not)/.test(v) ? 'NG' : 'F';
    if (m && m[2].trim()) out.explanation = m[2].replace(/^[(\-–:]\s*|\)$/g, '').trim();
  } else {
    // text: tách các đáp án chấp nhận được
    let main = raw;
    const ex = main.match(/\s*(?:\((?:giải thích|vì|because|explain)[^)]*\)|(?:Giải thích|Explanation)\s*:.*)$/i);
    if (ex) { out.explanation = ex[0].replace(/^\s*\(|\)$|^(?:\s*Giải thích|\s*Explanation)\s*:/gi, '').trim(); main = main.slice(0, ex.index); }
    const parts = q.type === 'gap'
      ? main.split(/\s*\/\s*|\s*\|\s*|\s+OR\s+|\s+hoặc\s+|\s*;\s*/i)
      : main.split(/\s*\|\s*|\s+OR\s+|\s+hoặc\s+|\n/i);
    let acc = parts.map((s) => s.replace(/^(?:→|->|=>)\s*/, '').trim()).filter(Boolean);
    acc = [...new Set(acc.flatMap(expandVariants))].slice(0, 24);
    out.answer = acc[0] || '';
    out.accepted = acc;
  }
  return out;
}

/** Thống kê nhanh để hiển thị sau khi quét */
export function summarize(exam) {
  const byTopic = {};
  let total = 0, withAns = 0, points = 0;
  for (const p of exam.parts) for (const q of p.questions) {
    total++; points += +q.points || 0;
    if (q.answer || q.type === 'essay') withAns++;
    byTopic[p.topic] = (byTopic[p.topic] || 0) + 1;
  }
  return { total, withAns, points: Math.round(points * 100) / 100, byTopic };
}


// ======================================================= ĐÁP ÁN DẠNG "BẢN SAO ĐỀ"
// File đáp án là chính đề bài nhưng: phương án đúng in đậm/gạch chân, đáp án điền
// ghi ngay vào chỗ trống, câu viết lại ghi đủ sau "→", kèm lời giải thích bên dưới.
const normInstr = (s) => stripTags(s).toLowerCase().replace(/\(\s*\d+[.,]?\d*\s*(?:pts?|points?|điểm|marks?)\s*\)\.?/g, '').replace(/[^a-z0-9]/g, '').slice(0, 60);
const textOf = (h) => stripTags(String(h || '').replace(/<br\s*\/?>/gi, ' '));

function alignParts(exam, key) {
  const pairs = new Map();
  let j0 = 0;
  exam.parts.forEach((p, i) => {
    const a = normInstr(p.instruction);
    if (a.length < 12) return;
    for (let j = j0; j < key.parts.length; j++) {
      const b = normInstr(key.parts[j].instruction);
      if (b.length >= 12 && (a === b || a.startsWith(b) || b.startsWith(a))) { pairs.set(i, j); j0 = j + 1; return; }
    }
  });
  return pairs;
}

function explanationFrom(lines) {
  return lines.map((l) => l.replace(/^\s*[-–•]\s*/, '').trim())
    .filter((l) => l && !/^(giải thích|explanation)\s*:?$/i.test(l) && !/^(transcript|tapescript)\b/i.test(l) && !/^\([A-Z][A-Z ]*\)\.?$/.test(l))
    .join('\n').slice(0, 1500);
}

function gapAnswerFromStem(examStem, keyStem) {
  const kt = textOf(keyStem);
  const m = kt.match(/[_…]{2,}\s*([^_…]+?)\s*[_…]{2,}/);
  if (m && m[1].trim()) return m[1].trim();
  // so sánh phần trước/sau chỗ trống
  const et = textOf(examStem);
  const parts = et.split(/[_…]{3,}|\.{4,}/);
  if (parts.length === 2) {
    const pre = parts[0].trim(), post = parts[1].trim();
    if (kt.startsWith(pre)) {
      let mid = kt.slice(pre.length);
      const k = post ? mid.lastIndexOf(post.slice(0, 15)) : mid.length;
      if (k > 0) mid = mid.slice(0, k);
      mid = mid.replace(/[_…]/g, '').trim();
      if (mid && mid.length < 80) return mid;
    }
  }
  const b = String(keyStem || '').match(/<b>([^<]{1,60})<\/b>/);
  return b ? stripTags(b[1]) : '';
}
function gapAnswerFromPassage(raw, n) {
  const t = textOf(raw);
  // ưu tiên chữ nằm GIỮA hai dãy gạch: "(1) a ____ drama ____" -> "drama"
  const m = t.match(new RegExp('\\(' + n + '\\)[^_…()]{0,25}?[_…]{2,}\\s*([^_…]+?)\\s*[_…]{2,}'))
    || t.match(new RegExp('\\(' + n + '\\)\\s*[_…]*\\s*([^_…()]+?)\\s*[_…]{2,}'));
  if (m && m[1].trim()) return m[1].trim();
  const b = String(raw || '').match(new RegExp('\\(' + n + '\\)\\s*[_…]*\\s*<b>([^<]{1,60})</b>'));
  return b ? stripTags(b[1]).trim() : '';
}
function tfAnswerFrom(kq) {
  const t = textOf(kq.stemHtml);
  const m = t.match(/(?:^|[\s→=>:-])\(?(T|F|NG|True|False|Not given|Đúng|Sai)\)?\.?\s*$/i)
    || String(kq.stemHtml).match(/<b>\s*\(?(T|F|NG|True|False)\)?\s*<\/b>/i);
  if (!m) return '';
  const v = m[1].toLowerCase();
  return /^(t|true|đúng)$/.test(v) ? 'T' : /^(ng|not given)$/.test(v) ? 'NG' : 'F';
}
function mcqAnswerFrom(kq) {
  if (kq.keyLetter) return kq.keyLetter;
  const marked = kq.options.filter((o) => o.marked);
  if (marked.length === 1) return marked[0].key;
  // tìm lỗi sai: dòng giải thích "regularly => regular" -> chọn phương án gạch chân "regularly"
  const fix = (kq.notes || []).map((l) => l.replace(/^\s*[-–•]\s*/, '').match(/^(.{1,40}?)\s*(?:=>|→|->|⇒)/)).find(Boolean);
  if (fix && kq.options.some((o) => stripTags(o.html))) {
    const w = fix[1].split(/[+(]/)[0].trim().toLowerCase();
    const hit = kq.options.filter((o) => stripTags(o.html).toLowerCase() === w);
    if (hit.length === 1) return hit[0].key;
  }
  const t = textOf(kq.stemHtml);
  let m = t.match(/[-–:→=]\s*>?\s*\(?([A-H])\)?\s*$/) || String(kq.stemHtml).match(/<b>\s*([A-H])\s*<\/b>\s*$/);
  if (m) return m[1];
  for (const n of kq.notes || []) {
    m = n.match(/(?:đáp án|answer|key|chọn)\s*(?:đúng)?\s*(?:là)?\s*[:\-]?\s*\(?([A-H])\)?(?:[.\s]|$)/i);
    if (m) return m[1].toUpperCase();
  }
  return '';
}

/** Tạo câu hỏi "tìm từ thừa" từ bài đọc có từ thừa được đánh dấu trong đáp án. */
function buildExtraWord(ep, kp) {
  const markRe = /<b>\s*<u>([^<]{1,30})<\/u>\s*<\/b>|<u>\s*<b>([^<]{1,30})<\/b>\s*<\/u>/g;
  const examMarks = [...String(ep.passageRaw || '').matchAll(markRe)].length;
  const words = [];
  const text = textOf(String(kp.passageRaw || '').replace(markRe, (m0, a, b) => { words.push((a || b).trim()); return ` ⟦${words.length - 1}⟧ `; }));
  if (words.length <= examMarks) return null;
  const qs = [];
  for (let k = examMarks; k < words.length; k++) {
    const pos = text.indexOf(`⟦${k}⟧`);
    let a = pos, b = pos;
    while (a > 0 && !/[.!?;,]/.test(text[a - 1])) a--;
    while (b < text.length && !/[.!?;,]/.test(text[b])) b++;
    const chunk = text.slice(a, Math.min(text.length, b + 1)).replace(/⟦(\d+)⟧/g, (_, i) => words[+i]).replace(/\s+/g, ' ').trim();
    const n = qs.length + 1;
    const kq = kp.questions.find((x) => x.num === n);
    const expl = kq ? explanationFrom([textOf(kq.stemHtml), ...(kq.notes || [])]) : '';
    qs.push({ num: n, type: 'gap', stemHtml: escapeHtml(chunk.charAt(0).toUpperCase() + chunk.slice(1)), lead: '', options: [], answer: words[k], accepted: [words[k]],
      explanation: expl, points: 1 });
  }
  return qs;
}

/** Gắn đáp án từ file đáp án dạng bản sao đề. Trả về số câu đã gắn, hoặc -1 nếu file không phải dạng này. */
export function applyKeyDocument(exam, keyBlocks) {
  const key = parseExam(keyBlocks, { keyMode: true });
  const pairs = alignParts(exam, key);
  const withInstr = exam.parts.filter((p) => normInstr(p.instruction).length >= 12).length;
  if (pairs.size < 2 || pairs.size < withInstr * 0.4) return -1;
  let count = 0;
  for (const [i, j] of pairs) {
    const ep = exam.parts[i], kp = key.parts[j];
    if (kp.transcript && !ep.transcript) ep.transcript = kp.transcript.slice(0, 20000);
    // bài tìm từ thừa trong đoạn văn
    if (/extra word|unnecessary word|từ thừa/i.test(ep.instruction) && !ep.questions.some((x) => x.type !== 'essay')) {
      const qs = buildExtraWord(ep, kp);
      if (qs) {
        ep.questions = qs; ep.topic = 'error_identification'; ep.kind = 'gap';
        ep.instruction += ' (Mỗi câu dưới đây có MỘT từ thừa – hãy viết lại từ thừa đó.)';
        ep.passageHtml = '';
        const per = ep.points ? Math.round((ep.points / qs.length) * 100) / 100 : 1;
        qs.forEach((x) => { x.points = per; });
        count += qs.length;
        continue;
      }
    }
    const used = new Set();
    for (const q of ep.questions) {
      const qn = q.srcNum ?? q.num;
      if (qn == null) continue;
      const kq = kp.questions.find((x) => x.num === qn && !used.has(x));
      if (kq) used.add(kq);
      let ans = '';
      if (q.type === 'tf') ans = kq ? tfAnswerFrom(kq) : '';
      else if (q.type === 'mcq') ans = kq ? mcqAnswerFrom(kq) : '';
      else if (q.type === 'gap') {
        if (textOf(q.stemHtml) && kq) ans = gapAnswerFromStem(q.stemHtml, kq.stemHtml);
        if (!ans) ans = gapAnswerFromPassage(kp.passageRaw, qn);
      } else if (q.type === 'rewrite' && kq) {
        const full = kq.lead || (kq.notes?.length && /^(→|->|=>)/.test(kq.notes[0]) ? kq.notes[0].replace(/^(→|->|=>)\s*/, '') : '');
        const al = full && alignLead(q.lead || '', full);
        if (al) { ans = full; if (al.lead !== undefined) q.lead = al.lead; }
      }
      const exLines = [];
      if (kq) {
        // câu điền chỗ trống trong đoạn văn: dòng "1. gets dressed: mặc đồ" chính là lời giải thích
        if (!textOf(q.stemHtml) && textOf(kq.stemHtml) && !kq.options.length) exLines.push(textOf(kq.stemHtml));
        exLines.push(...(kq.notes || []));
      }
      if (ans) { Object.assign(q, interpretAnswer(q, ans)); count++; }
      const ex = explanationFrom(exLines);
      if (ex) q.explanation = ex;
    }
  }
  // Tìm lỗi sai nhưng file không giữ được gạch chân (PDF): đổi thành câu "viết từ đúng để sửa lỗi"
  for (const [i, j] of pairs) {
    const ep = exam.parts[i], kp = key.parts[j];
    if (ep.topic !== 'error_identification') continue;
    const blank = ep.questions.filter((q) => q.type === 'mcq' && q.options.length && q.options.every((o) => !stripTags(o.html)));
    if (!blank.length) continue;
    let changed = 0;
    for (const q of blank) {
      const kq = kp.questions.find((x) => x.num === (q.srcNum ?? q.num));
      const fix = (kq?.notes || []).map((l) => l.replace(/^\s*[-–•]\s*/, '').match(/^(.{1,40}?)\s*(?:=>|→|->|⇒)\s*(.{1,60})$/)).find(Boolean);
      if (!fix) continue;
      const wrong = fix[1].split('+')[0].trim();
      let right = fix[2].split(/\s*\(|\s+\+\s|\s+(?:vì|do|because)\s/)[0].trim();
      const del = /^(bỏ|xoá|xóa|delete|omit|remove)(?=\s|$)/i.test(right);
      q.type = 'gap'; q.options = [];
      if (del) { q.answer = `bỏ ${wrong}`; q.accepted = [`bỏ ${wrong}`, `xoá ${wrong}`, `delete ${wrong}`, `${wrong} → bỏ`, wrong]; }
      else { q.answer = right; q.accepted = [right, `${wrong} → ${right}`, `${wrong} -> ${right}`, `${wrong} => ${right}`, `${wrong} - ${right}`, `${wrong} sửa thành ${right}`]; }
      changed++;
    }
    if (changed) { ep.instruction += ' (Viết từ/cụm từ đúng để sửa lỗi; nếu phải bỏ từ thì ghi “bỏ + từ”.)'; ep.kind = 'gap'; count += changed; }
  }
  return count;
}

// ======================================================= ĐÁP ÁN DẠNG DANH SÁCH, ĐÁNH SỐ LẠI TỪ 1 MỖI PHẦN
/**
 * Chia file đáp án theo tiêu đề: "PHẦN 2", "II. 15 pts", "1. Part 1 (5 pts)"…
 * Mỗi đoạn: { phase, roman, partNo, map: Map(số câu → đáp án), errors: [{ error:[…], corr:[…] }] }
 */
export function parseKeySections(blocks) {
  const segs = [];
  let phase = null, roman = null, cur = null;
  const open = (r, pn) => { cur = { phase, roman: r, partNo: pn, blocks: [], li: [], errors: [], errTable: false }; segs.push(cur); };
  for (const b of blocks) {
    const text = b.text.replace(/\\([.!_\-*])/g, '$1').trim();
    if (!text) continue;
    let m;
    if (b.kind !== 'row' && (m = text.match(/^(?:PHẦN|PHAN|SECTION|PAPER)\s+([IVXLC]+|\d+)\b/i))) { phase = labelNum(m[1]); roman = null; cur = null; continue; }
    if (b.kind !== 'row' && (m = text.match(/^(?:\d{1,2}\s*[.)]\s*)?(?:PART|TASK|EXERCISE|BÀI)\s+([IVX]+|\d+)\b/i))) { open(roman, labelNum(m[1])); continue; }
    if (b.kind !== 'row' && (m = text.match(/^([IVX]{1,5})\s*[.)\-–]\s*(.*)$/)) && (text.length < 90 || POINTS_RE.test(text) || /\b\d+\s*(?:pts?|points?|điểm)\b/i.test(text))
        && !/^[IVX]{1,5}\s*[.)]\s*[A-H]\s*$/.test(text)) { roman = m[1]; open(roman, null); continue; }
    if (KEY_HEAD_RE.test(text) && b.kind !== 'row') continue;
    if (!cur) open(roman, null);
    if (b.kind === 'row') {
      const cells = b.cells.map((c) => c.text.trim());
      if (/^line$/i.test(cells[0]) && /error|lỗi/i.test(cells[1] || '')) { cur.errTable = true; continue; }
      const lm = cells[0].match(/^(?:Line|Dòng)\s*(\d+)/i);
      if (cur.errTable && lm && cells.length >= 3) {
        const alts = (c) => c.lines.join(' ').split('/').map((x) => x.trim()).filter(Boolean);
        cur.errors.push({ line: +lm[1], error: alts(b.cells[1]), corr: alts(b.cells[2]) });
        continue;
      }
    }
    if (b.kind === 'li') { cur.li.push(text); continue; }
    cur.blocks.push(b);
  }
  for (const sg of segs) {
    sg.map = parseAnswerKey(sg.blocks);
    sg.li.forEach((t, k) => { if (!sg.map.has(k + 1)) sg.map.set(k + 1, t); });
    delete sg.blocks; delete sg.li; delete sg.errTable;
  }
  return segs.filter((sg) => sg.map.size || sg.errors.length);
}

/** Bài tìm & sửa lỗi trong đoạn văn: mỗi lỗi trong bảng đáp án → một câu (câu văn chứa lỗi). */
function buildErrorFix(p, errors) {
  const text = textOf(p.passageRaw || p.passageHtml || '').replace(/\s+/g, ' ');
  if (!text) return null;
  const qs = [];
  let cursor = 0;
  for (const e of errors) {
    let pos = -1, word = '';
    for (const w of [...e.error].sort((a, b) => b.length - a.length)) {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const flags of ['', 'i']) {
        const re = new RegExp('(^|[^A-Za-z])' + esc + '(?![A-Za-z])', 'g' + flags);
        re.lastIndex = cursor;
        const mm = re.exec(text);
        if (mm) { pos = mm.index + mm[1].length; word = w; break; }
      }
      if (pos >= 0) break;
    }
    if (pos < 0) continue;
    cursor = pos + word.length;
    let a = pos, b = pos;
    while (a > 0 && !/[.!?]/.test(text[a - 1])) a--;
    while (b < text.length && !/[.!?]/.test(text[b])) b++;
    const chunk = text.slice(a, Math.min(text.length, b + 1)).trim();
    const del = (c) => /^(?:Ø|∅|bỏ|xoá|xóa|delete|omit|remove)\b/i.test(c);
    const acc = new Set();
    for (const c of e.corr) {
      for (const v of expandVariants(c)) {
        if (del(v)) { for (const w of e.error) { acc.add(`bỏ ${w}`); acc.add(`xoá ${w}`); acc.add(`${w} → bỏ`); acc.add(`delete ${w}`); } continue; }
        acc.add(v);
        for (const w of e.error) for (const arrow of ['→', '->', '=>', '-', ':']) acc.add(`${w} ${arrow} ${v}`);
      }
    }
    const list = [...acc].slice(0, 60);
    qs.push({ _at: a, num: qs.length + 1, type: 'gap', stemHtml: escapeHtml(chunk), lead: '', options: [], answer: `${e.error[0]} → ${e.corr.find((c) => !del(c)) || 'bỏ'}`,
      accepted: list, explanation: `Lỗi: “${e.error.join(' / ')}” → sửa: ${e.corr.join(' / ')}`, points: 1 });
  }
  // câu văn có nhiều lỗi → ghi rõ câu hỏi này hỏi lỗi thứ mấy (tính từ đầu câu)
  const groups = new Map();
  for (const q of qs) { if (!groups.has(q._at)) groups.set(q._at, []); groups.get(q._at).push(q); }
  for (const g of groups.values()) {
    if (g.length > 1) g.forEach((q, k) => { q.stemHtml += `<br><i>(Câu này có ${g.length} lỗi – ở đây ghi lỗi thứ ${k + 1}, tính từ đầu câu)</i>`; });
  }
  qs.forEach((q) => delete q._at);
  return qs.length ? qs : null;
}

/** Gắn đáp án khi đề và đáp án đánh số lại từ 1 ở mỗi phần. Trả về số câu đã gắn, hoặc -1 nếu không áp dụng được. */
export function applyKeySections(exam, keyBlocks) {
  const segs = parseKeySections(keyBlocks);
  if (segs.length < 2) return -1;
  const labelMatch = (p, sg) => {
    if (p._phase != null && sg.phase != null && p._phase !== sg.phase) return false;
    if (p._partNo != null) return sg.partNo === p._partNo && (p._roman == null || sg.roman == null || sg.roman === p._roman);
    if (p._roman) return sg.partNo == null && sg.roman === p._roman;
    return false;
  };
  const numbered = (p) => p.questions.filter((q) => q.num != null && q.type !== 'essay');
  const coverage = (p, sg) => { const qs = numbered(p); return qs.length ? qs.filter((q) => sg.map.has(q.num)).length / qs.length : 0; };
  const used = new Set();
  let last = -1, count = 0;
  for (const p of exam.parts) {
    const isErrPassage = p.topic === 'error_identification' && !numbered(p).length;
    let j = segs.findIndex((sg, k) => !used.has(k) && labelMatch(p, sg));
    if (j < 0) j = segs.findIndex((sg, k) => k > last && !used.has(k) && (isErrPassage ? sg.errors.length > 0 : coverage(p, sg) >= 0.6));
    if (j < 0) continue;
    used.add(j); last = Math.max(last, j);
    const sg = segs[j];
    if (isErrPassage && sg.errors.length) {
      const qs = buildErrorFix(p, sg.errors);
      if (qs) {
        p.questions = qs; p.kind = 'gap'; p.passageHtml = '';
        p.instruction += ' (Mỗi câu dưới đây có MỘT lỗi sai – ghi từ sai và sửa lại, ví dụ: easy → easier; nếu phải bỏ từ thì ghi “bỏ + từ”.)';
        const per = p.points ? Math.round((p.points / qs.length) * 100) / 100 : 1;
        qs.forEach((x) => { x.points = per; });
        count += qs.length;
      }
      continue;
    }
    for (const q of p.questions) {
      if (q.num == null || !sg.map.has(q.num)) continue;
      Object.assign(q, interpretAnswer(q, sg.map.get(q.num).replace(/^[\s:→\-–]+/, '').trim()));
      count++;
    }
  }
  return count;
}

/** Gắn đáp án: tự chọn dạng "bản sao đề", dạng chia theo phần (đánh số lại mỗi phần) hoặc danh sách "1. B  2. C". */
export function attachAnswerKey(exam, keyBlocks) {
  const n = applyKeyDocument(exam, keyBlocks);
  if (n >= 0) return { mode: 'document', count: n };
  const all = exam.parts.flatMap((p) => p.questions.map((q) => q.num)).filter((x) => x != null);
  const nums = new Set(all);
  if (nums.size !== all.length) {
    const k = applyKeySections(exam, keyBlocks);
    if (k >= 0) return { mode: 'sections', count: k };
  }
  return { mode: 'list', count: applyAnswerKey(exam, parseAnswerKey(keyBlocks, nums)) };
}

// ======================================================= LỌC & HOÀN THIỆN
export const DEFAULT_DROP = ['writing'];
/**
 * Bỏ các dạng không phù hợp để học sinh tự luyện (mặc định: Nghe và Viết đoạn/thư tự luận),
 * đánh số lại câu hỏi liên tục nếu đề đánh số lại từ 1 ở mỗi phần, dọn dữ liệu tạm.
 */
export function finalizeExam(exam, { drop = DEFAULT_DROP } = {}) {
  const dropSet = new Set(drop);
  const removed = { parts: 0, questions: 0 };
  exam.parts = exam.parts.filter((p) => {
    if (dropSet.has(p.topic)) { removed.parts++; removed.questions += p.questions.length; return false; }
    if (dropSet.has('writing')) {
      const before = p.questions.length;
      p.questions = p.questions.filter((q) => q.type !== 'essay');
      removed.questions += before - p.questions.length;
    }
    if (!p.questions.length) { removed.parts++; return false; }
    return true;
  });
  const nums = exam.parts.flatMap((p) => p.questions.map((q) => q.num)).filter((x) => x != null);
  if (new Set(nums).size !== nums.length) {
    let n = 0;
    for (const p of exam.parts) {
      const map = {};
      for (const q of p.questions) { n++; if (q.num != null) { map[q.num] = n; q.srcNum ??= q.num; } q.num = n; delete q.label; }
      if (p.passageHtml) p.passageHtml = p.passageHtml.replace(/<span class="gap" data-n="(\d+)">\(\d+\)<\/span>/g, (m0, k) => (map[k] ? `<span class="gap" data-n="${map[k]}">(${map[k]})</span>` : m0));
    }
  }
  for (const p of exam.parts) {
    delete p.passageRaw; delete p._matching; delete p._phase; delete p._roman; delete p._partNo; delete p._bankUsed;
    p.kind = p.questions[0]?.type || 'gap';
    for (const q of p.questions) { delete q.notes; delete q.keyLetter; (q.options || []).forEach((o) => delete o.marked); }
  }
  exam.parts.forEach((p, i) => { p.id = `p${i + 1}`; p.questions.forEach((x, j) => { x.id = `${p.id}q${j + 1}`; }); });
  return removed;
}

/** "goes/ travels to work" -> ["goes to work","travels to work"]; "(to) beautify" -> ["to beautify","beautify"] */
export function expandVariants(str) {
  let list = [String(str).trim()];
  for (let guard = 0; guard < 4; guard++) {
    const next = [];
    let changed = false;
    for (const s of list) {
      const m = s.match(/(^|\s)([^\s/()]+)\s?\/\s?([^\s/()]+)(?=[\s.,!?]|$)/);
      const suf = !m && s.match(/([A-Za-z])\(([a-z]{1,3})\)/);
      if (suf) { changed = true; next.push(s.replace(suf[0], suf[1] + suf[2]), s.replace(suf[0], suf[1])); continue; }
      const o = !m && s.match(/\(([A-Za-z']{1,12})\)\s*/);
      if (m) { changed = true; next.push(s.slice(0, m.index) + m[1] + m[2] + s.slice(m.index + m[0].length), s.slice(0, m.index) + m[1] + m[3] + s.slice(m.index + m[0].length)); }
      else if (o && o[0].trim() !== s.trim()) { changed = true; next.push(s.replace(o[0], o[1] + ' '), s.replace(o[0], '')); }
      else next.push(s);
    }
    list = next.map((x) => x.replace(/\s+/g, ' ').trim());
    if (!changed) break;
  }
  return list;
}

/**
 * So khớp phần đầu cho sẵn của đề ("I a long time." – chỗ trống bị mất khi đọc file)
 * với câu đáp án đầy đủ ("I haven't seen him for a long time.").
 * Trả về null nếu không khớp; nếu khớp và chỉ có đúng 1 chỗ trống thì dựng lại lead có "___".
 */
export function alignLead(lead, full) {
  const norm = (w) => w.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9']/g, '');
  const lw = lead.replace(/_{2,}|…+|\.{3,}/g, ' ').split(/\s+/).filter((w) => norm(w));
  const fw = full.split(/\s+/).filter(Boolean);
  if (!lw.length) return { lead: undefined };
  if (fw.length <= lw.length) return null;
  // ghép tham lam theo thứ tự (dãy con)
  const pos = [];
  let j = 0;
  for (const w of lw) {
    while (j < fw.length && norm(fw[j]) !== norm(w)) j++;
    if (j >= fw.length) return null;
    pos.push(j++);
  }
  // các đoạn bị thiếu
  const gaps = [];
  let prev = -1;
  for (const p of pos) { if (p > prev + 1) gaps.push([prev + 1, p]); prev = p; }
  if (prev < fw.length - 1) gaps.push([prev + 1, fw.length]);
  if (/_{2,}/.test(lead)) return { lead: undefined };       // đề đã có chỗ trống rõ ràng
  if (gaps.length !== 1) return { lead: undefined };
  const [a, b] = gaps[0];
  if (b === fw.length) return { lead: undefined };          // trống ở cuối: giữ nguyên như đề
  const punct = (fw[b - 1].match(/[,;:]$/) || [''])[0];      // giữ dấu phẩy ngay sau chỗ trống
  const before = fw.slice(0, a).join(' ');
  const after = fw.slice(b).join(' ');
  return { lead: [before, '___' + punct, after].filter(Boolean).join(' ') };
}
