// Vercel 운영 환경에서 쓰는 앱 인스턴스 (환경변수에서 설정을 읽음)
const { createApp } = require('./app');
const { redisStore } = require('./store');
const { gmailMailer, consoleMailer } = require('./mail');

let app;
function getApp() {
  if (app) return app;
  const { Redis } = require('@upstash/redis');
  // Vercel 마켓플레이스로 Upstash를 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN 이 자동으로 들어옴
  const redis = new Redis({
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false, // 모든 값을 문자열로 받아서 직접 JSON.parse (숫자처럼 생긴 id가 숫자로 바뀌는 문제 방지)
  });
  const { waitUntil } = require('@vercel/functions');
  const siteUrl = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  app = createApp({
    store: redisStore(redis),
    mail: process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
      ? gmailMailer(process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD.replace(/\s/g, ''), '산타가 이어줄게')
      : consoleMailer(),
    // 응답을 먼저 돌려주고 메일 발송 같은 작업은 이어서 처리
    enqueue: async (job) => waitUntil(app.runJob(job).catch((e) => console.error('job fail', e))),
    cfg: {
      emailDomain: process.env.EMAIL_DOMAIN || 'khu.ac.kr',
      secret: process.env.SESSION_SECRET,
      adminPassword: process.env.ADMIN_PASSWORD,
      siteUrl,
      secureCookie: true,
      dev: false,
    },
  });
  return app;
}

function parseCookies(header) {
  return Object.fromEntries((header || '').split(';').filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i).trim(), c.slice(i + 1).trim()]; }));
}

module.exports = { getApp, parseCookies };
