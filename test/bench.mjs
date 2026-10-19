// node bench.mjs <thư-mục-mã-nguồn> <setup|run> <thư-mục-dữ-liệu>
import fs from 'node:fs';
import mammoth from 'mammoth';
const [root, mode, dataDir] = process.argv.slice(2);
const DELAY = 200;
const { PGlite } = await import(root + '/node_modules/@electric-sql/pglite/dist/index.js');
const raw = await PGlite.create(dataDir);
let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delayOn = mode === 'run';
// mỗi truy vấn = 1 lượt mạng; transaction gửi một lần = 1 lượt
const db = {
  query: async (t, p) => { calls++; if (delayOn) await sleep(DELAY); return raw.query(t, p); },
  transaction: async (fn) => { calls++; if (delayOn) await sleep(DELAY); return raw.transaction(fn); },
};
(await import(root + '/netlify/lib/db.mjs')).useLocalDb(db);
process.env.JWT_SECRET = 'bench'; process.env.MEDIA_DIR = '/tmp/claude-0/bench/media';
const { default: api } = await import(root + '/netlify/functions/api.mjs');
const P = await import(root + '/public/js/parser.js');
async function call(method, path, body, tk) {
  const res = await api(new Request('http://x/api' + path, { method, headers: { 'content-type': 'application/json', ...(tk ? { authorization: 'Bearer ' + tk } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const d = await res.json(); if (!res.ok) throw new Error(path + ' ' + JSON.stringify(d)); return d;
}
if (mode === 'setup') {
  const admin = await call('POST', '/setup', { fullName: 'Cô', username: 'admin', password: 'admin123' });
  const c = await call('POST', '/classes', { name: '6A', grade: 6 }, admin.token);
  await call('POST', '/users', { users: Array.from({ length: 30 }, (_, i) => ({ fullName: 'HS ' + i, username: 'hs' + i, password: '123456', classId: c.id })) }, admin.token);
  const blocks = async (f) => P.htmlToBlocks((await mammoth.convertToHtml({ buffer: fs.readFileSync(f) }, { styleMap: ['u => u', 'b => b'] })).value);
  const ex = P.parseExam(await blocks(root + '/test/real/nghiloc-de.docx'), {});
  P.attachAnswerKey ? P.attachAnswerKey(ex, await blocks(root + '/test/real/nghiloc-dapan.docx')) : null;
  P.finalizeExam ? P.finalizeExam(ex) : null;
  const e = await call('POST', '/exams', { title: 'Nghi Lộc', content: ex }, admin.token);
  await call('POST', '/assignments', { examId: e.id, classIds: [c.id] }, admin.token);
  console.log('setup xong');
} else {
  const T = async (label, fn) => { const c0 = calls, t0 = Date.now(); const r = await fn(); console.log(`  ${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)} ms  (${calls - c0} lượt tới CSDL)`); return r; };
  const st = await T('Đăng nhập học sinh (máy chủ vừa khởi động)', () => call('POST', '/auth/login', { username: 'hs1', password: '123456' }));
  const ad = await T('Đăng nhập giáo viên', () => call('POST', '/auth/login', { username: 'admin', password: 'admin123' }));
  const list = await T('Học sinh: danh sách bài', () => call('GET', '/my/assignments', null, st.token));
  const s = await T('Học sinh: bắt đầu làm bài', () => call('POST', `/my/assignments/${list[0].id}/start`, null, st.token));
  const answers = Object.fromEntries(s.content.parts.flatMap((p) => p.questions).map((q) => [q.id, 'A']));
  await T('Học sinh: NỘP BÀI (77 câu)', () => call('POST', `/attempts/${s.attemptId}/submit`, { answers }, st.token));
  await T('Học sinh: trang chủ (thống kê)', () => call('GET', '/my/stats', null, st.token));
  await T('GV: Tổng quan', () => call('GET', '/dashboard/overview', null, ad.token));
  await T('GV: Trang lớp', () => call('GET', '/dashboard/class/1', null, ad.token));
  await T('GV: Kết quả bài giao', () => call('GET', `/assignments/${list[0].id}/results`, null, ad.token));
}
process.exit(0);
