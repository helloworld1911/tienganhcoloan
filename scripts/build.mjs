// Đóng gói giao diện cho Netlify: gộp + nén JS/CSS, tên file có mã băm để trình duyệt nhớ lâu.
//   npm run build  →  thư mục dist/
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = path.join(root, 'public');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. sao chép file tĩnh (trừ mã nguồn JS/CSS sẽ được đóng gói)
fs.cpSync(src, out, { recursive: true, filter: (f) => !/[\\/]public[\\/](js|css)([\\/]|$)/.test(f) });

// 2. JS: tách theo trang (tải khi cần), nén, có mã băm
const js = await build({
  entryPoints: [path.join(src, 'js/app.js')],
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020',
  outdir: path.join(out, 'assets'), entryNames: 'app-[hash]', chunkNames: 'c-[hash]',
  external: ['/vendor/*'], metafile: true, legalComments: 'none', logLevel: 'warning',
});
// 3. CSS
const css = await build({
  entryPoints: [path.join(src, 'css/app.css')], bundle: true, minify: true,
  outdir: path.join(out, 'assets'), entryNames: 'app-[hash]', metafile: true, logLevel: 'warning',
});
const find = (meta, ext) => Object.keys(meta.outputs).find((f) => /app-[^/]+$/.test(f) && f.endsWith(ext)).split('/assets/')[1];
const jsFile = find(js.metafile, '.js');
const cssFile = find(css.metafile, '.css');
// các file JS mà file chính cần ngay → tải trước cùng lúc
const entryOut = Object.entries(js.metafile.outputs).find(([f]) => f.endsWith(jsFile))[1];
const staticImports = entryOut.imports.filter((i) => i.kind === 'import-statement').map((i) => i.path.split('/assets/')[1]);

// 4. index.html trỏ tới file đã đóng gói + tải trước file JS chính
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = html.replace('/css/app.css', `/assets/${cssFile}`)
  .replace('<script type="module" src="/js/app.js"></script>', `<script type="module" src="/assets/${jsFile}"></script>`)
  .replace('</head>', [jsFile, ...staticImports].map((f) => `  <link rel="modulepreload" href="/assets/${f}">`).join('\n') + '\n</head>');
fs.writeFileSync(path.join(out, 'index.html'), html);

const size = (f) => (fs.statSync(path.join(out, 'assets', f)).size / 1024).toFixed(1) + 'KB';
console.log('Đã đóng gói:');
for (const f of fs.readdirSync(path.join(out, 'assets')).sort()) console.log('  assets/' + f, size(f));
