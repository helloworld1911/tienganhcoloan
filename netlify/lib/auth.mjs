// Mật khẩu (PBKDF2-SHA256; vẫn đọc được mật khẩu cũ dạng scrypt) + token đăng nhập (JWT HS256)
// PBKDF2 với số vòng vừa phải để mỗi lần đăng nhập chỉ tốn vài ms CPU (giới hạn gói miễn phí Cloudflare: 10 ms).
import crypto from 'node:crypto';
import { connectionFingerprint } from './db.mjs';

const ITER = 10000;
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pw), salt, ITER, 32, 'sha256').toString('hex');
  return `pbkdf2$${ITER}$${salt}$${hash}`;
}
export function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  let h, expected;
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    expected = Buffer.from(parts[3], 'hex');
    h = crypto.pbkdf2Sync(String(pw), parts[2], +parts[1] || ITER, expected.length, 'sha256');
  } else if (parts[0] === 'scrypt' && parts.length === 3) {
    expected = Buffer.from(parts[2], 'hex');
    h = crypto.scryptSync(String(pw), parts[1], 32);
  } else return false;
  return expected.length === h.length && crypto.timingSafeEqual(h, expected);
}
/** Mật khẩu lưu theo kiểu cũ (scrypt – tốn CPU) → nên lưu lại theo kiểu mới sau khi đăng nhập đúng */
export const needsRehash = (stored) => !String(stored || '').startsWith(`pbkdf2$${ITER}$`);

function secret() {
  // Nên đặt JWT_SECRET trong Netlify. Nếu chưa đặt, sinh khoá từ chuỗi kết nối CSDL (vốn là bí mật).
  const s = process.env.JWT_SECRET || crypto.createHash('sha256').update('engweb:' + connectionFingerprint()).digest('hex');
  if (!s) throw new Error('Thiếu JWT_SECRET');
  return s;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, days = 30) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + days * 86400 }));
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
export function verifyToken(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const sig = crypto.createHmac('sha256', secret()).update(`${h}.${b}`).digest('base64url');
  if (sig.length !== s.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(s))) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (p.exp && p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

export function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(len)) s += chars[b % chars.length];
  return s;
}
