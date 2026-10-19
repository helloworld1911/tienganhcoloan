// Kiểm thử bộ phân tích đề với file mẫu (node test/parser.test.mjs [đề.docx] [đáp-án.docx])
import fs from 'node:fs';
import mammoth from 'mammoth';
import { htmlToBlocks, parseExam, parseAnswerKey, applyAnswerKey, summarize, TOPICS } from '../public/js/parser.js';

const examFile = process.argv[2] || new URL('./fixtures/de-hsg-anh6.docx', import.meta.url).pathname;
const keyFile = process.argv[3] || new URL('./fixtures/dap-an-hsg-anh6.docx', import.meta.url).pathname;
const opt = { styleMap: ['u => u', 'b => b', 'i => i'] };

const toBlocks = async (f) => htmlToBlocks((await mammoth.convertToHtml({ buffer: fs.readFileSync(f) }, opt)).value);
const exam = parseExam(await toBlocks(examFile), { fileName: 'de.docx' });
const nums = new Set(exam.parts.flatMap((p) => p.questions.map((q) => q.num)).filter((n) => n != null));
const key = parseAnswerKey(await toBlocks(keyFile), nums);
const applied = applyAnswerKey(exam, key);

console.log('Tiêu đề:', exam.title, '| Lớp:', exam.grade, '| Thời gian:', exam.timeLimit);
for (const p of exam.parts) {
  console.log(`\n[${p.title}] ${TOPICS[p.topic]} (${p.kind}) – ${p.points ?? '?'}đ – ${p.questions.length} câu`);
  console.log('   HD:', p.instruction.slice(0, 80));
  if (p.passageHtml) console.log('   Bài đọc:', p.passageHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 90));
  for (const q of p.questions) {
    console.log(`   ${q.num ?? q.label}. [${q.type}] ${q.stemHtml.slice(0, 70)}${q.lead ? ' → ' + q.lead : ''}${q.keyword ? ' {' + q.keyword + '}' : ''}`
      + (q.options.length ? '\n        ' + q.options.map((o) => o.key + ':' + o.html).join(' | ') : '')
      + `\n        ✔ ${q.answer}${q.accepted.length > 1 ? ' (' + q.accepted.join(' || ') + ')' : ''}${q.explanation ? ' — ' + q.explanation : ''}`);
  }
}
console.log('\nĐã gắn đáp án:', applied, summarize(exam));
const missing = exam.parts.flatMap((p) => p.questions).filter((q) => !q.answer && q.type !== 'essay').map((q) => q.num);
console.log('Thiếu đáp án:', missing.join(', ') || 'không');
