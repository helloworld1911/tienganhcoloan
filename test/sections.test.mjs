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

// ---- Đề thứ 2: tiêu đề trong bảng, "Each … contains one error" (không gạch chân), phương án 2 cột, chỗ trống "(1. COLLECT)",
//      đoạn mô tả A–E dài + câu hỏi bắt đầu bằng "______ 1.", mũi tên ⇨, đáp án "VIII:" có dấu hai chấm, câu hỏi tranh (li + hàng tranh)
const exam2Html = `
<table><tr><td><p>PHÒNG GD&amp;ĐT</p></td><td><p>ĐỀ THI CHỌN ĐỘI TUYỂN HSG</p><p>Môn thi: Tiếng Anh Lớp 7</p></td></tr>
<tr><td><p>Lưu ý:</p></td><td><p>- Đề thi gồm 07 trang, thí sinh làm bài trực tiếp vào đề thi.</p></td></tr></table>
<p><b>Phần 1 - TRẮC NGHIỆM -30 ĐIỂM</b></p>
<p><b>I. LISTENING.<i> (5 điểm)</i></b></p>
<p><b>Part 1. Listen and choose the correct picture and write A, B or C in the box. (2 pts)</b></p>
${li(['What time does Mary start work?'])}<table>${row('<img src="data:image/png;base64,AA">', '<img src="data:image/png;base64,BB">', '<img src="data:image/png;base64,CC">')}${row('A', 'B', 'C')}</table>
<p><b>II. Choose the best answer to complete the sentences by choosing A, B, C or D. (2 pts)</b></p>
<p>1. You should avoid ______ cold water when you ______ a cough.</p>
<p>A. to drink/have C. to drink/are having</p><p>B. drinking/have D. drinking/ are having</p>
<p><b>Phần 2: TỰ LUẬN- 70 ĐIỂM</b></p>
<p><b>II. Fill in each blank with the correct form of the word in brackets. (2pts)</b></p>
<p>Most of us have a CD <b>(1. COLLECT)</b>. Although many <b>(2. CHILD)</b> have never seen an LP, they love music.</p>
<p><b>III . Each following sentence contains one error. Underline and correct it. (2 pts)</b></p>
<p>1. Traffic jam didn't used to happen when I was small.</p><p>2. She has donated a lot of money for local charities.</p>
<p><b>VI. Read the descriptions below of the activities. Then write A, B, C, D or E to show the most suitable activity for each person. (2pts)</b></p>
<p><b>A.</b> The Mystery Park is part of the National Park. Sailing, swimming and other water sports are available at the club with teachers.</p>
<p><b>B.</b> The City Farm is for everyone who loves animals and wants to learn more about trees and fruit. There are horses and cows.</p>
<p><b>C.</b> The Sports Center offers table-tennis, badminton, indoor football and karate. It is open every day except Sunday evenings.</p>
<p><b>D.</b> The Walking Club meets every Saturday morning. Club members take part in walks and discussion. Suitable for retired people.</p>
<p><b>E.</b> The Play Center with a lot of activities for children is open every day. There are different play areas for different ages.</p>
<p>______ 1. Tuan wants to learn swimming in the afternoon after university.</p>
<p>______ 2. Mr. and Mrs. Binh are over 60 years old and want to meet people of the same age.</p>
<p><b>VIII. Use the given word to write the second sentence. (2 pts)</b></p>
<p>1. My friend is a big fan of K-Pop music. (FOND)</p><p>⇨ My friend ______________________</p>
<p>2. She hasn't made as many mistakes as last time. (FEWER)</p><p>⇨ She ______________________</p>
`;
const key2Html = `
<p><b>A. LISTENING.<i> (5 điểm)</i></b></p>
<p><b><i>Part I</i>. Listen and tick the box. (2 pts)</b></p><p>1. B. at 7 o'clock</p>
<p><b>II. Phonetics and vocabulary (2 pts)</b></p><p>1. B</p>
<p><b>PHẦN 2: TỰ LUẬN</b></p>
<p><b>II. 2 pts</b></p><table><tr><td><p>1. collection</p><p>2. children</p></td></tr></table>
<p><b>III. 2 pts</b></p><table><tr><td><p>1. used - use</p><p>2. for - to</p></td><td><p></p></td></tr></table>
<p><b>VI. 2 pts</b></p><p>1. A 2. D</p>
<p><b>VIII:</b> <b>2 pts</b></p><p>1. My friend is fond of K-Pop music.</p><p>2. She has made fewer mistakes than last time.</p>
`;
const ex2 = parseExam(htmlToBlocks(exam2Html), { fileName: 'de2.docx' });
const r2 = attachAnswerKey(ex2, htmlToBlocks(key2Html));
finalizeExam(ex2);
const p2 = (t, k = 0) => ex2.parts.filter((p) => p.title === t)[k];
ok(ex2.title === 'ĐỀ THI CHỌN ĐỘI TUYỂN HSG – Tiếng Anh Lớp 7', 'tiêu đề lấy từ bảng đầu đề, bỏ qua dòng "Lưu ý: Đề thi gồm 07 trang…": ' + ex2.title);
ok(r2.mode === 'sections' && ex2.parts.map((p) => p.questions.length).join(',') === '1,1,2,2,2,2', 'đề 2: đủ các phần ' + ex2.parts.map((p) => p.title + ':' + p.questions.length).join(' '));
const pic = p2('Part 1');
ok(pic.questions[0].options.length === 3 && pic.questions[0].options[0].html.includes('<img') && pic.questions[0].answer === 'B', 'câu chọn tranh (dòng tự đánh số + hàng tranh) vẫn nhận đúng, không bị coi là ngân hàng phương án');
ok(p2('II').questions[0].options.map((o) => o.html).join('|') === 'to drink/have|drinking/have|to drink/are having|drinking/ are having', 'phương án xếp 2 cột (A…C / B…D)');
const wf = ex2.parts.find((p) => p.topic === 'word_form');
ok(wf.questions.map((q) => q.baseWord + '→' + q.answer).join(',') === 'COLLECT→collection,CHILD→children' && /class="gap"/.test(wf.passageHtml) && !/class="gap"[^>]*><span/.test(wf.passageHtml), 'chỗ trống "(1. COLLECT)" trong đoạn văn');
const ef = ex2.parts.find((p) => p.topic === 'error_identification');
ok(ef.questions.every((q) => q.type === 'gap') && ef.questions[0].answer === 'used → use' && isTextCorrect(ef.questions[0], 'used -> use') && isTextCorrect(ef.questions[1], 'to') && !isTextCorrect(ef.questions[1], 'for'), 'câu có MỘT lỗi không gạch chân: ghi "từ sai → từ đúng", đáp án "used - use"');
const vi2 = p2('VI');
ok(vi2.questions.length === 2 && vi2.questions[0].stemHtml.startsWith('Tuan') && vi2.questions[0].options.length === 5 && vi2.questions[0].options[0].html.length < 60
  && /Mystery Park/.test(vi2.passageHtml) && vi2.topic === 'reading_comprehension' && ans(vi2) === 'A,D', 'đoạn mô tả A–E dài ở bài đọc, câu "______ 1." chọn chữ cái, đáp án A,D');
const v8 = p2('VIII');
ok(v8.questions[0].lead === 'My friend ___' && v8.questions[1].answer.startsWith('She has made fewer'), 'mũi tên ⇨ và đáp án "VIII:" (dấu hai chấm)');
console.log('\nTất cả kiểm thử đề chia phần đều đạt ✔');
