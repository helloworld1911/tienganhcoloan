// Mật khẩu (scrypt) + token đăng nhập (JWT HS256) – không cần thư viện ngoài
import crypto from 'node:crypto';
import { connectionFingerprint } from './db.mjs';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === h.length && crypto.timingSafeEqual(h, expected);
}

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
