// Kiểm thử API end-to-end trên Postgres giả lập (PGlite) – node test/api.test.mjs
import fs from 'node:fs';
import mammoth from 'mammoth';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { htmlToBlocks, parseExam, parseAnswerKey, applyAnswerKey } from '../public/js/parser.js';

const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port: 5544, host: '127.0.0.1' });
await server.start();
process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5544/postgres?sslmode=disable';
process.env.JWT_SECRET = 'test-secret';
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
const reg = await call('POST', '/auth/register', { fullName: 'Phạm Dũng', username: 'dung6b', password: '123456', joinCode: c6b.join_code });
ok(reg.user.classId === c6b.id, 'học sinh tự đăng ký bằng mã lớp');

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

// 7. Phân quyền
let denied = false;
try { await call('GET', '/classes', null, an.token); } catch { denied = true; }
ok(denied, 'học sinh không gọi được API quản trị');

console.log('\nTất cả kiểm thử API đều đạt ✔');
await server.stop();
process.exit(0);
