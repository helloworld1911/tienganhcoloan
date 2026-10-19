// Kiểm thử API end-to-end trên Postgres giả lập (PGlite) – node test/api.test.mjs
import fs from 'node:fs';
import mammoth from 'mammoth';
import { PGlite } from '@electric-sql/pglite';
import { htmlToBlocks, parseExam, parseAnswerKey, applyAnswerKey } from '../public/js/parser.js';

const db = await PGlite.create();
(await import('../netlify/lib/db.mjs')).useLocalDb(db);
process.env.JWT_SECRET = 'test-secret';
process.env.MEDIA_DIR = '/tmp/engweb-test-media';
const { default: api } = await import('../netlify/functions/api.mjs');

let token = null;
async function call(method, path, body, tk = token) {
  const res = await api(new Request('http://localhost/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(tk ? { authorization: 'Bearer ' + tk } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };

// 1. Khởi tạo quản trị
ok((await call('GET', '/setup/status')).needsSetup, 'cần thiết lập lần đầu');
const admin = await call('POST', '/setup', { fullName: 'Cô Lan', username: 'admin', password: 'admin123' });
token = admin.token;
ok(!(await call('GET', '/setup/status')).needsSetup, 'đã tạo admin');

// 2. Lớp + học sinh
const c6a = await call('POST', '/classes', { name: '6A', grade: 6 });
const c6b = await call('POST', '/classes', { name: '6B', grade: 6 });
const bulk = await call('POST', '/users', { users: [
  { fullName: 'Nguyễn An', username: 'an6a', password: '123456', classId: c6a.id },
  { fullName: 'Trần Bình', username: 'binh6a', password: '123456', classId: c6a.id },
  { fullName: 'Lê Chi', username: 'an6a', password: '123456', classId: c6a.id },
] });
ok(bulk.created.length === 2 && bulk.errors.length === 1, 'nhập danh sách: 2 tạo mới, 1 trùng tên');
const refused = async (fn) => { try { await fn(); return false; } catch (e) { return / 40[0-4] /.test(e.message); } };
ok(await refused(() => call('POST', '/auth/register', { fullName: 'X', username: 'tudangky', password: '123456', joinCode: c6b.join_code }, null)), 'không ai tự đăng ký được');
const reg = await call('POST', '/users/register', { fullName: 'Phạm Dũng', username: 'dung6b', password: '123456', joinCode: c6b.join_code, email: 'dung@gmail.com' });
ok(reg.user.class_id === c6b.id && reg.class.name === '6B', 'quản trị viên đăng ký học sinh bằng mã lớp');
ok(await refused(() => call('POST', '/users/register', { fullName: 'Y', username: 'yy6b', password: '123456', joinCode: 'SAIMA' })), 'mã lớp sai bị từ chối');
await call('POST', '/users', { users: [{ fullName: 'Cô Hoa', username: 'cohoa', password: '123456', role: 'teacher' }] });
const tTok = (await call('POST', '/auth/login', { username: 'cohoa', password: '123456' }, null)).token;
const sTok = (await call('POST', '/auth/login', { username: 'dung6b', password: '123456' }, null)).token;
ok(await refused(() => call('POST', '/users', { users: [{ fullName: 'Z', username: 'zz6a', password: '123456', classId: c6a.id }] }, tTok))
  && await refused(() => call('POST', '/users/register', { fullName: 'Z', username: 'zz6a', password: '123456', joinCode: c6a.join_code }, tTok))
  && await refused(() => call('POST', '/users/register', { fullName: 'Z', username: 'zz6a', password: '123456', joinCode: c6a.join_code }, sTok)), 'chỉ quản trị viên tạo được tài khoản');

// 3. Phân tích đề + lưu
const opt = { styleMap: ['u => u'] };
const blocks = async (f) => htmlToBlocks((await mammoth.convertToHtml({ buffer: fs.readFileSync(f) }, opt)).value);
const exam = parseExam(await blocks('test/fixtures/de-hsg-anh6.docx'), { fileName: 'de.docx' });
const nums = new Set(exam.parts.flatMap((p) => p.questions.map((q) => q.num)).filter((n) => n != null));
applyAnswerKey(exam, parseAnswerKey(await blocks('test/fixtures/dap-an-hsg-anh6.docx'), nums));
const saved = await call('POST', '/exams', { title: exam.title, grade: exam.grade, timeLimit: exam.timeLimit, content: exam });
ok(saved.id, 'lưu đề vào CSDL');
const asg = await call('POST', '/assignments', { examId: saved.id, classIds: [c6a.id, c6b.id], showAnswers: 'after_submit', maxAttempts: 2 });
ok(asg.length === 2, 'giao bài cho 2 lớp');

// 4. Học sinh làm bài
const an = await call('POST', '/auth/login', { username: 'an6a', password: '123456' });
token = an.token;
const list = await call('GET', '/my/assignments');
ok(list.length === 1 && list[0].question_count > 40, 'học sinh 6A thấy 1 bài');
const start = await call('POST', `/my/assignments/${list[0].id}/start`);
const allQ = start.content.parts.flatMap((p) => p.questions);
ok(allQ.every((q) => q.answer === undefined && q.explanation === undefined), 'đề gửi cho học sinh không chứa đáp án');
// trả lời: đúng một số câu, sai một số câu
const ans = {};
const byNum = Object.fromEntries(exam.parts.flatMap((p) => p.questions).map((q) => [q.num, q]));
const idOf = (n) => byNum[n].id;
ans[idOf(1)] = 'C'; ans[idOf(2)] = 'B'; ans[idOf(6)] = 'F'; ans[idOf(21)] = 'D';
ans[idOf(36)] = 'Could'; ans[idOf(38)] = 'have ever eaten'; ans[idOf(42)] = 'than';
ans[idOf(76)] = 'at making friends?'; ans[idOf(81)] = "haven’t seen him for";
ans[idOf(87)] = "Unless you study hard, you won't pass the exam";
ans[idOf(84)] = 'Despite being tired, he continued working.';
ans[exam.parts.find((p) => p.topic === 'writing').questions[0].id] = 'Hi Tom, I like the news...';
await call('PUT', `/attempts/${start.attemptId}/save`, { answers: ans });
const resumed = await call('POST', `/my/assignments/${list[0].id}/start`);
ok(resumed.attemptId === start.attemptId && resumed.answers[idOf(1)] === 'C', 'lưu nháp & tiếp tục bài đang làm');
const result = await call('POST', `/attempts/${start.attemptId}/submit`, { answers: ans });
const r = Object.fromEntries(result.results.map((x) => [x.num ?? x.label, x]));
ok(r[1].correct && !r[2].correct && r[2].answer === 'A', 'chấm trắc nghiệm + trả đáp án đúng');
ok(r[36].correct && r[38].correct && !r[42].correct, 'chấm điền từ (không phân biệt hoa thường, nhiều đáp án)');
ok(r[76].correct && r[81].correct && r[87].correct && r[84].correct, 'chấm viết lại câu (phần đầu cho sẵn, viết tắt, từ khoá)');
ok(result.needsGrading && r.W1.pending, 'bài viết chờ giáo viên chấm');
console.log('  → điểm:', result.score, '/', result.maxScore, `(${result.percent}%)`);

// 5. Luyện tập theo chuyên đề (sau khi đã nộp)
const topics = await call('GET', '/practice/topics');
ok(topics.length > 5, 'có danh sách chuyên đề để luyện: ' + topics.map((t) => t.topic).join(','));
const pr = await call('POST', '/practice/start', { topic: 'vocabulary_grammar', count: 5 });
const prRes = await call('POST', `/attempts/${pr.attemptId}/submit`, { answers: {} });
ok(prRes.kind === 'practice' && prRes.results.length === 5, 'luyện tập 5 câu và nộp');

// 6. Giáo viên chấm bài viết + dashboard
token = admin.token;
const pending = await call('GET', '/grading/pending');
ok(pending.length === 1, 'có 1 bài chờ chấm');
const wId = r.W1.id;
const graded = await call('POST', `/attempts/${start.attemptId}/grade`, { items: { [wId]: { earned: 8, comment: 'Tốt' } } });
ok(!graded.needsGrading && graded.score === result.score + 8, 'chấm tay cập nhật tổng điểm');
const ov = await call('GET', '/dashboard/overview');
ok(ov.classes.length === 2 && ov.totals.submissions === 2, 'dashboard tổng quan');
const cd = await call('GET', `/dashboard/class/${c6a.id}`);
ok(cd.students.length === 2 && cd.topics.length > 5, 'dashboard lớp + chuyên đề');
const sd = await call('GET', `/dashboard/student/${an.user.id}`);
ok(sd.attempts.length === 2, 'tiến trình học sinh');
const ar = await call('GET', `/assignments/${asg[0].id}/results`);
ok(ar.students.length === 2 && ar.items.length > 30, 'kết quả theo bài + phân tích câu hỏi');
const csv = await call('GET', `/export/class/${c6a.id}`);
ok(csv.includes('Nguyễn An'), 'xuất CSV');

// 6b. Giao bài trùng (bấm nhiều lần) chỉ tạo 1 bài
const again = await call('POST', '/assignments', { examId: saved.id, classIds: [c6a.id], showAnswers: 'after_submit' });
const all6a = (await call('GET', '/assignments')).filter((a) => a.class_id === c6a.id);
ok(all6a.length === 1 && again[0].id === asg[0].id, 'giao trùng trong 2 phút không tạo bài mới');

// 6c. File nghe: tải lên theo mảnh và phát lại theo Range
const audio = new Uint8Array(7 * 1024 * 1024 + 123).map((_, i) => i % 251);
const media = await call('POST', '/media', { name: 'test.mp3', size: audio.length, mime: 'audio/mpeg' });
for (let n = 0; n < media.chunks; n++) {
  const part = audio.slice(n * media.chunkSize, Math.min(audio.length, (n + 1) * media.chunkSize));
  const res = await api(new Request('http://localhost/api/media/' + media.id + '/' + n, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer ' + token }, body: part }));
  if (!res.ok) throw new Error('upload ' + res.status + ' ' + await res.text());
}
const r1 = await api(new Request('http://localhost' + media.url, { headers: { range: 'bytes=3145700-' } }));
const b1 = new Uint8Array(await r1.arrayBuffer());
ok(r1.status === 206 && b1[0] === audio[3145700] && b1.length === media.chunkSize - 3145700, 'phát file nghe theo Range (206): ' + r1.headers.get('content-range'));
const r2 = await api(new Request('http://localhost' + media.url, { headers: { range: 'bytes=7340000-' } }));
const b2 = new Uint8Array(await r2.arrayBuffer());
ok(r2.status === 206 && b2[b2.length - 1] === audio[audio.length - 1], 'đọc tới cuối file nghe');

// 6c2. Nhập file nghe từ link (giả lập Google Drive bằng máy chủ cục bộ)
const http = await import('node:http');
const { driveId, directUrl } = await import('../netlify/lib/remote-audio.mjs');
ok(driveId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing') === '1AbCdEfGhIjKlMnOp'
  && driveId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp') === '1AbCdEfGhIjKlMnOp'
  && directUrl('https://www.dropbox.com/s/x/a.mp3?dl=0').endsWith('dl=1'), 'nhận diện link Google Drive / Dropbox');
const big = new Uint8Array(5 * 1024 * 1024 + 777).map((_, i) => (i * 7) % 253);
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/private')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>Sign in</html>'); }
  const m = (req.headers.range || '').match(/bytes=(\d+)-(\d+)/);
  if (req.url.startsWith('/norange') || !m) { res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': big.length }); return res.end(Buffer.from(big)); }
  const a = +m[1], b = Math.min(+m[2], big.length - 1);
  res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': `bytes ${a}-${b}/${big.length}`, 'content-disposition': 'attachment; filename="Part 1.mp3"' });
  res.end(Buffer.from(big.slice(a, b + 1)));
});
await new Promise((r) => srv.listen(5577, r));
process.env.ALLOW_HTTP_AUDIO = '1';
for (const path of ['/ranged', '/norange']) {
  const imp = await call('POST', '/media/import', { url: 'http://127.0.0.1:5577' + path });
  for (let n = 0; n < imp.chunks; n++) await call('POST', `/media/${imp.id}/fetch/${n}`);
  const got = new Uint8Array(await (await api(new Request('http://localhost' + imp.url, { headers: { range: 'bytes=3145728-' } }))).arrayBuffer());
  ok(imp.size === big.length && got[0] === big[3145728] && got[got.length - 1] === big[big.length - 1], `nhập file nghe từ link (${path}) → phát lại đúng dữ liệu`);
}
let privErr = null; try { await call('POST', '/media/import', { url: 'http://127.0.0.1:5577/private' }); } catch (e) { privErr = e.message; }
ok(/chia sẻ công khai/.test(privErr || ''), 'link chưa chia sẻ: báo lỗi dễ hiểu');
const head = await api(new Request('http://localhost' + media.url, { method: 'HEAD' }));
ok(head.status === 200 || head.status === 206, 'hỗ trợ yêu cầu HEAD (Safari)');
srv.close();

// 6d. Gmail cho học sinh + cấu hình Google
const cfg = await call('GET', '/config', null, null);
ok('googleClientId' in cfg, 'API cấu hình Google');
await call('PUT', '/users/' + an.user.id, { email: 'An.Nguyen@Gmail.com' });
const lst = await call('GET', '/users?role=student');
ok(lst.find((u) => u.id === an.user.id).email === 'an.nguyen@gmail.com', 'gán Gmail cho học sinh');
let gErr = null;
try { await call('POST', '/auth/google', { credential: 'x' }, null); } catch (e) { gErr = e.message; }
ok(/GOOGLE_CLIENT_ID|Google/.test(gErr || ''), 'đăng nhập Google báo rõ khi chưa cấu hình');

// 6e. Đăng nhập Google (giả lập phản hồi tokeninfo của Google)
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
const realFetch = globalThis.fetch;
let gUser = { email: 'an.nguyen@gmail.com', sub: 'g-111', name: 'An Nguyễn' };
globalThis.fetch = async (url, o) => String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')
  ? new Response(JSON.stringify({ aud: process.env.GOOGLE_CLIENT_ID, iss: 'accounts.google.com', exp: String((Date.now() / 1000 + 3600) | 0), email_verified: 'true', ...gUser }))
  : realFetch(url, o);
const gl = await call('POST', '/auth/google', { credential: 'tok' }, null);
ok(gl.user.id === an.user.id, 'đăng nhập Google bằng Gmail giáo viên đã gán cho học sinh');
gUser = { email: 'moi.hocsinh@gmail.com', sub: 'g-222', name: 'Học Sinh Mới' };
ok(await refused(() => call('POST', '/auth/google', { credential: 'tok', joinCode: c6a.join_code, fullName: 'Học Sinh Mới' }, null)), 'Gmail lạ không tự tạo được tài khoản');
gUser = { email: 'dung@gmail.com', sub: 'g-444', name: 'Dũng' };
ok((await call('POST', '/auth/google', { credential: 'tok' }, null)).user.username === 'dung6b', 'Gmail quản trị viên gắn khi đăng ký → đăng nhập Google được');
gUser = { email: 'cogiao@gmail.com', sub: 'g-333', name: 'Cô Lan' };
await call('POST', '/me/google', { credential: 'tok' }, admin.token);
ok((await call('POST', '/auth/google', { credential: 'tok' }, null)).user.role === 'admin', 'giáo viên liên kết Gmail rồi đăng nhập bằng Google');
globalThis.fetch = realFetch;

// 6f. Tốc độ + sao lưu / khôi phục
token = admin.token;
const h = await call('GET', '/health');
ok(typeof h.dbMs === 'number', 'đo tốc độ CSDL: ' + h.dbMs + 'ms, driver ' + h.driver);
const dump = {};
for (const tb of ['classes', 'users', 'exams', 'assignments', 'attempts', 'attempt_items', 'media']) {
  dump[tb] = []; let off = 0;
  while (off != null) { const r = await call('GET', `/admin/backup/${tb}?offset=${off}`); dump[tb].push(...r.rows); off = r.next; }
}
const before = Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
token = (await call('POST', '/admin/restore/begin', { confirm: 'XOA_HET' })).restoreToken;
for (const [tb, rows] of Object.entries(dump)) if (rows.length) await call('POST', `/admin/restore/rows/${tb}`, { rows });
await call('POST', '/admin/restore/finish');
let blocked = false; try { await call('GET', '/classes'); } catch { blocked = true; }
ok(blocked, 'mã khôi phục tạm thời không dùng được cho việc khác');
token = admin.token;
const ov2 = await call('GET', '/dashboard/overview');
const newCls = await call('POST', '/classes', { name: '7A', grade: 7 });
ok(ov2.totals.submissions === dump.attempts.filter((a) => a.status === 'submitted').length && ov2.classes.length === dump.classes.length && newCls.id > Math.max(...dump.classes.map((c) => c.id)), 'sao lưu → khôi phục giữ nguyên dữ liệu, id tiếp tục đúng: ' + JSON.stringify(before));

// 7. Phân quyền
let denied = false;
try { await call('GET', '/classes', null, an.token); } catch { denied = true; }
ok(denied, 'học sinh không gọi được API quản trị');

console.log('\nTất cả kiểm thử API đều đạt ✔');
process.exit(0);
