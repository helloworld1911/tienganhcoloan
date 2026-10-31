// ============================================================================
//  API duy nhất cho toàn bộ ứng dụng: /api/*
// ============================================================================
import { q, one, batch, ensureSchema, pingDb, driverKind } from '../lib/db.mjs';
import { hashPassword, verifyPassword, needsRehash, signToken, verifyToken, randomCode } from '../lib/auth.mjs';
import { gradeAttempt, gradeQuestion, totals, stripAnswers } from '../lib/grade.mjs';
import { putChunk, getChunk, deletePrefix, storageInfo } from '../lib/storage.mjs';
import { driveId, directUrl, fetchRange } from '../lib/remote-audio.mjs';
import crypto from 'node:crypto';

export const config = { path: '/api/*' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const num = (v) => (v == null ? null : Number(v));
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const isStaff = (u) => u && (u.role === 'admin' || u.role === 'teacher');

// ------------------------------------------------------------------ router
const routes = [];
const route = (method, pattern, role, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, role, handler });
};

// Nhớ thông tin tài khoản 20 giây trong mỗi phiên bản hàm → đỡ 1 truy vấn cho mỗi yêu cầu
const userCache = new Map();
async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && hit.exp > Date.now()) return hit.user;
  const user = await one('SELECT id, username, full_name, role, class_id, active, email, google_sub, password_set FROM users WHERE id=$1', [id]);
  if (userCache.size > 500) userCache.clear();
  userCache.set(id, { user, exp: Date.now() + 20_000 });
  return user;
}
const forgetUser = (id) => userCache.delete(+id);

export default async function handler(req) {
  try {
    await ensureSchema();
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';
    // HEAD (Safari hay hỏi trước khi phát file nghe) dùng chung xử lý với GET
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const r = routes.find((x) => x.method === method && x.re.test(path));
    if (!r) fail(404, 'Không tìm thấy API');
    const m = path.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let body = {};
    if (req.method !== 'GET' && req.method !== 'DELETE' && !(req.headers.get('content-type') || '').startsWith('application/octet-stream')) {
      const text = await req.text();
      if (text) { try { body = JSON.parse(text); } catch { fail(400, 'Dữ liệu gửi lên không hợp lệ'); } }
    }
    let user = null;
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token) {
      const p = verifyToken(token);
      // mã khôi phục tạm thời: dùng được khi bảng users đang trống giữa lúc khôi phục
      if (p?.restore && path.startsWith('/admin/restore/')) user = { id: p.sub, role: 'admin', active: true };
      else if (p && !p.restore) user = await loadUser(p.sub);
      if (user && !user.active) user = null;
    }
    if (r.role === 'auth' && !user) fail(401, 'Bạn cần đăng nhập');
    if (r.role === 'staff' && !isStaff(user)) fail(user ? 403 : 401, 'Chỉ dành cho giáo viên / quản trị');
    if (r.role === 'admin' && user?.role !== 'admin') fail(user ? 403 : 401, 'Chỉ dành cho quản trị viên');
    if (r.role === 'student' && user?.role !== 'student') fail(user ? 403 : 401, 'Chỉ dành cho học sinh');
    const out = await r.handler({ req, url, params, body, user, query: Object.fromEntries(url.searchParams) });
    const res = out instanceof Response ? out : json(out ?? { ok: true });
    return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e?.code === '23505') return json({ error: 'Dữ liệu bị trùng (tên đăng nhập hoặc mã đã tồn tại)' }, 409);
    console.error(e);
    return json({ error: 'Lỗi máy chủ: ' + (e?.message || e) }, 500);
  }
}

const publicUser = (u) => u && ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, classId: u.class_id, email: u.email || null, googleLinked: !!u.google_sub, passwordSet: u.password_set !== false });
const login = (u) => ({ token: signToken({ sub: u.id, role: u.role }), user: publicUser(u) });
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const checkCreds = (username, password) => {
  if (!USERNAME_RE.test(username || '')) fail(400, 'Tên đăng nhập 3–40 ký tự, chỉ gồm chữ không dấu, số, . _ -');
  if (!password || String(password).length < 6) fail(400, 'Mật khẩu tối thiểu 6 ký tự');
};

// ================================================================ AUTH
route('GET', '/setup/status', null, async () => {
  const r = await one("SELECT count(*)::int AS n FROM users WHERE role='admin'");
  return { needsSetup: r.n === 0 };
});
route('POST', '/setup', null, async ({ body }) => {
  const r = await one("SELECT count(*)::int AS n FROM users WHERE role='admin'");
  if (r.n > 0) fail(403, 'Hệ thống đã có quản trị viên');
  checkCreds(body.username, body.password);
  const u = await one('INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,$3,$4) RETURNING *',
    [body.username.toLowerCase(), hashPassword(body.password), clean(body.fullName) || 'Quản trị viên', 'admin']);
  return login(u);
});
route('POST', '/auth/login', null, async ({ body }) => {
  const u = await one('SELECT * FROM users WHERE username=$1', [String(body.username || '').toLowerCase().trim()]);
  if (!u || !verifyPassword(body.password, u.password_hash)) fail(401, 'Sai tên đăng nhập hoặc mật khẩu');
  if (!u.active) fail(403, 'Tài khoản đã bị khoá');
  if (needsRehash(u.password_hash)) await q('UPDATE users SET last_login=now(), password_hash=$2 WHERE id=$1', [u.id, hashPassword(body.password)]);
  else await q('UPDATE users SET last_login=now() WHERE id=$1', [u.id]);
  return login(u);
});
// Học sinh không tự đăng ký được nữa: chỉ quản trị viên tạo tài khoản (xem POST /users và /users/register).
route('POST', '/auth/register', null, async () => fail(403, 'Không thể tự đăng ký. Em nhờ cô Loan tạo tài khoản nhé.'));
route('GET', '/me', 'auth', async ({ user }) => {
  const cls = user.class_id ? await one('SELECT id,name,grade FROM classes WHERE id=$1', [user.class_id]) : null;
  return { user: publicUser(user), class: cls };
});
route('POST', '/me/password', 'auth', async ({ user, body }) => {
  const u = await one('SELECT password_hash, password_set FROM users WHERE id=$1', [user.id]);
  if (u.password_set && !verifyPassword(body.oldPassword, u.password_hash)) fail(400, 'Mật khẩu cũ không đúng');
  if (!body.newPassword || body.newPassword.length < 6) fail(400, 'Mật khẩu mới tối thiểu 6 ký tự');
  await q('UPDATE users SET password_hash=$1, password_set=true WHERE id=$2', [hashPassword(body.newPassword), user.id]); forgetUser(user.id);
  return { ok: true };
});


// ================================================================ ĐĂNG NHẬP GOOGLE
route('GET', '/config', null, async () => ({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }));

async function verifyGoogle(credential) {
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) fail(400, 'Chưa cấu hình đăng nhập Google (thiếu GOOGLE_CLIENT_ID)');
  if (!credential || typeof credential !== 'string') fail(400, 'Thiếu thông tin đăng nhập Google');
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const t = await res.json().catch(() => ({}));
  if (!res.ok || t.aud !== cid || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) fail(401, 'Đăng nhập Google không hợp lệ, hãy thử lại');
  if (+t.exp * 1000 < Date.now()) fail(401, 'Phiên Google đã hết hạn, hãy bấm đăng nhập lại');
  if (t.email_verified !== 'true' && t.email_verified !== true) fail(401, 'Email Google chưa được xác minh');
  return { sub: t.sub, email: String(t.email).toLowerCase(), name: t.name || t.email.split('@')[0] };
}
/** Đăng nhập bằng Google – chỉ cho tài khoản đã có (đã liên kết Gmail, hoặc được quản trị viên gắn sẵn Gmail). */
route('POST', '/auth/google', null, async ({ body }) => {
  const g = await verifyGoogle(body.credential);
  let u = await one('SELECT * FROM users WHERE google_sub=$1', [g.sub]);
  if (!u) {
    u = await one('SELECT * FROM users WHERE lower(email)=$1 AND google_sub IS NULL', [g.email]);
    if (u) await q('UPDATE users SET google_sub=$1 WHERE id=$2', [g.sub, u.id]);
  }
  if (!u) fail(404, `Gmail ${g.email} chưa có tài khoản. Em nhờ cô Loan tạo tài khoản (và gắn Gmail này) nhé.`);
  if (!u.active) fail(403, 'Tài khoản đã bị khoá');
  await q('UPDATE users SET last_login=now() WHERE id=$1', [u.id]);
  return login(u);
});
/** Liên kết Gmail vào tài khoản đang đăng nhập */
route('POST', '/me/google', 'auth', async ({ body, user }) => {
  const g = await verifyGoogle(body.credential);
  const other = await one('SELECT id FROM users WHERE (google_sub=$1 OR lower(email)=$2) AND id<>$3', [g.sub, g.email, user.id]);
  if (other) fail(409, 'Gmail này đã được dùng cho một tài khoản khác');
  await q('UPDATE users SET google_sub=$1, email=$2 WHERE id=$3', [g.sub, g.email, user.id]); forgetUser(user.id);
  return { ok: true, email: g.email };
});
route('DELETE', '/me/google', 'auth', async ({ user }) => {
  if (user.password_set === false) fail(400, 'Hãy đặt mật khẩu trước khi bỏ liên kết Gmail (nếu không sẽ không đăng nhập được)');
  await q('UPDATE users SET google_sub=NULL WHERE id=$1', [user.id]); forgetUser(user.id);
  return { ok: true };
});

// ================================================================ FILE NGHE (tải lên theo mảnh)
const CHUNK = 3 * 1024 * 1024; // 3MB / mảnh (giới hạn mỗi lần gửi của Netlify Functions là 6MB)

// ---- dọn file nghe: file nào không còn đề nào dùng thì xoá khỏi kho
const mediaIds = (content) => [...new Set([...JSON.stringify(content || {}).matchAll(/\/api\/media\/([\w-]{10,})/g)].map((m) => m[1]))];
async function deleteMedia(rows) {
  for (const m of rows) { await deletePrefix(m.id, m.chunks); await q('DELETE FROM media WHERE id=$1', [m.id]); }
  return { deleted: rows.length, bytes: rows.reduce((a, m) => a + Number(m.size), 0) };
}
/** Xoá những file trong danh sách ids mà không còn đề nào nhắc tới */
async function pruneMedia(ids) {
  if (!ids.length) return { deleted: 0, bytes: 0 };
  const rows = await q(`SELECT m.id, m.chunks, m.size FROM media m WHERE m.id = ANY($1::text[])
    AND NOT EXISTS (SELECT 1 FROM exams e WHERE strpos(e.content::text, m.id) > 0)`, [ids]);
  return deleteMedia(rows);
}
route('POST', '/media', 'staff', async ({ body, user }) => {
  const size = Number(body.size);
  if (!size || size > 80 * 1024 * 1024) fail(400, 'File phải nhỏ hơn 80MB');
  const mime = /^audio\/[\w.+-]+$/.test(body.mime || '') ? body.mime : 'audio/mpeg';
  const id = crypto.randomBytes(18).toString('base64url');
  const chunks = Math.ceil(size / CHUNK);
  await q('INSERT INTO media(id,name,mime,size,chunk_size,chunks,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, clean(body.name, 200), mime, size, CHUNK, chunks, user.id]);
  return { id, chunkSize: CHUNK, chunks, url: `/api/media/${id}` };
});
route('PUT', '/media/:id/:n', 'staff', async ({ params, req }) => {
  const m = await one('SELECT * FROM media WHERE id=$1', [params.id]);
  if (!m) fail(404, 'Không tìm thấy file');
  const n = int(params.n);
  if (n == null || n < 0 || n >= m.chunks) fail(400, 'Mảnh không hợp lệ');
  const buf = new Uint8Array(await req.arrayBuffer());
  const expected = n === m.chunks - 1 ? Number(m.size) - n * m.chunk_size : m.chunk_size;
  if (buf.length !== expected) fail(400, `Mảnh ${n} sai kích thước`);
  await putChunk(`${m.id}/${n}`, buf);
  return { ok: true };
});
/** Phát file: trả về đúng đoạn được yêu cầu (Range), mỗi lần tối đa 1 mảnh */
route('GET', '/media/:id', null, async ({ params, req }) => {
  const m = await one('SELECT * FROM media WHERE id=$1', [params.id]);
  if (!m) fail(404, 'Không tìm thấy file nghe');
  const size = Number(m.size), cs = m.chunk_size;
  const rg = (req.headers.get('range') || '').match(/bytes=(\d*)-(\d*)/);
  let start = 0, end = size - 1;
  if (rg) {
    if (rg[1] === '' && rg[2]) { start = Math.max(0, size - +rg[2]); }
    else { start = +rg[1] || 0; if (rg[2]) end = Math.min(+rg[2], size - 1); }
  }
  if (start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const idx = Math.floor(start / cs);
  end = Math.min(end, (idx + 1) * cs - 1, size - 1);
  const chunk = await getChunk(`${m.id}/${idx}`);
  if (!chunk) fail(404, 'File nghe chưa tải lên xong');
  const body = chunk.slice(start - idx * cs, end - idx * cs + 1);
  const whole = !rg && size <= cs;
  return new Response(body, {
    status: whole ? 200 : 206,
    headers: {
      'content-type': m.mime, 'accept-ranges': 'bytes', 'content-length': String(body.length),
      ...(whole ? {} : { 'content-range': `bytes ${start}-${end}/${size}` }),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

/** Nhập file nghe từ link (Google Drive, Dropbox, OneDrive, link mp3) về máy chủ web – bước 1: kiểm tra link */
route('POST', '/media/import', 'staff', async ({ body, user }) => {
  const src = clean(body.url, 2000);
  if (!src) fail(400, 'Hãy dán link file nghe');
  const url = directUrl(src);
  let probe;
  try { probe = await fetchRange(url, 0, 0); } catch (e) { fail(400, e.message); }
  if (!probe.total || !Number.isFinite(probe.total)) fail(400, 'Không xác định được dung lượng file nghe từ link này');
  if (probe.total > 80 * 1024 * 1024) fail(400, 'File nghe phải nhỏ hơn 80MB');
  if (probe.total < 1000) fail(400, 'Link không phải file âm thanh');
  const id = crypto.randomBytes(18).toString('base64url');
  const chunks = Math.ceil(probe.total / CHUNK);
  await q('INSERT INTO media(id,name,mime,size,chunk_size,chunks,created_by,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, clean(probe.filename || 'file nghe', 200), probe.mime, probe.total, CHUNK, chunks, user.id, url]);
  return { id, chunks, url: `/api/media/${id}`, name: probe.filename, size: probe.total, ranged: probe.status === 206 };
});
/** Bước 2: máy chủ tải mảnh thứ n từ link và lưu lại (mỗi lần gọi 1 mảnh để không quá thời gian chạy) */
route('POST', '/media/:id/fetch/:n', 'staff', async ({ params }) => {
  const m = await one('SELECT * FROM media WHERE id=$1', [params.id]);
  if (!m || !m.source) fail(404, 'Không tìm thấy file');
  const n = int(params.n);
  if (n == null || n < 0 || n >= m.chunks) fail(400, 'Mảnh không hợp lệ');
  const start = n * m.chunk_size, end = Math.min(Number(m.size), start + m.chunk_size) - 1;
  let r;
  try { r = await fetchRange(m.source, start, end); } catch (e) { fail(400, e.message); }
  let buf = r.buf;
  // máy chủ nguồn không hỗ trợ Range → trả cả file: cắt đúng đoạn cần
  if (r.status === 200 && buf.length === Number(m.size)) buf = buf.slice(start, end + 1);
  if (buf.length !== end - start + 1) fail(400, `Tải mảnh ${n + 1} chưa đủ dữ liệu, hãy thử lại`);
  await putChunk(`${m.id}/${n}`, buf);
  return { ok: true };
});
/** Phát trực tiếp file Google Drive (cho đề cũ còn dùng link Drive) – máy chủ web chuyển tiếp từng đoạn */
route('GET', '/drive/:fid', null, async ({ params, req }) => {
  if (!/^[\w-]{10,}$/.test(params.fid)) fail(400, 'Link không hợp lệ');
  const src = `https://drive.usercontent.google.com/download?id=${params.fid}&export=download&confirm=t`;
  const want = (req.headers.get('range') || '').match(/bytes=(\d*)-(\d*)/);
  const start = want && want[1] !== '' ? +want[1] : 0;
  const end = start + CHUNK - 1;
  let r;
  try { r = await fetchRange(src, start, want && want[2] ? Math.min(+want[2], end) : end); } catch (e) { fail(400, e.message); }
  const total = r.total;
  const realEnd = start + r.buf.length - 1;
  return new Response(r.buf, {
    status: 206,
    headers: { 'content-type': r.mime, 'accept-ranges': 'bytes', 'content-length': String(r.buf.length),
      'content-range': `bytes ${start}-${realEnd}/${total}`, 'cache-control': 'public, max-age=86400' },
  });
});

// ================================================================ TỐC ĐỘ HỆ THỐNG
route('GET', '/health', 'staff', async () => ({
  dbMs: await pingDb(3),
  driver: driverKind(),
  platform: globalThis.__CF_ENV ? 'cloudflare' : process.env.NETLIFY || process.env.AWS_REGION ? 'netlify' : 'local',
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || null,
  dbHost: ((process.env.DATABASE_URL || '').match(/@([^/:?]+)/) || [])[1]?.replace(/^[^.]+\./, '…') || null,
}));


// ================================================================ SAO LƯU / KHÔI PHỤC (chia nhỏ theo bảng, mỗi lượt < 3MB)
const BACKUP_TABLES = ['classes', 'users', 'exams', 'assignments', 'attempts', 'attempt_items', 'media'];
const SERIAL_TABLES = ['classes', 'users', 'exams', 'assignments', 'attempts'];
const checkTable = (t) => { if (!BACKUP_TABLES.includes(t)) fail(400, 'Bảng không hợp lệ'); return t; };
route('GET', '/admin/backup/:table', 'admin', async ({ params, query }) => {
  const t = checkTable(params.table);
  const offset = int(query.offset) || 0;
  const order = t === 'attempt_items' ? 'x.attempt_id, x.qid' : 'x.id';
  const rows = await q(`SELECT row_to_json(x) AS r FROM ${t} x ORDER BY ${order} LIMIT 300 OFFSET $1`, [offset]);
  const out = [];
  let size = 0;
  for (const { r } of rows) {
    const n = JSON.stringify(r).length;
    if (out.length && size + n > 2_500_000) break;
    out.push(r); size += n;
  }
  const more = rows.length === 300 || out.length < rows.length;
  return { table: t, rows: out, next: more ? offset + out.length : null };
});
route('POST', '/admin/restore/begin', 'admin', async ({ body, user }) => {
  if (body.confirm !== 'XOA_HET') fail(400, 'Thiếu xác nhận');
  await q(`TRUNCATE ${BACKUP_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  userCache.clear();
  return { ok: true, restoreToken: signToken({ sub: user.id, role: 'admin', restore: true }, 1 / 24) };
});
route('POST', '/admin/restore/rows/:table', 'admin', async ({ params, body }) => {
  const t = checkTable(params.table);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return { inserted: 0 };
  const r = await q(`INSERT INTO ${t} SELECT * FROM json_populate_recordset(NULL::${t}, $1::json) ON CONFLICT DO NOTHING RETURNING 1`, [JSON.stringify(rows)]);
  return { inserted: r.length };
});
route('POST', '/admin/restore/finish', 'admin', async () => {
  await Promise.all(SERIAL_TABLES.map((t) => q(`SELECT setval(pg_get_serial_sequence('${t}','id'), COALESCE((SELECT max(id) FROM ${t}), 1), (SELECT max(id) FROM ${t}) IS NOT NULL)`)));
  userCache.clear();
  return { ok: true };
});

// ---- dung lượng kho file nghe
const ORPHAN_SQL = `SELECT m.id, m.chunks, m.size FROM media m WHERE m.created_at < now() - interval '1 day'
  AND NOT EXISTS (SELECT 1 FROM exams e WHERE strpos(e.content::text, m.id) > 0)`;
route('GET', '/admin/storage', 'admin', async () => {
  const [tot, orph] = await Promise.all([one('SELECT count(*)::int AS n, COALESCE(sum(size),0)::float AS bytes FROM media'),
    one(`SELECT count(*)::int AS n, COALESCE(sum(size),0)::float AS bytes FROM (${ORPHAN_SQL}) o`)]);
  return { ...storageInfo(), files: tot.n, used: tot.bytes, orphans: orph };
});
/** Xoá file nghe không đề nào dùng (tải lên rồi bỏ, đã đổi file khác…) – chỉ file cũ hơn 1 ngày */
route('POST', '/admin/storage/cleanup', 'admin', async () => deleteMedia(await q(ORPHAN_SQL + ' LIMIT 200')));

// ---- tải file nghe từ link về trình duyệt (để nén trước khi lưu) – mỗi lần 1 đoạn ≤ 3MB
route('GET', '/remote-audio', 'staff', async ({ req, query }) => {
  const src = directUrl(clean(query.u, 2000));
  const want = (req.headers.get('range') || '').match(/bytes=(\d*)-(\d*)/);
  const start = want && want[1] !== '' ? +want[1] : 0;
  let r;
  try { r = await fetchRange(src, start, start + CHUNK - 1); } catch (e) { fail(400, e.message); }
  if (!r.total || r.total > 80 * 1024 * 1024) fail(400, r.total ? 'File nghe phải nhỏ hơn 80MB' : 'Không xác định được dung lượng file nghe từ link này');
  return new Response(r.buf, { status: 206, headers: { 'content-type': r.mime, 'content-range': `bytes ${start}-${start + r.buf.length - 1}/${r.total}`,
    'x-file-name': encodeURIComponent(r.filename || ''), 'cache-control': 'no-store' } });
});

// ---- chép file nghe từ web cũ (sau khi chuyển web + khôi phục dữ liệu)
route('GET', '/admin/media', 'admin', async () => q('SELECT id, name, size, chunk_size, chunks FROM media ORDER BY created_at'));
route('POST', '/admin/media/:id/pull/:n', 'admin', async ({ params, body }) => {
  const m = await one('SELECT * FROM media WHERE id=$1', [params.id]);
  if (!m) fail(404, 'Không tìm thấy file nghe');
  const n = int(params.n);
  if (n == null || n < 0 || n >= m.chunks) fail(400, 'Số thứ tự không hợp lệ');
  if (await getChunk(`${m.id}/${n}`)) return { skipped: true };
  let from;
  try { from = new URL(String(body.from || '')); } catch { fail(400, 'Địa chỉ web cũ không hợp lệ'); }
  const start = n * m.chunk_size, end = Math.min(Number(m.size), start + m.chunk_size) - 1;
  let r;
  try { r = await fetchRange(`${from.origin}/api/media/${m.id}`, start, end); } catch (e) { fail(400, e.message); }
  if (r.buf.length !== end - start + 1) fail(400, `Web cũ trả về thiếu dữ liệu (${r.buf.length}/${end - start + 1} byte)`);
  await putChunk(`${m.id}/${n}`, r.buf);
  return { ok: true };
});

// ================================================================ LỚP HỌC
route('GET', '/classes', 'staff', async () => q(`
  SELECT c.*, (SELECT count(*)::int FROM users u WHERE u.class_id=c.id AND u.role='student') AS student_count,
         (SELECT count(*)::int FROM assignments a WHERE a.class_id=c.id) AS assignment_count
  FROM classes c ORDER BY c.grade NULLS LAST, c.name`));
route('POST', '/classes', 'staff', async ({ body }) => {
  if (!clean(body.name)) fail(400, 'Nhập tên lớp');
  return one('INSERT INTO classes(name,grade,school_year,join_code) VALUES($1,$2,$3,$4) RETURNING *',
    [clean(body.name, 60), int(body.grade), clean(body.schoolYear, 20) || null, randomCode()]);
});
route('PUT', '/classes/:id', 'staff', async ({ params, body }) =>
  one('UPDATE classes SET name=$1, grade=$2, school_year=$3 WHERE id=$4 RETURNING *', [clean(body.name, 60), int(body.grade), clean(body.schoolYear, 20) || null, params.id]));
route('POST', '/classes/:id/code', 'staff', async ({ params }) =>
  one('UPDATE classes SET join_code=$1 WHERE id=$2 RETURNING *', [randomCode(), params.id]));
route('DELETE', '/classes/:id', 'admin', async ({ params }) => { await q('DELETE FROM classes WHERE id=$1', [params.id]); });

// ================================================================ HỌC SINH / TÀI KHOẢN
route('GET', '/users', 'staff', async ({ query }) => {
  const where = [];
  const args = [];
  if (query.classId) { args.push(query.classId); where.push(`u.class_id=$${args.length}`); }
  if (query.role) { args.push(query.role); where.push(`u.role=$${args.length}`); }
  if (query.q) { args.push('%' + query.q.toLowerCase() + '%'); where.push(`(lower(u.full_name) LIKE $${args.length} OR u.username LIKE $${args.length})`); }
  return q(`SELECT u.id,u.username,u.full_name,u.role,u.class_id,u.active,u.created_at,u.last_login,u.email,(u.google_sub IS NOT NULL) AS google_linked,c.name AS class_name
            FROM users u LEFT JOIN classes c ON c.id=u.class_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY c.name NULLS FIRST, u.full_name LIMIT 2000`, args);
});
/** body: { users:[{fullName, username, password, classId, role}] } – tạo 1 hoặc nhiều tài khoản */
route('POST', '/users', 'admin', async ({ body }) => {
  const list = Array.isArray(body.users) ? body.users : [body];
  if (!list.length || list.length > 500) fail(400, 'Danh sách không hợp lệ (tối đa 500)');
  const created = [], errors = [];
  for (const [i, it] of list.entries()) {
    try {
      const role = it.role === 'teacher' || it.role === 'admin' ? it.role : 'student';
      checkCreds(it.username, it.password);
      if (!clean(it.fullName)) fail(400, 'Thiếu họ tên');
      const email = clean(it.email, 120).toLowerCase() || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) fail(400, 'Email không hợp lệ');
      const u = await one('INSERT INTO users(username,password_hash,full_name,role,class_id,email) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,full_name,role,class_id,email',
        [it.username.toLowerCase(), hashPassword(it.password), clean(it.fullName), role, int(it.classId), email]);
      created.push(u);
    } catch (e) {
      errors.push({ row: i + 1, username: it.username, error: e.code === '23505' ? 'Tên đăng nhập đã tồn tại' : e.message });
    }
  }
  return { created, errors };
});
/** Quản trị viên đăng ký học sinh bằng mã lớp: { joinCode, fullName, username, password, email? } */
route('POST', '/users/register', 'admin', async ({ body }) => {
  const cls = await one('SELECT * FROM classes WHERE upper(join_code)=upper($1)', [clean(body.joinCode, 20)]);
  if (!cls) fail(400, 'Mã lớp không đúng');
  checkCreds(body.username, body.password);
  if (!clean(body.fullName)) fail(400, 'Vui lòng nhập họ tên');
  const email = clean(body.email, 120).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) fail(400, 'Email không hợp lệ');
  const u = await one('INSERT INTO users(username,password_hash,full_name,role,class_id,email) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,full_name,role,class_id,email',
    [body.username.toLowerCase().trim(), hashPassword(body.password), clean(body.fullName), 'student', cls.id, email]);
  return { user: u, class: { id: cls.id, name: cls.name, grade: cls.grade } };
});
route('PUT', '/users/:id', 'staff', async ({ params, body, user }) => {
  const target = await one('SELECT * FROM users WHERE id=$1', [params.id]);
  if (!target) fail(404, 'Không tìm thấy tài khoản');
  if (target.role !== 'student' && user.role !== 'admin') fail(403, 'Không có quyền');
  const sets = [], args = [];
  const set = (col, v) => { args.push(v); sets.push(`${col}=$${args.length}`); };
  if (body.fullName !== undefined) set('full_name', clean(body.fullName));
  if (body.classId !== undefined) set('class_id', int(body.classId));
  if (body.active !== undefined) set('active', !!body.active);
  if (body.email !== undefined) {
    const email = clean(body.email, 120).toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) fail(400, 'Email không hợp lệ');
    if (email !== (target.email || null)) { set('email', email); args.push(null); sets.push(`google_sub=$${args.length}`); }
  }
  if (body.password) { if (body.password.length < 6) fail(400, 'Mật khẩu tối thiểu 6 ký tự'); set('password_hash', hashPassword(body.password)); }
  if (body.role && user.role === 'admin' && ['admin', 'teacher', 'student'].includes(body.role)) set('role', body.role);
  if (!sets.length) return { ok: true };
  forgetUser(params.id);
  args.push(params.id);
  return one(`UPDATE users SET ${sets.join(',')} WHERE id=$${args.length} RETURNING id,username,full_name,role,class_id,active,email`, args);
});
route('DELETE', '/users/:id', 'staff', async ({ params, user }) => {
  if (+params.id === user.id) fail(400, 'Không thể tự xoá chính mình');
  const t = await one('SELECT role FROM users WHERE id=$1', [params.id]);
  if (t && t.role !== 'student' && user.role !== 'admin') fail(403, 'Không có quyền');
  await q('DELETE FROM users WHERE id=$1', [params.id]);
  forgetUser(params.id);
});

// ================================================================ ĐỀ BÀI
function examStats(content) {
  let count = 0, points = 0;
  for (const p of content.parts || []) for (const x of p.questions || []) { count++; points += Number(x.points) || 0; }
  return { count, points: Math.round(points * 100) / 100 };
}
function validateContent(c) {
  if (!c || !Array.isArray(c.parts) || !c.parts.length) fail(400, 'Đề chưa có phần nào');
  const ids = new Set();
  c.parts.forEach((p, i) => {
    p.id = p.id || `p${i + 1}`;
    (p.questions || []).forEach((x, j) => {
      x.id = x.id || `${p.id}q${j + 1}`;
      while (ids.has(x.id)) x.id += 'x';
      ids.add(x.id);
    });
  });
  if (JSON.stringify(c).length > 4_500_000) fail(400, 'Đề quá lớn (nhiều ảnh nặng). Hãy giảm bớt ảnh.');
  return c;
}
route('GET', '/exams', 'staff', async () => q(`
  SELECT e.id,e.title,e.grade,e.time_limit,e.source_name,e.question_count,e.total_points,e.tags,e.created_at,e.updated_at,
    (SELECT count(*)::int FROM assignments a WHERE a.exam_id=e.id) AS assignment_count,
    (SELECT jsonb_agg(DISTINCT p->>'topic') FROM jsonb_array_elements(e.content->'parts') p) AS topics
  FROM exams e ORDER BY e.updated_at DESC`));
route('GET', '/exams/:id', 'staff', async ({ params }) => {
  const e = await one('SELECT * FROM exams WHERE id=$1', [params.id]);
  if (!e) fail(404, 'Không tìm thấy đề');
  return e;
});
route('POST', '/exams', 'staff', async ({ body, user }) => {
  const content = validateContent(body.content);
  const s = examStats(content);
  return one(`INSERT INTO exams(title,grade,time_limit,source_name,content,question_count,total_points,tags,created_by)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title`,
  [clean(body.title, 300) || 'Đề mới', int(body.grade), int(body.timeLimit), clean(body.sourceName, 300) || null, content, s.count, s.points, clean(body.tags, 200) || null, user.id]);
});
route('PUT', '/exams/:id', 'staff', async ({ params, body }) => {
  const content = validateContent(body.content);
  const old = await one('SELECT content FROM exams WHERE id=$1', [params.id]);
  const s = examStats(content);
  const e = await one(`UPDATE exams SET title=$1,grade=$2,time_limit=$3,content=$4,question_count=$5,total_points=$6,tags=$7,updated_at=now()
                       WHERE id=$8 RETURNING id,title`,
  [clean(body.title, 300) || 'Đề mới', int(body.grade), int(body.timeLimit), content, s.count, s.points, clean(body.tags, 200) || null, params.id]);
  if (!e) fail(404, 'Không tìm thấy đề');
  // file nghe bị thay / bỏ khỏi đề → xoá nếu không đề nào khác dùng
  const keep = new Set(mediaIds(content));
  await pruneMedia(mediaIds(old?.content).filter((id) => !keep.has(id)));
  return e;
});
route('POST', '/exams/:id/duplicate', 'staff', async ({ params, user }) =>
  one(`INSERT INTO exams(title,grade,time_limit,source_name,content,question_count,total_points,tags,created_by)
       SELECT title||' (bản sao)',grade,time_limit,source_name,content,question_count,total_points,tags,$2 FROM exams WHERE id=$1 RETURNING id,title`, [params.id, user.id]));
route('DELETE', '/exams/:id', 'staff', async ({ params }) => {
  const e = await one('DELETE FROM exams WHERE id=$1 RETURNING content', [params.id]);
  return { ok: true, media: await pruneMedia(mediaIds(e?.content)) };
});

// ================================================================ GIAO BÀI (PUBLIC CHO LỚP)
route('GET', '/assignments', 'staff', async ({ query }) => {
  const args = [];
  let where = '';
  if (query.classId) { args.push(query.classId); where = `WHERE a.class_id=$1`; }
  if (query.examId) { args.push(query.examId); where += (where ? ' AND' : 'WHERE') + ` a.exam_id=$${args.length}`; }
  return q(`SELECT a.*, COALESCE(a.title,e.title) AS display_title, e.title AS exam_title, e.question_count, c.name AS class_name, c.grade,
      (SELECT count(*)::int FROM users u WHERE u.class_id=a.class_id AND u.role='student' AND u.active) AS student_count,
      (SELECT count(DISTINCT t.user_id)::int FROM attempts t WHERE t.assignment_id=a.id AND t.status='submitted') AS done_count,
      (SELECT round(avg(t.percent),1) FROM attempts t WHERE t.assignment_id=a.id AND t.status='submitted') AS avg_percent,
      (SELECT count(*)::int FROM attempts t WHERE t.assignment_id=a.id AND t.needs_grading) AS pending_count
    FROM assignments a JOIN exams e ON e.id=a.exam_id JOIN classes c ON c.id=a.class_id ${where}
    ORDER BY a.created_at DESC`, args);
});
route('POST', '/assignments', 'staff', async ({ body }) => {
  const classIds = (Array.isArray(body.classIds) ? body.classIds : [body.classId]).map(int).filter(Boolean);
  if (!classIds.length) fail(400, 'Chọn ít nhất một lớp');
  const exam = await one('SELECT id FROM exams WHERE id=$1', [body.examId]);
  if (!exam) fail(404, 'Không tìm thấy đề');
  const show = ['after_submit', 'after_due', 'never'].includes(body.showAnswers) ? body.showAnswers : 'after_submit';
  const out = [];
  for (const cid of classIds) {
    // chống tạo trùng (bấm nút nhiều lần khi mạng chậm)
    const dup = await one(`SELECT * FROM assignments WHERE exam_id=$1 AND class_id=$2 AND created_at > now() - interval '2 minutes' ORDER BY id DESC LIMIT 1`, [exam.id, cid]);
    if (dup) { out.push(dup); continue; }
    out.push(await one(`INSERT INTO assignments(exam_id,class_id,title,opens_at,due_at,time_limit,max_attempts,show_answers)
                        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [exam.id, cid, clean(body.title, 300) || null, body.opensAt || null, body.dueAt || null, int(body.timeLimit), int(body.maxAttempts) || 0, show]));
  }
  return out;
});
route('PUT', '/assignments/:id', 'staff', async ({ params, body }) => {
  const show = ['after_submit', 'after_due', 'never'].includes(body.showAnswers) ? body.showAnswers : 'after_submit';
  return one(`UPDATE assignments SET title=$1,opens_at=$2,due_at=$3,time_limit=$4,max_attempts=$5,show_answers=$6,status=$7 WHERE id=$8 RETURNING *`,
    [clean(body.title, 300) || null, body.opensAt || null, body.dueAt || null, int(body.timeLimit), int(body.maxAttempts) || 0, show,
      body.status === 'closed' ? 'closed' : 'published', params.id]);
});
route('DELETE', '/assignments/:id', 'staff', async ({ params }) => { await q('DELETE FROM assignments WHERE id=$1', [params.id]); });

route('GET', '/assignments/:id/results', 'staff', async ({ params }) => {
  const a = await one(`SELECT a.*, COALESCE(a.title,e.title) AS display_title, e.content, c.name AS class_name
                       FROM assignments a JOIN exams e ON e.id=a.exam_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1`, [params.id]);
  if (!a) fail(404, 'Không tìm thấy bài đã giao');
  const [students, items] = await Promise.all([q(`
    SELECT u.id, u.full_name, u.username,
      count(t.id) FILTER (WHERE t.status='submitted')::int AS attempts,
      max(t.percent) FILTER (WHERE t.status='submitted') AS best_percent,
      (array_agg(t.percent ORDER BY t.submitted_at DESC) FILTER (WHERE t.status='submitted'))[1] AS last_percent,
      (array_agg(t.id ORDER BY t.submitted_at DESC) FILTER (WHERE t.status='submitted'))[1] AS last_attempt_id,
      max(t.submitted_at) AS last_submitted,
      bool_or(t.needs_grading) AS needs_grading
    FROM users u LEFT JOIN attempts t ON t.user_id=u.id AND t.assignment_id=$1
    WHERE u.class_id=$2 AND u.role='student'
    GROUP BY u.id ORDER BY u.full_name`, [a.id, a.class_id]),
  q(`SELECT i.qid, count(*)::int AS n, sum(CASE WHEN i.correct THEN 1 ELSE 0 END)::int AS right_n
                         FROM attempt_items i JOIN attempts t ON t.id=i.attempt_id WHERE t.assignment_id=$1 AND NOT i.pending GROUP BY i.qid`, [a.id])]);
  const qmap = {};
  for (const p of a.content.parts) for (const x of p.questions) qmap[x.id] = { num: x.num ?? x.label, topic: p.topic, type: x.type, part: p.title, section: p.section };
  const itemStats = items.map((r) => ({ ...r, ...qmap[r.qid], rate: r.n ? Math.round((r.right_n / r.n) * 100) : 0 }))
    .sort((x, y) => x.rate - y.rate);
  delete a.content;
  return { assignment: a, students, items: itemStats };
});

// ================================================================ HỌC SINH: BÀI ĐƯỢC GIAO
function canSeeAnswers(a, user) {
  if (isStaff(user)) return true;
  if (!a) return true; // luyện tập
  if (a.show_answers === 'after_submit') return true;
  if (a.show_answers === 'after_due') return a.due_at && new Date(a.due_at) < new Date();
  return false;
}
route('GET', '/my/assignments', 'student', async ({ user }) => {
  if (!user.class_id) return [];
  return q(`SELECT a.id, COALESCE(a.title,e.title) AS title, a.opens_at, a.due_at, COALESCE(a.time_limit,e.time_limit) AS time_limit,
      a.max_attempts, a.status, a.created_at, e.question_count, e.total_points,
      (SELECT jsonb_agg(DISTINCT p->>'topic') FROM jsonb_array_elements(e.content->'parts') p) AS topics,
      count(t.id) FILTER (WHERE t.status='submitted')::int AS attempts,
      max(t.percent) FILTER (WHERE t.status='submitted') AS best_percent,
      bool_or(t.status='in_progress') AS in_progress,
      (array_agg(t.id ORDER BY t.submitted_at DESC NULLS LAST) FILTER (WHERE t.status='submitted'))[1] AS last_attempt_id
    FROM assignments a JOIN exams e ON e.id=a.exam_id
    LEFT JOIN attempts t ON t.assignment_id=a.id AND t.user_id=$1
    WHERE a.class_id=$2 AND (a.opens_at IS NULL OR a.opens_at <= now())
    GROUP BY a.id, e.id ORDER BY a.created_at DESC`, [user.id, user.class_id]);
});

/** Bắt đầu / tiếp tục làm bài */
route('POST', '/my/assignments/:id/start', 'student', async ({ params, user }) => {
  // lấy bài, lượt đang làm dở và số lượt đã nộp trong MỘT truy vấn
  const a = await one(`SELECT a.*, e.content, e.title AS exam_title, e.time_limit AS exam_time,
      (SELECT row_to_json(t) FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=$3 AND t.status='in_progress' ORDER BY t.id DESC LIMIT 1) AS cur,
      (SELECT count(*)::int FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=$3 AND t.status='submitted') AS done_n
    FROM assignments a JOIN exams e ON e.id=a.exam_id WHERE a.id=$1 AND a.class_id=$2`, [params.id, user.class_id, user.id]);
  if (!a) fail(404, 'Không tìm thấy bài tập');
  if (a.opens_at && new Date(a.opens_at) > new Date()) fail(403, 'Bài chưa mở');
  let t = a.cur;
  if (!t) {
    if (a.status === 'closed') fail(403, 'Bài đã đóng');
    if (a.due_at && new Date(a.due_at) < new Date()) fail(403, 'Đã quá hạn nộp bài');
    if (a.max_attempts > 0 && a.done_n >= a.max_attempts) fail(403, `Em đã làm hết ${a.max_attempts} lượt cho bài này`);
    t = await one(`INSERT INTO attempts(user_id,class_id,assignment_id,exam_id,kind,title) VALUES($1,$2,$3,$4,'assignment',$5) RETURNING *`,
      [user.id, user.class_id, a.id, a.exam_id, a.title || a.exam_title]);
  }
  const timeLimit = a.time_limit ?? a.exam_time ?? null;
  return {
    attemptId: t.id, title: t.title, startedAt: t.started_at, timeLimit, dueAt: a.due_at,
    serverNow: new Date().toISOString(), answers: t.answers || {}, content: stripAnswers(a.content),
  };
});

route('PUT', '/attempts/:id/save', 'student', async ({ params, user, body }) => {
  const t = await one(`UPDATE attempts SET answers=$1 WHERE id=$2 AND user_id=$3 AND status='in_progress' RETURNING id`, [body.answers || {}, params.id, user.id]);
  if (!t) fail(404, 'Không tìm thấy lượt làm bài');
  return { ok: true };
});

route('POST', '/attempts/:id/submit', 'student', async ({ params, user, body }) => {
  const t = await one(`SELECT t.*, e.content AS exam_content, a.show_answers, a.due_at
                       FROM attempts t LEFT JOIN exams e ON e.id=t.exam_id LEFT JOIN assignments a ON a.id=t.assignment_id
                       WHERE t.id=$1 AND t.user_id=$2`, [params.id, user.id]);
  if (!t) fail(404, 'Không tìm thấy lượt làm bài');
  if (t.status === 'submitted') fail(409, 'Bài này đã nộp rồi');
  const content = t.kind === 'practice' ? t.content : t.exam_content;
  if (!content) fail(400, 'Đề không còn tồn tại');
  const answers = body.answers || t.answers || {};
  const g = gradeAttempt(content, answers);
  const duration = Math.max(0, Math.round((Date.now() - new Date(t.started_at).getTime()) / 1000));
  // ghi kết quả + từng câu trong MỘT lượt (trước đây mỗi câu một lượt → rất chậm)
  const items = g.results.map((r) => ({ qid: r.id, topic: r.topic, qtype: r.type, correct: r.correct, earned: r.earned, max: r.max, pending: r.pending }));
  await batch([
    [`UPDATE attempts SET status='submitted', answers=$1, results=$2, score=$3, max_score=$4, percent=$5, needs_grading=$6,
      submitted_at=now(), duration_sec=$7 WHERE id=$8`,
    [answers, JSON.stringify(g.results), g.score, g.max, g.percent, g.pending, duration, t.id]],
    [`INSERT INTO attempt_items(attempt_id,qid,user_id,class_id,topic,qtype,correct,earned,max,pending)
      SELECT $1, x.qid, $2, $3, x.topic, x.qtype, x.correct, x.earned, x.max, x.pending
      FROM jsonb_to_recordset($4::jsonb) AS x(qid text, topic text, qtype text, correct boolean, earned numeric, max numeric, pending boolean)
      ON CONFLICT DO NOTHING`, [t.id, user.id, user.class_id, JSON.stringify(items)]],
  ]);
  return attemptView(t.id, user);
});

async function attemptView(id, user) {
  const t = await one(`SELECT t.*, e.content AS exam_content, a.show_answers, a.due_at, u.full_name, u.username, c.name AS class_name
                       FROM attempts t LEFT JOIN exams e ON e.id=t.exam_id LEFT JOIN assignments a ON a.id=t.assignment_id
                       JOIN users u ON u.id=t.user_id LEFT JOIN classes c ON c.id=t.class_id WHERE t.id=$1`, [id]);
  if (!t) fail(404, 'Không tìm thấy bài làm');
  if (!isStaff(user) && t.user_id !== user.id) fail(403, 'Không có quyền xem bài này');
  if (t.status !== 'submitted') fail(400, 'Bài chưa nộp');
  const show = canSeeAnswers(t.assignment_id ? t : null, user);
  let content = t.kind === 'practice' ? t.content : t.exam_content;
  let results = t.results || [];
  if (!show) {
    content = content ? stripAnswers(content) : null;
    results = results.map(({ answer, accepted, explanation, ...r }) => r);
  }
  return {
    id: t.id, kind: t.kind, title: t.title, student: { id: t.user_id, fullName: t.full_name, username: t.username, className: t.class_name },
    score: num(t.score), maxScore: num(t.max_score), percent: num(t.percent), needsGrading: t.needs_grading,
    startedAt: t.started_at, submittedAt: t.submitted_at, durationSec: t.duration_sec,
    showAnswers: show, answers: t.answers, results, content,
  };
}
route('GET', '/attempts/:id', 'auth', async ({ params, user }) => attemptView(params.id, user));

route('GET', '/my/attempts', 'student', async ({ user }) => q(`
  SELECT id, kind, title, score, max_score, percent, needs_grading, submitted_at, duration_sec, assignment_id
  FROM attempts WHERE user_id=$1 AND status='submitted' ORDER BY submitted_at DESC LIMIT 300`, [user.id]));

route('GET', '/my/stats', 'student', async ({ user }) => studentStats(user.id));

// ================================================================ LUYỆN TẬP THEO CHUYÊN ĐỀ
const NO_PRACTICE = new Set(['writing']); // cần giáo viên chấm
// Phần nghe chỉ luyện được khi đề có file nghe (của phần hoặc của cả đề)
const audioOf = (e, p) => p.audioUrl || (p.topic === 'listening' ? e.content.audioUrl || '' : '');
const skipPart = (e, p) => NO_PRACTICE.has(p.topic) || (p.topic === 'listening' && !audioOf(e, p));
// Chỉ lấy câu từ những bài em đã nộp hoặc đã hết hạn (tránh lộ đáp án bài đang làm).
async function practicePool(user) {
  return q(`SELECT e.id AS exam_id, e.content FROM exams e WHERE e.id IN (
              SELECT a.exam_id FROM assignments a WHERE a.class_id=$1 AND (
                (a.due_at IS NOT NULL AND a.due_at < now()) OR a.status='closed' OR
                EXISTS (SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=$2 AND t.status='submitted')))`,
  [user.class_id, user.id]);
}
route('GET', '/practice/topics', 'student', async ({ user }) => {
  if (!user.class_id) return [];
  const pool = await practicePool(user);
  const count = {};
  for (const e of pool) for (const p of e.content.parts) {
    if (skipPart(e, p)) continue;
    const n = p.questions.filter((x) => x.type !== 'essay' && x.answer).length;
    if (n) count[p.topic] = (count[p.topic] || 0) + n;
  }
  const acc = await q(`SELECT topic, sum(earned)::float AS earned, sum(max)::float AS max FROM attempt_items WHERE user_id=$1 AND NOT pending GROUP BY topic`, [user.id]);
  const accMap = Object.fromEntries(acc.map((r) => [r.topic, r.max ? Math.round((r.earned / r.max) * 100) : null]));
  return Object.entries(count).map(([topic, n]) => ({ topic, count: n, accuracy: accMap[topic] ?? null }));
});
route('POST', '/practice/start', 'student', async ({ user, body }) => {
  const pool = await practicePool(user);
  const want = Math.min(Math.max(int(body.count) || 10, 3), 40);
  const groups = []; // giữ nguyên nhóm câu có chung bài đọc
  for (const e of pool) for (const p of e.content.parts) {
    if (p.topic !== body.topic || skipPart(e, p)) continue;
    const qs = p.questions.filter((x) => x.type !== 'essay' && x.answer);
    if (!qs.length) continue;
    if (p.topic === 'listening' || (p.passageHtml && /class="gap"|<table/.test(p.passageHtml)) || (p.passageHtml && p.passageHtml.length > 200)) groups.push({ p: { ...p, audioUrl: audioOf(e, p) }, qs, e: e.exam_id, whole: true });
    else for (const x of qs) groups.push({ p, qs: [x], e: e.exam_id });
  }
  if (!groups.length) fail(404, 'Chưa có câu hỏi cho chuyên đề này');
  for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
  const parts = [];
  let total = 0;
  for (const g of groups) {
    if (total >= want) break;
    const key = `${g.e}-${g.p.id}`;
    let part = g.whole ? null : parts.find((x) => x._key === key);
    if (!part) { part = { ...g.p, _key: key, id: `p${parts.length + 1}`, questions: [] }; parts.push(part); }
    for (const x of g.qs) { part.questions.push({ ...x, id: `${part.id}q${part.questions.length + 1}` }); total++; }
  }
  parts.forEach((p) => { delete p._key; });
  const content = { parts };
  const t = await one(`INSERT INTO attempts(user_id,class_id,kind,title,content) VALUES($1,$2,'practice',$3,$4) RETURNING id, started_at`,
    [user.id, user.class_id, 'Luyện tập: ' + (body.topicLabel || body.topic), content]);
  return { attemptId: t.id, title: 'Luyện tập', startedAt: t.started_at, timeLimit: null, serverNow: new Date().toISOString(), answers: {}, content: stripAnswers(content) };
});

// ================================================================ CHẤM TAY (TỰ LUẬN / SỬA ĐIỂM)
route('GET', '/grading/pending', 'staff', async () => q(`
  SELECT t.id, t.title, t.submitted_at, t.score, t.max_score, u.full_name, c.name AS class_name
  FROM attempts t JOIN users u ON u.id=t.user_id LEFT JOIN classes c ON c.id=t.class_id
  WHERE t.needs_grading ORDER BY t.submitted_at`));
route('POST', '/attempts/:id/grade', 'staff', async ({ params, body, user }) => {
  const t = await one('SELECT * FROM attempts WHERE id=$1', [params.id]);
  if (!t || t.status !== 'submitted') fail(404, 'Không tìm thấy bài đã nộp');
  const results = t.results || [];
  const items = body.items || {};
  for (const r of results) {
    const it = items[r.id];
    if (!it) continue;
    const earned = Math.max(0, Math.min(Number(it.earned) || 0, Number(r.max) || 0));
    r.earned = earned; r.pending = false; r.correct = earned >= Number(r.max); r.comment = clean(it.comment, 2000); r.manual = true;
  }
  const tt = totals(results);
  const changed = results.filter((r) => items[r.id]).map((r) => ({ qid: r.id, earned: r.earned, correct: r.correct }));
  await batch([
    ['UPDATE attempts SET results=$1, score=$2, max_score=$3, percent=$4, needs_grading=$5 WHERE id=$6',
      [JSON.stringify(results), tt.score, tt.max, tt.percent, tt.pending, t.id]],
    [`UPDATE attempt_items i SET earned=x.earned, correct=x.correct, pending=false
      FROM jsonb_to_recordset($2::jsonb) AS x(qid text, earned numeric, correct boolean)
      WHERE i.attempt_id=$1 AND i.qid=x.qid`, [t.id, JSON.stringify(changed)]],
  ]);
  return attemptView(t.id, user);
});
route('DELETE', '/attempts/:id', 'staff', async ({ params }) => { await q('DELETE FROM attempts WHERE id=$1', [params.id]); });

// Chấm lại các câu điền/viết đã nộp theo quy tắc so khớp hiện tại (không đụng câu giáo viên đã chấm tay)
route('POST', '/attempts/regrade-text', 'staff', async () => {
  const rows = await q(`SELECT t.id, t.kind, t.results, t.content, e.content AS exam_content FROM attempts t LEFT JOIN exams e ON e.id=t.exam_id
                        WHERE t.status='submitted' AND t.results IS NOT NULL`);
  let attempts = 0, fixed = 0;
  for (const t of rows) {
    const content = t.kind === 'practice' ? t.content : t.exam_content;
    if (!content) continue;
    const qs = new Map((content.parts || []).flatMap((p) => (p.questions || []).map((x) => [x.id, x])));
    const results = t.results || [];
    const changed = [];
    for (const r of results) {
      if (r.manual || r.pending || !['gap', 'rewrite'].includes(r.type)) continue;
      const qq = qs.get(r.id);
      if (!qq) continue;
      const g = gradeQuestion(qq, r.given || '');
      if (!!g.correct !== !!r.correct) { r.correct = !!g.correct; r.earned = g.correct ? r.max : 0; changed.push({ qid: r.id, earned: r.earned, correct: r.correct }); }
    }
    if (!changed.length) continue;
    const tt = totals(results);
    await batch([
      ['UPDATE attempts SET results=$1, score=$2, max_score=$3, percent=$4 WHERE id=$5', [JSON.stringify(results), tt.score, tt.max, tt.percent, t.id]],
      [`UPDATE attempt_items i SET earned=x.earned, correct=x.correct FROM jsonb_to_recordset($2::jsonb) AS x(qid text, earned numeric, correct boolean)
        WHERE i.attempt_id=$1 AND i.qid=x.qid`, [t.id, JSON.stringify(changed)]],
    ]);
    attempts++; fixed += changed.length;
  }
  return { attempts, fixed };
});

// ================================================================ DASHBOARD
route('GET', '/dashboard/overview', 'staff', async () => {
  // các truy vấn độc lập → chạy song song
  const [classes, topics, trend, totals_] = await Promise.all([q(`
    SELECT c.id, c.name, c.grade, c.join_code,
      (SELECT count(*)::int FROM users u WHERE u.class_id=c.id AND u.role='student' AND u.active) AS students,
      (SELECT count(*)::int FROM assignments a WHERE a.class_id=c.id) AS assignments,
      (SELECT count(*)::int FROM attempts t WHERE t.class_id=c.id AND t.status='submitted') AS submissions,
      (SELECT round(avg(t.percent),1) FROM attempts t WHERE t.class_id=c.id AND t.status='submitted' AND t.kind='assignment') AS avg_percent,
      (SELECT count(DISTINCT (t.user_id, t.assignment_id))::int FROM attempts t JOIN assignments a ON a.id=t.assignment_id
        WHERE a.class_id=c.id AND t.status='submitted') AS done_pairs,
      (SELECT count(*)::int FROM attempts t WHERE t.class_id=c.id AND t.submitted_at > now() - interval '7 days') AS week_submissions
    FROM classes c ORDER BY c.grade NULLS LAST, c.name`),
  q(`SELECT c.grade, i.topic, sum(i.earned)::float AS earned, sum(i.max)::float AS max
                          FROM attempt_items i JOIN classes c ON c.id=i.class_id WHERE NOT i.pending GROUP BY c.grade, i.topic`),
  q(`SELECT c.grade, date_trunc('week', t.submitted_at) AS week, round(avg(t.percent),1)::float AS avg, count(*)::int AS n
                         FROM attempts t JOIN classes c ON c.id=t.class_id WHERE t.status='submitted' AND t.submitted_at > now() - interval '16 weeks'
                         GROUP BY c.grade, week ORDER BY week`),
  one(`SELECT (SELECT count(*)::int FROM users WHERE role='student') AS students,
      (SELECT count(*)::int FROM exams) AS exams, (SELECT count(*)::int FROM attempts WHERE status='submitted') AS submissions,
      (SELECT count(*)::int FROM attempts WHERE needs_grading) AS pending`)]);
  return { classes, topics, trend, totals: totals_ };
});

route('GET', '/dashboard/class/:id', 'staff', async ({ params }) => {
  const cid = int(params.id);
  const [cls, ac, students, topics, studentTopics, trend, assignments] = await Promise.all([
    one('SELECT * FROM classes WHERE id=$1', [cid]),
    one('SELECT count(*)::int AS n FROM assignments WHERE class_id=$1', [cid]),
    q(`
    SELECT u.id, u.full_name, u.username, u.active, u.last_login, u.email, u.class_id,
      count(t.id) FILTER (WHERE t.status='submitted')::int AS submissions,
      count(DISTINCT t.assignment_id) FILTER (WHERE t.status='submitted')::int AS done_assignments,
      round(avg(t.percent) FILTER (WHERE t.status='submitted' AND t.kind='assignment'),1) AS avg_percent,
      count(t.id) FILTER (WHERE t.kind='practice' AND t.status='submitted')::int AS practice_count,
      max(t.submitted_at) AS last_submitted,
      (array_agg(t.percent ORDER BY t.submitted_at) FILTER (WHERE t.status='submitted' AND t.kind='assignment')) AS series
    FROM users u LEFT JOIN attempts t ON t.user_id=u.id
    WHERE u.class_id=$1 AND u.role='student' GROUP BY u.id ORDER BY u.full_name`, [cid]),
    q(`SELECT topic, sum(earned)::float AS earned, sum(max)::float AS max, count(*)::int AS n
       FROM attempt_items WHERE class_id=$1 AND NOT pending GROUP BY topic`, [cid]),
    q(`SELECT user_id, topic, sum(earned)::float AS earned, sum(max)::float AS max
       FROM attempt_items WHERE class_id=$1 AND NOT pending GROUP BY user_id, topic`, [cid]),
    q(`SELECT date_trunc('week', submitted_at) AS week, round(avg(percent),1)::float AS avg, count(*)::int AS n
       FROM attempts WHERE class_id=$1 AND status='submitted' GROUP BY week ORDER BY week`, [cid]),
    q(`SELECT a.id, COALESCE(a.title,e.title) AS title, a.due_at, a.created_at,
      (SELECT count(DISTINCT t.user_id)::int FROM attempts t WHERE t.assignment_id=a.id AND t.status='submitted') AS done,
      (SELECT round(avg(t.percent),1) FROM attempts t WHERE t.assignment_id=a.id AND t.status='submitted') AS avg_percent
    FROM assignments a JOIN exams e ON e.id=a.exam_id WHERE a.class_id=$1 ORDER BY a.created_at`, [cid]),
  ]);
  if (!cls) fail(404, 'Không tìm thấy lớp');
  return { class: cls, assignCount: ac.n, students, topics, studentTopics, trend, assignments };
});

async function studentStats(userId) {
  const [u, attempts, topics, recentTopics, extra] = await Promise.all([
    one(`SELECT u.id,u.full_name,u.username,u.class_id,u.last_login,u.created_at,c.name AS class_name,c.grade
         FROM users u LEFT JOIN classes c ON c.id=u.class_id WHERE u.id=$1`, [userId]),
    q(`SELECT id, kind, title, score, max_score, percent, needs_grading, submitted_at, duration_sec
       FROM attempts WHERE user_id=$1 AND status='submitted' ORDER BY submitted_at`, [userId]),
    q(`SELECT topic, sum(earned)::float AS earned, sum(max)::float AS max, count(*)::int AS n,
         sum(CASE WHEN correct THEN 1 ELSE 0 END)::int AS right_n
       FROM attempt_items WHERE user_id=$1 AND NOT pending GROUP BY topic`, [userId]),
    q(`SELECT topic, sum(earned)::float AS earned, sum(max)::float AS max FROM attempt_items
       WHERE user_id=$1 AND NOT pending AND submitted_at > now() - interval '30 days' GROUP BY topic`, [userId]),
    // điểm TB lớp + số bài chưa làm (lấy lớp ngay trong truy vấn)
    one(`SELECT
        (SELECT round(avg(t.percent),1)::float FROM attempts t WHERE t.class_id=u.class_id AND t.status='submitted' AND t.kind='assignment') AS class_avg,
        (SELECT count(*)::int FROM assignments a WHERE a.class_id=u.class_id AND a.status='published'
          AND (a.due_at IS NULL OR a.due_at > now()) AND (a.opens_at IS NULL OR a.opens_at <= now())
          AND NOT EXISTS (SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=u.id AND t.status='submitted')) AS pending
       FROM users u WHERE u.id=$1`, [userId]),
  ]);
  if (!u) fail(404, 'Không tìm thấy học sinh');
  return { student: u, attempts, topics, recentTopics, classAvg: extra?.class_avg ?? null, pendingAssignments: extra?.pending ?? 0 };
}
route('GET', '/dashboard/student/:id', 'staff', async ({ params }) => studentStats(params.id));

// ================================================================ XUẤT CSV
route('GET', '/export/class/:id', 'staff', async ({ params }) => {
  const cid = int(params.id);
  const [cls, assigns, students, best] = await Promise.all([
    one('SELECT * FROM classes WHERE id=$1', [cid]),
    q(`SELECT a.id, COALESCE(a.title,e.title) AS title, a.created_at FROM assignments a JOIN exams e ON e.id=a.exam_id WHERE a.class_id=$1 ORDER BY a.created_at`, [cid]),
    q(`SELECT id, full_name, username FROM users WHERE class_id=$1 AND role='student' ORDER BY full_name`, [cid]),
    q(`SELECT t.user_id, t.assignment_id, max(t.percent)::float AS best FROM attempts t JOIN assignments a ON a.id=t.assignment_id
       WHERE a.class_id=$1 AND t.status='submitted' GROUP BY t.user_id, t.assignment_id`, [cid]),
  ]);
  if (!cls) fail(404, 'Không tìm thấy lớp');
  const map = new Map(best.map((b) => [`${b.user_id}-${b.assignment_id}`, b.best]));
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  // 5 bài giao gần nhất (xếp từ cũ đến mới), điểm cao nhất của mỗi em quy về thang 10, dấu phẩy thập phân kiểu Việt Nam
  const recent = assigns.slice(-5);
  const d2 = (v) => {
    const t = v ? new Date(v) : null;
    if (!t || isNaN(t)) return '';
    const vn = new Date(t.getTime() + 7 * 3600e3); // giờ Việt Nam
    return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const ten = (v) => (v == null ? '' : (Math.round(v) / 10).toFixed(1).replace('.', ','));
  const rows = [['STT', 'Họ tên', 'Tên đăng nhập', ...recent.map((a) => `${a.title} (giao ${d2(a.created_at)}) – điểm /10`)]];
  students.forEach((s, i) => {
    rows.push([i + 1, s.full_name, s.username, ...recent.map((a) => ten(map.get(`${s.id}-${a.id}`)))]);
  });
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ket-qua-lop-${cls.id}.csv"` } });
});
