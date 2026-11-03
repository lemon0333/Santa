// 모든 /api/* 요청을 받아서 lib/app.js 라우터로 넘기는 Vercel 함수
const { getApp, parseCookies } = require('../lib/vercel-app');

module.exports = async (req, res) => {
  if ((process.env.SESSION_SECRET || '').length < 32) return res.status(500).json({ error: 'SESSION_SECRET 환경변수가 없거나 너무 짧아요 (32자 이상)' });
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)) return res.status(500).json({ error: 'Redis(Upstash)가 아직 연결되지 않았어요' });
  const app = getApp();
  const url = new URL(req.url, 'http://x');
  // vercel.json rewrite가 /api/xxx → /api/index?__path=xxx 로 넘겨줌
  const sub = url.searchParams.get('__path');
  const path = sub != null ? '/api/' + sub.replace(/^\/+/, '') : url.pathname;
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const r = await app({ method: req.method, path, cookies: parseCookies(req.headers.cookie), body: body || {}, ip, origin: req.headers.origin, host: req.headers['x-forwarded-host'] || req.headers.host });
  res.setHeader('Cache-Control', 'no-store');
  if (r.cookies?.length) res.setHeader('Set-Cookie', r.cookies);
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  res.status(r.status);
  return r.json !== undefined ? res.json(r.json) : res.end();
};
