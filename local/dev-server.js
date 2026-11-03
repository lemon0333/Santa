// 로컬 개발 서버: Vercel·Redis 없이 메모리 저장소로 똑같은 API를 돌려봄
//   node local/dev-server.js   →  http://localhost:3000  (관리자 비번: admin)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../lib/app');
const { memoryStore } = require('../lib/store');
const { consoleMailer } = require('../lib/mail');

const store = memoryStore();
const app = createApp({
  store, mail: consoleMailer(),
  enqueue: async (job) => setImmediate(() => app.runJob(job)),
  cfg: { emailDomain: 'khu.ac.kr', secret: 'dev-secret', adminPassword: process.env.ADMIN_PASSWORD || 'admin', siteUrl: 'http://localhost:3000', secureCookie: false, dev: true },
});
// 가짜 신청자 30명 자동 생성 (SEED=0 이면 안 만듦)
const SEED = process.env.SEED === undefined ? 30 : Number(process.env.SEED);
if (SEED > 0) require('./seed').seed(store, SEED);

const WEB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PORT = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {}
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i).trim(), c.slice(i + 1)]; }));
    const r = await app({ method: req.method, path: url.pathname, cookies, body, ip: req.socket.remoteAddress });
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...(r.headers || {}), ...(r.cookies?.length ? { 'Set-Cookie': r.cookies } : {}) });
    return res.end(r.json ? JSON.stringify(r.json) : '');
  }
  let f = path.join(WEB, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(WEB, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`🎄 로컬: http://localhost:${PORT}  관리자: /admin.html (비번 admin)`));
