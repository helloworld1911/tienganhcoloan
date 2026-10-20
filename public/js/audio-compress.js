// Nén file nghe ngay trên trình duyệt trước khi tải lên: MP3 mono 24 kHz, 48 kbps.
// Giọng nói vẫn rõ, dung lượng thường giảm 2–4 lần → kho lưu trữ dùng được lâu hơn nhiều.
// Nạp riêng (chỉ khi cô tải file nghe) nên không làm chậm các trang khác.
import { Mp3Encoder } from '@breezystack/lamejs';

const RATE = 24000;
const KBPS = 48;
const MAX_INPUT = 60 * 1024 * 1024; // file quá lớn: tải nguyên bản (giải mã sẽ tốn nhiều bộ nhớ)

/**
 * Trả về File .mp3 đã nén, hoặc null nếu không cần / không nén được (khi đó dùng file gốc).
 * onProgress(0..1)
 */
export async function compressAudio(file, onProgress = () => {}) {
  if (file.size > MAX_INPUT) return null;
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  let audio;
  try {
    // giải mã thẳng ở 24 kHz (trình duyệt tự đổi tần số lấy mẫu)
    audio = await new Ctx(1, 1, RATE).decodeAudioData(await file.arrayBuffer());
  } catch { return null; }
  const dur = audio.duration;
  if (!dur) return null;
  if ((file.size * 8) / dur <= KBPS * 1000 * 1.3) return null; // file đã nhẹ sẵn

  const chs = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const n = audio.length;
  const enc = new Mp3Encoder(1, audio.sampleRate, KBPS);
  const BLOCK = 1152 * 40;
  const pcm = new Int16Array(BLOCK);
  const parts = [];
  let last = performance.now();
  for (let i = 0; i < n; i += BLOCK) {
    const len = Math.min(BLOCK, n - i);
    for (let j = 0; j < len; j++) {
      let s = 0;
      for (const ch of chs) s += ch[i + j];
      s /= chs.length;
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const mp3 = enc.encodeBuffer(len === BLOCK ? pcm : pcm.subarray(0, len));
    if (mp3.length) parts.push(new Uint8Array(mp3));
    if (performance.now() - last > 40) { onProgress(i / n); await new Promise((r) => setTimeout(r)); last = performance.now(); }
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  onProgress(1);
  const out = new Blob(parts, { type: 'audio/mpeg' });
  if (out.size > file.size * 0.85) return null; // nén không đáng kể → giữ bản gốc
  const name = (file.name || 'file-nghe').replace(/\.[^.]+$/, '') + '.mp3';
  return new File([out], name, { type: 'audio/mpeg' });
}
