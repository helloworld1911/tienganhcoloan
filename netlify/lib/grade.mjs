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

const compose = (lead, x) => {
  if (!lead) return x;
  if (/_{2,}/.test(lead)) return lead.replace(/_{2,}/, x);
  return `${lead} ${x}`;
};

export function isTextCorrect(q, given) {
  if (!given || !String(given).trim()) return false;
  const accepted = (q.accepted && q.accepted.length ? q.accepted : [q.answer]).filter(Boolean);
  if (!accepted.length) return false;
  const cands = new Set([normalize(given)]);
  if (q.lead) cands.add(normalize(compose(q.lead, given)));
  const keys = new Set();
  for (const a of accepted) { keys.add(normalize(a)); if (q.lead) keys.add(normalize(compose(q.lead, a))); }
  for (const c of cands) if (keys.has(c)) return true;
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
    parts: (content.parts || []).map((p) => ({
      ...p,
      questions: (p.questions || []).map(({ answer, accepted, explanation, ...rest }) => rest),
    })),
  };
}
