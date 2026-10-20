// Điểm vào khi chạy trên Cloudflare Workers:
//  - /api/*  → API (netlify/functions/api.mjs – dùng chung cho Cloudflare, Netlify và chạy thử trên máy)
//  - còn lại → file giao diện trong dist/ (Cloudflare phục vụ miễn phí, không giới hạn)
import api from '../netlify/functions/api.mjs';

export default {
  async fetch(req, env) {
    if (!globalThis.__CF_ENV) {
      globalThis.__CF_ENV = env;
      // biến môi trường / secret của Cloudflare → process.env (mã dùng chung đọc từ đây)
      for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
    }
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return api(req);
    return env.ASSETS.fetch(req);
  },
};
