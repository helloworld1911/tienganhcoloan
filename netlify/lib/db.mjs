// Kết nối Postgres – chạy được trên Cloudflare Workers và Netlify Functions:
// - Neon (DATABASE_URL chứa neon.tech, hoặc Netlify Database): dùng driver HTTP của Neon →
//   không phải mở kết nối TCP/TLS mỗi lần hàm khởi động, mỗi truy vấn = 1 lượt HTTP.
// - Postgres khác: dùng pool kết nối thường (pg).
// - Chạy thử trên máy / kiểm thử: PGlite trong tiến trình (useLocalDb).
import { neon, neonConfig } from '@neondatabase/serverless';
// @netlify/database chỉ nạp khi thật sự cần (không dùng trên Cloudflare)
const netlifyDb = () => import('@netlify/database').then((m) => m.getDatabase);
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.mjs';

let driver = null;     // { kind, query(text, params) -> rows, batch([[text, params]]) -> rows[][] }
let schemaReady = null;

/** Dùng PGlite trực tiếp thay cho Postgres (npm run local, kiểm thử). */
export function useLocalDb(db) {
  driver = {
    kind: 'pglite',
    query: async (t, p = []) => (await db.query(t, p)).rows,
    batch: (list) => db.transaction(async (tx) => {
      const out = [];
      for (const [t, p = []] of list) out.push((await tx.query(t, p)).rows);
      return out;
    }),
  };
}

function connectionString() {
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DB_URL || '';
}

function getDriver() {
  if (driver) return driver;
  const url = connectionString();
  if (!url) {
    throw new Error('Chưa kết nối cơ sở dữ liệu. Thêm biến DATABASE_URL (chuỗi kết nối Neon) trong phần cài đặt biến môi trường (Cloudflare: Settings → Variables and Secrets; Netlify: Environment variables) rồi deploy lại.');
  }
  const custom = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  const isNeon = custom ? /\.neon\.tech|neon\.build/i.test(custom) : process.env.NETLIFY_DB_DRIVER === 'serverless';
  if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT; // chỉ dùng khi kiểm thử
  if (isNeon) {
    let sqlP = null;
    const getSql = () => (sqlP ||= custom ? Promise.resolve(neon(custom)) : netlifyDb().then((g) => g().httpClient));
    driver = {
      kind: 'neon-http',
      query: async (t, p = []) => (await getSql()).query(t, p),
      // nhiều câu lệnh trong 1 transaction, gửi trong 1 lượt HTTP
      batch: async (list) => { const sql = await getSql(); return sql.transaction(list.map(([t, p = []]) => sql.query(t, p))); },
    };
  } else {
    let poolP = null;
    const getPool = () => (poolP ||= netlifyDb().then((g) => {
      const pool = (custom ? g({ connectionString: custom }) : g()).pool;
      if (process.env.DB_POOL_MAX && pool.options) pool.options.max = +process.env.DB_POOL_MAX;
      return pool;
    }));
    driver = {
      kind: 'pg',
      query: async (t, p = []) => (await (await getPool()).query(t, p)).rows,
      batch: async (list) => {
        const c = await (await getPool()).connect();
        try {
          await c.query('BEGIN');
          const out = [];
          for (const [t, p = []] of list) out.push((await c.query(t, p)).rows);
          await c.query('COMMIT');
          return out;
        } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
      },
    };
  }
  return driver;
}

export function driverKind() { return getDriver().kind; }
export function connectionFingerprint() { return connectionString(); }

/**
 * Tạo/cập nhật bảng – chỉ chạy khi phiên bản lược đồ thay đổi.
 * Bình thường mỗi lần hàm khởi động chỉ tốn 1 truy vấn kiểm tra.
 */
export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const d = getDriver();
      try {
        const r = await d.query(`SELECT value FROM app_meta WHERE key='schema'`);
        if (r[0]?.value === SCHEMA_VERSION) return;
      } catch { /* bảng app_meta chưa có */ }
      for (const stmt of SCHEMA_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await d.query(stmt);
      await d.query(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
      await d.query(`INSERT INTO app_meta(key,value) VALUES('schema',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [SCHEMA_VERSION]);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export async function q(text, params = []) {
  return getDriver().query(text, params);
}
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}
/** Chạy nhiều câu lệnh trong một transaction (một lượt gửi với Neon). */
export async function batch(list) {
  return getDriver().batch(list);
}

/** Đo độ trễ tới CSDL (ms) */
export async function pingDb(times = 3) {
  const out = [];
  for (let i = 0; i < times; i++) { const t = Date.now(); await q('SELECT 1'); out.push(Date.now() - t); }
  return Math.min(...out);
}
