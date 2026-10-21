// Kiểm thử: đề & đáp án đánh số lại từ 1 ở mỗi phần, phiếu "Your answers", ngân hàng phương án A–G,
// ghép tiêu đề, bài tìm & sửa lỗi trong đoạn văn (bảng Line/Error/Correction), phương án gõ thiếu dấu.
//   node test/sections.test.mjs
import { htmlToBlocks, parseExam, attachAnswerKey, finalizeExam } from '../public/js/parser.js';
import { isTextCorrect } from '../netlify/lib/grade.mjs';

const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const li = (items) => `<ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>`;
const row = (...cells) => `<tr>${cells.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`;

const examHtml = `
<p><b>Phần 1 - TRẮC NGHIỆM - 40 ĐIỂM</b></p>
<p><b>I. LISTENING. (10 pts)</b></p>
<p><b>Part 1. You will hear a talk. Listen and choose the best answer A, B, C or D. (4 pts)</b></p>
<p>1. Where is the library?</p><p>A. near the gate B. behind the hall C. in the city D. on the hill</p>
<p>2. When does it open?</p><p>A. 7 a.m. B. 8 a.m. C. 9 a.m. D. 10 a.m.</p>
<p><b>Part 2: You will hear five people. Choose the best answer (A, B or C). (6 pts)</b></p>
<p>1. Why does she recommend it?</p><p>A. cheap B. quiet C. near</p>
<p><b>II. Choose the best answer to complete the sentences by choosing A, B, C or D. (15 pts)</b></p>
<p>1. "Can you help me?" " _______ "</p><p>A. I think so, too B. Yes, I'm afraid not. C. Not completely. D Why not?</p>
<p>2. Not everyone believes that ____ technology improved ____ quality of life.</p><p>A. Ø / the B.Ø/a C. the / the D.the / Ø</p>
<p>3. She prefers going out to ______ at home.</p><p>A. stay B. staying C. stayed D. stays</p>
<p><b><i>Your answers:</i></b><i> 1. _______ 2. _______ 3. _______</i></p>
<p><b>Phần 2: TỰ LUẬN- 60 ĐIỂM</b></p>
<p><b>I. Complete the sentences with the correct form of the verbs in brackets. (5 pts)</b></p>
<p>1. He usually (do) ________ his homework.</p>
<p>2. Yesterday I (go) ________ to school.</p>
<p><b><i>Your answers:</i></b></p><p><i> 1. _______________ 2. _______________</i></p>
<p><b>III . There are 2 mistakes. Read the following paragraph, find and correct mistakes .(4pts)</b></p>
<p>It is much easy for us to study online. Many students say that they like it. Online learning is cheap because of we just stay at home.</p>
<p>Your answers:</p>
<table>${row('Line', 'Error', 'Correction')}${row('Line ____', '', '')}${row('Line ____', '', '')}</table>
<p><b><i>V.</i> There are THREE blanks in the passage below. From the options given below, choose the most suitable for each blank. (3 pts)</b></p>
${li(['So we planted them near the gate.', 'However, it rained a lot!', 'That was a great idea.', 'Nobody came.'])}
<p>Our teacher suggested planting trees. (1)________. We did not know where to plant them. (2)________. Then the weather changed. (3)________.</p>
<p><b><i>Your answers:</i></b><i> 1. _______ 2. _______ 3. _______</i></p>
<p><b>VI. Read the text and match the headings (A- C) with the paragraphs (1- 2). (2pts)</b></p>
${li(['Why are friends websites popular?', 'How do friends websites work?', 'Where do friends live?'])}
<p>1. Because of websites like MySpace, people can make friends online and share photos.</p>
<p>2. For many young people, a good homepage is an important part of their image and identity.</p>
<p><b><i>Your answers:</i></b><i> 1. _______ 2. _______</i></p>
`;
const keyHtml = `
<p><b>Phần 1 - TRẮC NGHIỆM - 40 ĐIỂM</b></p>
<p><b>I. LISTENING.<i> (10 pts)</i></b></p>
<p><b>1. Part 1 (4 pts)</b></p><table>${row('1. B', '2. C')}</table>
<p><b>2. Part 2 (6 pts)</b></p><p>1. A</p>
<p><b>II. 15 pts<i> (Mỗi đáp án đúng 1 điểm)</i></b></p><p>1. D 2. A 3. B</p>
<p><b>PHẦN 2: TỰ LUẬN – 60 ĐIỂM</b></p>
<p><b>I. 5 pts</b></p><p>1. does 2. went</p>
<p><b>III. 4 pts</b></p>
<table>${row('Line', 'Error', 'Correction')}${row('Line 1', 'easy', 'easier')}<tr><td><p>Line 2</p></td><td><p>because of/</p><p>of</p></td><td><p>because/ as/</p><p>Ø/ bỏ (of)</p></td></tr></table>
<p><b><i>V. (3pts)</i></b></p><table>${row('1, C', '2, A', '3, B')}</table>
<p><b>VI. 2 pts</b></p><p><b>1.A 2.B</b></p>
`;

const exam = parseExam(htmlToBlocks(examHtml), { fileName: 'de.docx' });
const r = attachAnswerKey(exam, htmlToBlocks(keyHtml));
finalizeExam(exam);
const byTitle = (t, i = 0) => exam.parts.filter((p) => p.title === t)[i];
const ans = (p) => p.questions.map((q) => q.answer).join(',');

ok(r.mode === 'sections', 'nhận ra đáp án chia theo phần (đánh số lại từ 1 mỗi phần)');
ok(exam.parts.map((p) => p.questions.length).join(',') === '2,1,3,2,2,3,2', 'phiếu "Your answers" không bị tính là câu hỏi: ' + exam.parts.map((p) => p.title + ':' + p.questions.length).join(' '));
ok(ans(byTitle('Part 1')) === 'B,C' && ans(byTitle('Part 2')) === 'A', 'đáp án nghe khớp theo Part 1 / Part 2');
const ii = byTitle('II');
ok(ii.topic === 'vocabulary_grammar' && ans(ii) === 'D,A,B', 'phần II (sau nhóm LISTENING) không bị coi là bài nghe, đáp án đúng');
ok(ii.questions[0].options.length === 4 && ii.questions[0].options[3].html.includes('Why not'), 'phương án gõ thiếu dấu chấm ("D Why not?")');
ok(ii.questions[1].options.map((o) => o.html).join('|') === 'Ø / the|Ø/a|the / the|the / Ø', 'phương án gõ thiếu dấu cách ("B.Ø/a", "D.the")');
ok(ans(byTitle('I', 0).topic === 'listening' ? byTitle('I', 1) : byTitle('I')) === 'does,went', 'Phần 2 – I: chia động từ khớp đúng phần (không lẫn với I. LISTENING)');
const err = byTitle('III');
ok(err && err.topic === 'error_identification' && err.questions.length === 2, 'bài tìm & sửa lỗi trong đoạn văn → mỗi lỗi một câu');
ok(err.questions[0].stemHtml.startsWith('It is much easy') && err.questions[0].accepted.includes('easier') && err.questions[0].accepted.includes('easy → easier'), 'câu sửa lỗi 1: "easy → easier"');
ok(err.questions[1].stemHtml.includes('because of we just stay') && err.questions[1].accepted.includes('bỏ of') && err.questions[1].accepted.includes('because of → as'), 'câu sửa lỗi 2: nhiều cách sửa, có "bỏ (of)"');
const v = byTitle('V');
ok(v.questions.every((q) => q.type === 'mcq' && q.options.length === 4) && v.questions[0].options[2].html.includes('great idea') && ans(v) === 'C,A,B', 'chọn câu A–D điền vào chỗ trống (danh sách tự đánh chữ của Word) + đáp án "1, C"');
const vi = byTitle('VI');
ok(vi.questions.every((q) => q.options.length === 3) && ans(vi) === 'A,B' && vi.questions[0].stemHtml.includes('MySpace'), 'ghép tiêu đề A–C với đoạn văn 1–2');
const [e1, e2] = err.questions;
ok(['easy → easier', 'easy -> easier', 'Easy => easier', 'easier', 'easy - easier'].every((g) => isTextCorrect(e1, g)) && !isTextCorrect(e1, 'easy') && !isTextCorrect(e1, 'study → studied'), 'chấm câu sửa lỗi: nhận nhiều cách ghi, không nhận đáp án sai');
ok(['because of → because', 'bỏ of', 'as', 'of → bỏ'].every((g) => isTextCorrect(e2, g)), 'chấm câu sửa lỗi có nhiều cách sửa / bỏ từ');
console.log('\nTất cả kiểm thử đề chia phần đều đạt ✔');
