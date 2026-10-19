// Lấy file nghe từ link ngoài (Google Drive, Dropbox, OneDrive, link mp3 trực tiếp) theo từng đoạn (HTTP Range).

/** ID file Google Drive trong link chia sẻ, hoặc null */
export function driveId(url) {
  const s = String(url || '');
  if (!/drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/.test(s)) return null;
  const m = s.match(/\/file\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/);
  return m ? m[1] : null;
}

/** Đổi link chia sẻ thành link tải trực tiếp */
export function directUrl(url) {
  const s = String(url || '').trim();
  const id = driveId(s);
  if (id) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  try {
    const u = new URL(s);
    if (/dropbox\.com$/.test(u.hostname)) { u.searchParams.set('dl', '1'); return u.toString(); }
    if (/1drv\.ms$|onedrive\.live\.com$/.test(u.hostname)) { u.searchParams.set('download', '1'); return u.toString(); }
  } catch { /* link không hợp lệ: để fetchRange báo lỗi */ }
  return s;
}

/**
 * Tải đoạn [start, end] (bao gồm). Trả về { status, total, mime, buf, filename }.
 * Báo lỗi dễ hiểu nếu link trả về trang web (chưa chia sẻ công khai…).
 */
export async function fetchRange(url, start, end, { timeoutMs = 20000 } = {}) {
  if (!/^https:\/\//i.test(url) && !process.env.ALLOW_HTTP_AUDIO) throw new Error('Link file nghe phải bắt đầu bằng https://');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { headers: { range: `bytes=${start}-${end}`, 'user-agent': 'Mozilla/5.0 TiengAnhCoLoan' }, redirect: 'follow', signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Máy chủ chứa file nghe phản hồi quá chậm, hãy thử lại' : 'Không mở được link file nghe');
  } finally { clearTimeout(timer); }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (res.status === 404) throw new Error('Không tìm thấy file theo link này');
  if (res.status === 401 || res.status === 403 || type.includes('text/html')) {
    throw new Error('Link chưa được chia sẻ công khai. Trên Google Drive: bấm Chia sẻ → “Bất kỳ ai có đường liên kết” → Người xem, rồi thử lại.');
  }
  if (!res.ok) throw new Error(`Không tải được file nghe (lỗi ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const cr = res.headers.get('content-range'); // bytes 0-0/12345
  const total = cr ? +cr.split('/')[1] : (res.status === 200 ? buf.length : NaN);
  const cd = res.headers.get('content-disposition') || '';
  const fn = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1];
  const mime = /^audio\//.test(type) ? type.split(';')[0]
    : /\.m4a$/i.test(fn || url) ? 'audio/mp4' : /\.wav$/i.test(fn || url) ? 'audio/wav' : /\.ogg$/i.test(fn || url) ? 'audio/ogg' : 'audio/mpeg';
  return { status: res.status, total, mime, buf, filename: fn ? decodeURIComponent(fn) : null };
}
