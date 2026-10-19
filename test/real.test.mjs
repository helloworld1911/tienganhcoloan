// node test/real.test.mjs <đề.docx> <đáp-án.docx> [--keep-all]
import fs from 'node:fs';
import mammoth from 'mammoth';
import { htmlToBlocks, pdfPagesToBlocks, parseExam, attachAnswerKey, finalizeExam, summarize, TOPICS } from '../public/js/parser.js';
const [examFile, keyFile] = process.argv.slice(2);
const opt = { styleMap: ['u => u', 'b => b', 'i => i'] };
const toBlocks = async (f) => {
  if (f.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), verbosity: 0 }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      await page.getOperatorList();
      const tc = await page.getTextContent();
      pages.push(tc.items.map((it) => {
        const font = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName) : null;
        return { str: it.str, x: it.transform[4], y: Math.round(it.transform[5]), w: it.width, bold: /bold|black|heavy|semibold|,B\b/i.test(font?.name || '') };
      }));
    }
    return pdfPagesToBlocks(pages);
  }
  return htmlToBlocks((await mammoth.convertToHtml({ buffer: fs.readFileSync(f) }, opt)).value);
};
const exam = parseExam(await toBlocks(examFile), { fileName: examFile.split('/').pop() });
const r = keyFile ? attachAnswerKey(exam, await toBlocks(keyFile)) : null;
const removed = finalizeExam(exam, { drop: process.argv.includes('--keep-all') ? [] : undefined });
console.log('Tiêu đề:', exam.title, '| Lớp:', exam.grade, '| Đáp án:', r, '| Đã bỏ:', removed);
for (const p of exam.parts) {
  console.log(`\n[${p.section.slice(0, 30)} / ${p.title}] ${TOPICS[p.topic]} – ${p.questions.length} câu – ${p.points ?? '?'}đ`);
  console.log('   HD:', p.instruction.slice(0, 100));
  if (p.passageHtml) console.log('   Bài đọc:', p.passageHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100));
  for (const q of p.questions) {
    console.log(`   ${q.num}. [${q.type}] ${q.stemHtml.replace(/<[^>]+>/g, '').slice(0, 75)}${q.lead ? ' → ' + q.lead : ''}`
      + (q.options.length ? '\n        ' + q.options.map((o) => o.key + ':' + o.html.replace(/<[^>]+>/g, '')).join(' | ').slice(0, 120) : '')
      + `\n        ✔ ${q.answer || '❗THIẾU'}${q.accepted?.length > 1 ? ' (' + q.accepted.join(' || ') + ')' : ''}`
      + (q.explanation ? `\n        💡 ${q.explanation.replace(/\n/g, ' ⏎ ').slice(0, 110)}` : ''));
  }
}
const s = summarize(exam);
console.log('\nTổng:', s.total, 'câu, có đáp án:', s.withAns, '| thiếu:', exam.parts.flatMap((p) => p.questions).filter((q) => !q.answer && q.type !== 'essay').map((q) => q.num).join(',') || 'không');
