// Giả lập máy chủ HTTP của Neon bằng PGlite – để chạy thử bản Cloudflare (wrangler dev) mà không cần Neon thật.
//   node test/neon-mock.mjs  → http://127.0.0.1:4444/sql
//   rồi chạy worker với NEON_FETCH_ENDPOINT=http://127.0.0.1:4444/sql và DATABASE_URL dạng ...neon.tech...
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';

const db = await PGlite.create();
const PORT = +process.env.MOCK_PORT || 4444;

const ARRAY_TYPES = new Set([1000, 1005, 1007, 1009, 1015, 1016, 1021, 1022]);
function toText(v, oid) {
  if (v === null || v === undefined) return null;
  if (oid === 114 || oid === 3802) return JSON.stringify(v);
  if (ARRAY_TYPES.has(oid)) return '{' + v.map((x) => (x === null ? 'NULL' : JSON.stringify(String(x)))).join(',') + '}';
  if (v instanceof Date) { // định dạng chữ của Postgres thật: 2026-10-20 15:19:31.157+00
    const iso = v.toISOString().replace('T', ' ').replace('Z', '');
    return oid === 1114 ? iso : oid === 1082 ? iso.slice(0, 10) : iso + '+00';
  }
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (v instanceof Uint8Array) return '\\x' + Buffer.from(v).toString('hex');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
async function run(tx, { query, params }) {
  // PGlite không nhận chuỗi 'true'/'false' cho cột boolean (Postgres thật thì nhận) → đổi sang true/false
  const ps = (params || []).map((v) => (v === 'true' ? true : v === 'false' ? false : v));
  const r = await tx.query(query, ps, { rowMode: 'array' });
  return {
    command: (query.trim().split(/\s+/)[0] || '').toUpperCase(), rowCount: r.affectedRows ?? r.rows.length,
    fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: r.rows.map((row) => row.map((v, i) => toText(v, r.fields[i].dataTypeID))),
  };
}
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const out = body.queries ? { results: await db.transaction(async (tx) => { const a = []; for (const q of body.queries) a.push(await run(tx, q)); return a; }) } : await run(db, body);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
  } catch (e) {
    if (process.env.MOCK_DEBUG) { (await import('node:fs')).writeFileSync(process.env.MOCK_DEBUG_FILE || '/dev/null', Buffer.concat(chunks)); const b = JSON.parse(Buffer.concat(chunks).toString()); for (const q of b.queries || [b]) console.error(e.message, '|', q.query.slice(0, 120), '|', JSON.stringify((q.params || []).map((x) => (typeof x === 'string' && x.length > 60 ? x.slice(0, 60) + '…' : x)))); }
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: e.message, code: e.code }));
  }
}).listen(PORT, '127.0.0.1', () => console.log('Neon giả lập: http://127.0.0.1:' + PORT + '/sql'));
