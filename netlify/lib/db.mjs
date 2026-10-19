// Kết nối Postgres.
// - Trên Netlify: Netlify Database tự cấp NETLIFY_DB_URL khi deploy (gói @netlify/database).
// - Hoặc tự đặt DATABASE_URL (Neon, Supabase, Postgres bất kỳ) trong biến môi trường.
import { getDatabase } from '@netlify/database';
import { SCHEMA_SQL } from './schema.mjs';

let pool = null;
let schemaReady = null;

function getPool() {
  if (pool) return pool;
  // Ưu tiên DATABASE_URL do bạn tự đặt (Neon/Supabase…), sau đó mới tới Netlify Database
  const custom = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!custom && !process.env.NETLIFY_DB_URL) {
    throw new Error('Chưa kết nối cơ sở dữ liệu. Vào Netlify → Project configuration → Environment variables, thêm biến DATABASE_URL (chuỗi kết nối Neon) rồi deploy lại.');
  }
  const conn = custom ? getDatabase({ connectionString: custom }) : getDatabase();
  pool = conn.pool;
  // Giới hạn số kết nối (chạy thử cục bộ với PGlite chỉ hỗ trợ 1 kết nối)
  if (process.env.DB_POOL_MAX && pool.options) pool.options.max = +process.env.DB_POOL_MAX;
  return pool;
}

export function connectionFingerprint() {
  return process.env.NETLIFY_DB_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || '';
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
        await getPool().query(stmt);
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export async function q(text, params = []) {
  const res = await getPool().query(text, params);
  return res.rows;
}
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

/** Chạy nhiều câu lệnh trong một transaction. fn nhận client có .query */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn({ q: async (t, p = []) => (await client.query(t, p)).rows });
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
