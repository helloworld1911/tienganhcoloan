// Chạy thử toàn bộ web trên máy, KHÔNG cần Netlify hay Postgres:
//   npm run local   → mở http://localhost:8888
// Dữ liệu lưu trong thư mục .localdb (PGlite – Postgres chạy trong Node).
// Nếu đã có DATABASE_URL thì dùng Postgres thật.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = +process.env.PORT || 8888;
const root = path.resolve(process.env.STATIC_DIR || new URL('../public', import.meta.url).pathname); // STATIC_DIR=dist để thử bản đóng gói

if (!process.env.DATABASE_URL && !process.env.NETLIFY_DB_URL) {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.LOCAL_DB_DIR || new URL('../.localdb', import.meta.url).pathname;
  const db = await PGlite.create(dir === 'memory' ? undefined : dir);
  const { useLocalDb } = await import('../netlify/lib/db.mjs');
  useLocalDb(db);
  process.env.JWT_SECRET ||= 'local-dev-secret';
  process.env.MEDIA_DIR ||= (dir === 'memory' ? '/tmp/engweb-media' : dir + '-media');
  console.log('CSDL cục bộ (PGlite):', dir);
}
const { default: api } = await import('../netlify/functions/api.mjs');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e); res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`Tiếng Anh cô Loan đang chạy: http://localhost:${PORT}`));
