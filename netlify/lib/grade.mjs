// Chấm điểm phía server
const CONTRACTIONS = [
  [/\bwon't\b/g, 'will not'], [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bshan't\b/g, 'shall not'],
  [/\b(\w+)n't\b/g, '$1 not'], [/\bi'm\b/g, 'i am'], [/\b(\w+)'re\b/g, '$1 are'], [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'], [/\b(i|you|he|she|we|they)'d\b/g, '$1 would'], [/\b(it|that|there|he|she|what|who)'s\b/g, '$1 is'],
];

export function normalize(s) {
  let t = String(s ?? '').toLowerCase()
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/^(?:→|->|=>)\s*/, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ').trim()
    .replace(/[.!?]+$/, '').trim();
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  return t.replace(/[,;:"]/g, '').replace(/\s+/g, ' ').trim();
}

// So khớp "dễ": bỏ qua hoàn toàn khoảng trắng và dấu câu (chấm, phẩy, gạch nối, nháy…),
// chỉ so chữ cái + chữ số sau khi đã mở các dạng viết tắt (don't = do not).
// viết tắt thiếu dấu nháy: dont, doesnt, isnt, cant, wont, im…
const NO_APOS = [[/\b(do|does|did|is|are|was|were|has|have|had|could|would|should|must|need)nt\b/g, '$1 not'], [/\bcant\b/g, 'can not'], [/\bwont\b/g, 'will not'], [/\bim\b/g, 'i am']];
const words = (s) => {
  let t = normalize(s);
  for (const [re, rep] of NO_APOS) t = t.replace(re, rep);
  return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
};
const loose = (s) => words(s).join('');

function lev1(a, b) { // khoảng cách sửa ≤ 1 (thêm/bớt/đổi một chữ cái)
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
// Câu viết (viết lại câu / dựng câu): bỏ qua MỘT lỗi gõ nhỏ trong một từ dài (≥ 5 chữ cái),
// nhưng không bỏ qua khác biệt ở đuôi từ (-s, -es, -ed, -ing, -er…) vì đó thường là lỗi ngữ pháp.
function oneTypo(a, b) {
  if (a.length !== b.length) return false;
  let diff = -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (diff >= 0) return false; diff = i; }
  if (diff < 0) return true;
  const x = a[diff], y = b[diff];
  return Math.min(x.length, y.length) >= 5 && x.slice(0, 2) === y.slice(0, 2) && x.slice(-2) === y.slice(-2) && lev1(x, y);
}

const compose = (lead, x) => {
  if (!lead) return x;
  if (/_{2,}/.test(lead)) return lead.replace(/_{2,}/, x);
  return `${lead} ${x}`;
};

export function isTextCorrect(q, given) {
  if (!given || !String(given).trim()) return false;
  const accepted = (q.accepted && q.accepted.length ? q.accepted : [q.answer]).filter(Boolean);
  if (!accepted.length) return false;
  const cands = [String(given)];
  if (q.lead) cands.push(compose(q.lead, given));
  const keys = [];
  for (const a of accepted) { keys.push(a); if (q.lead) keys.push(compose(q.lead, a)); }
  const ck = new Set(cands.map(loose).filter(Boolean));
  if (keys.some((k) => ck.has(loose(k)))) return true;
  if (q.type === 'rewrite') {
    const cw = cands.map(words);
    if (keys.some((k) => { const kw = words(k); return cw.some((w) => oneTypo(w, kw)); })) return true;
  }
  return false;
}

/** Chấm một câu. */
export function gradeQuestion(q, given) {
  const max = Number(q.points) || 1;
  if (q.type === 'essay') return { correct: null, earned: 0, max, pending: true };
  let correct;
  if (q.type === 'mcq' || q.type === 'tf') correct = !!given && String(given).toUpperCase() === String(q.answer || '').toUpperCase();
  else correct = isTextCorrect(q, given);
  return { correct, earned: correct ? max : 0, max, pending: false };
}

const round = (x) => Math.round(x * 100) / 100;

/** Chấm toàn bộ bài theo nội dung đề (content.parts). */
export function gradeAttempt(content, answers) {
  const results = [];
  let score = 0, max = 0, pending = false;
  for (const p of content.parts || []) {
    for (const q of p.questions || []) {
      const given = answers?.[q.id] ?? '';
      const r = gradeQuestion(q, given);
      score += r.earned; max += r.max; if (r.pending) pending = true;
      results.push({
        id: q.id, num: q.num, label: q.label || null, partId: p.id, topic: p.topic, type: q.type,
        given, correct: r.correct, earned: r.earned, max: r.max, pending: r.pending,
        answer: q.answer || '', accepted: q.accepted || [], explanation: q.explanation || '', comment: '',
      });
    }
  }
  return { results, score: round(score), max: round(max), percent: max ? round((score / max) * 100) : 0, pending };
}

/** Tính lại tổng sau khi giáo viên chấm tay. */
export function totals(results) {
  let score = 0, max = 0, pending = false;
  for (const r of results) { score += Number(r.earned) || 0; max += Number(r.max) || 0; if (r.pending) pending = true; }
  return { score: round(score), max: round(max), percent: max ? round((score / max) * 100) : 0, pending };
}

/** Bỏ đáp án trước khi gửi đề cho học sinh. */
export function stripAnswers(content) {
  return {
    ...content,
    parts: (content.parts || []).map(({ transcript, ...p }) => ({
      ...p,
      questions: (p.questions || []).map(({ answer, accepted, explanation, ...rest }) => rest),
    })),
  };
}
