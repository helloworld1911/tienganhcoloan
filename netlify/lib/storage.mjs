// Lưu file (file nghe mp3…) theo từng mảnh ≤ 3MB.
// - Cloudflare Workers: Workers KV (binding MEDIA_KV) hoặc R2 (binding MEDIA_R2).
// - Netlify: Netlify Blobs (có sẵn, không cần cấu hình).
// - Chạy thử trên máy: thư mục MEDIA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';

const cf = () => globalThis.__CF_ENV || null; // worker/index.mjs gán env của Cloudflare vào đây
let store = null;
async function blobs() {
  if (!store) {
    const { getStore } = await import('@netlify/blobs');
    store = getStore({ name: 'media', consistency: 'strong' });
  }
  return store;
}
const local = () => process.env.MEDIA_DIR;
const safe = (k) => k.replace(/[^a-zA-Z0-9_\-/]/g, '');

export async function putChunk(key, buf) {
  const env = cf();
  if (env?.MEDIA_R2) { await env.MEDIA_R2.put(key, buf); return; }
  if (env?.MEDIA_KV) { await env.MEDIA_KV.put(key, buf); return; }
  if (local()) {
    const f = path.join(local(), safe(key));
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, Buffer.from(buf));
    return;
  }
  await (await blobs()).set(key, buf);
}

export async function getChunk(key) {
  const env = cf();
  if (env?.MEDIA_R2) { const o = await env.MEDIA_R2.get(key); return o ? new Uint8Array(await o.arrayBuffer()) : null; }
  if (env?.MEDIA_KV) {
    // mảnh file nghe không đổi → cho Cloudflare nhớ 1 ngày ở máy chủ gần người dùng (đỡ lượt đọc KV)
    const ab = await env.MEDIA_KV.get(key, { type: 'arrayBuffer', cacheTtl: 86400 });
    return ab ? new Uint8Array(ab) : null;
  }
  if (local()) {
    try { return new Uint8Array(await fs.readFile(path.join(local(), safe(key)))); } catch { return null; }
  }
  const ab = await (await blobs()).get(key, { type: 'arrayBuffer' });
  return ab ? new Uint8Array(ab) : null;
}

/** Kho đang dùng + dung lượng miễn phí (byte) */
export function storageInfo() {
  const env = cf();
  if (env?.MEDIA_R2) return { backend: 'Cloudflare R2', limit: 10 * 1024 ** 3 };
  if (env?.MEDIA_KV) return { backend: 'Cloudflare KV', limit: 1024 ** 3 };
  if (local()) return { backend: 'Thư mục máy', limit: null };
  return { backend: 'Netlify Blobs', limit: null };
}

export async function deletePrefix(prefix, chunks) {
  const env = cf();
  for (let i = 0; i < chunks; i++) {
    const key = `${prefix}/${i}`;
    if (env?.MEDIA_R2) await env.MEDIA_R2.delete(key);
    else if (env?.MEDIA_KV) await env.MEDIA_KV.delete(key);
    else if (local()) await fs.rm(path.join(local(), safe(key)), { force: true });
    else await (await blobs()).delete(key);
  }
}
