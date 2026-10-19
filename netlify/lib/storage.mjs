// Lưu file (file nghe mp3…) theo từng mảnh.
// - Trên Netlify: Netlify Blobs (có sẵn, không cần cấu hình).
// - Chạy thử trên máy: thư mục MEDIA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';

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
  if (local()) {
    const f = path.join(local(), safe(key));
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, Buffer.from(buf));
    return;
  }
  await (await blobs()).set(key, buf);
}

export async function getChunk(key) {
  if (local()) {
    try { return new Uint8Array(await fs.readFile(path.join(local(), safe(key)))); } catch { return null; }
  }
  const ab = await (await blobs()).get(key, { type: 'arrayBuffer' });
  return ab ? new Uint8Array(ab) : null;
}

export async function deletePrefix(prefix, chunks) {
  for (let i = 0; i < chunks; i++) {
    const key = `${prefix}/${i}`;
    if (local()) await fs.rm(path.join(local(), safe(key)), { force: true });
    else await (await blobs()).delete(key);
  }
}
