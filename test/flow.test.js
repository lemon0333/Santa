// 전체 흐름 테스트 (AWS 없이 메모리 저장소로): npm test
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../lib/app');
const { memoryStore, redisStore } = require('../lib/store');
const { fakeRedis } = require('./fake-redis');
const mkStore = process.env.STORE === 'redis' ? () => redisStore(fakeRedis()) : memoryStore;
const { seed } = require('../local/seed');

const _PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077053de0000000c4944415408d763f8cfc00000030101009c18e5a20000000049454e44ae426082', 'hex').toString('base64');

function setup() {
  const store = mkStore(), sent = [];
  const jobs = [];
  const app = createApp({ store, mail: async (to, subject, text, o = {}) => { for (const r of [to, ...(o.bcc || [])].filter(Boolean)) sent.push({ to: r, subject }); }, enqueue: async (j) => jobs.push(j),
    cfg: { emailDomain: 'khu.ac.kr', secret: 's', adminPassword: 'pw', siteUrl: 'http://x', dev: true } });
  const client = () => {
    const jar = {};
    const call = async (method, path, body) => {
      const r = await app({ method, path, cookies: jar, body, ip: '1.1.1.1' });
      for (const c of r.cookies || []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; }
      return r;
    };
    return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b) };
  };
  return { app, store, sent, jobs, client };
}
async function login(c, email) {
  const r = await c.post('/api/auth/request', { email });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const v = await c.post('/api/auth/verify', { email, code: r.json.devCode });
  assert.equal(v.status, 200);
}
const profile = (o = {}) => ({ gender: 'M', want_gender: 'F', dept: '컴퓨터공학부', student_no: '21', birth: '2002-03-15', mbti: 'ENTP', instagram: '@hyunbin.son', likes: ['☕ 카페 투어', '🎮 게임'], xmas: ['🎪 크리스마스 마켓'], agree_collect: true, agree_share: true, ...o });

test('학교 메일만 허용 + 속도 제한', async () => {
  const { client } = setup(); const c = client();
  assert.equal((await c.post('/api/auth/request', { email: 'a@gmail.com' })).status, 400);
  assert.equal((await c.post('/api/auth/request', { email: 'a@khu.ac.kr' })).status, 200);
  assert.equal((await c.post('/api/auth/request', { email: 'a@khu.ac.kr' })).status, 429); // 1분 쿨다운
  const r = await c.post('/api/auth/verify', { email: 'a@khu.ac.kr', code: '000000' });
  assert.equal(r.status, 400);
});

test('신청 검증: 동의 2개, 19세 기준, 필드 표시', async () => {
  const { client } = setup(); const c = client();
  await login(c, 'me@khu.ac.kr');
  let r = await c.post('/api/apply', profile({ agree_share: false }));
  assert.equal(r.json.field, 'agree_share');
  r = await c.post('/api/apply', profile({ birth: `${new Date().getFullYear() - 18}-01-01` }));
  assert.equal(r.json.field, 'birth');
  r = await c.post('/api/apply', profile({ birth: `${new Date().getFullYear() - 19}-12-31` }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test('같은 과: 둘 다 괜찮다고 해야만 매칭', async () => {
  const { runMatching } = require('../lib/matching');
  const base = { gender: 'M', want_gender: 'F', dept: '경영학과', birth: '2002-01-01', mbti: 'ENFP', exclude: [] };
  const a = { ...base, id: 'a', allow_same_dept: true }, b = { ...base, id: 'b', gender: 'F', want_gender: 'M', allow_same_dept: false };
  assert.equal(runMatching([a, b]).length, 0);
  assert.equal(runMatching([a, { ...b, allow_same_dept: true }]).length, 1);
});

test('전체 흐름: 수락 전 정보 제한, 생일 정보 미노출, 서로 수락 후 공개, 발표 잠금, 차단', async () => {
  const { client, store, jobs } = setup();
  const me = client(), her = client(), admin = client();
  await login(me, 'me@khu.ac.kr');
  assert.equal((await me.post('/api/apply', profile({ exclude_emails: 'ex@khu.ac.kr' }))).status, 200);
  await login(her, 'her@khu.ac.kr');
  assert.equal((await her.post('/api/apply', profile({ gender: 'F', want_gender: 'M', dept: '경영학과', mbti: 'INFJ', instagram: 'haeun_k' }))).status, 200);
  await login(client(), 'ex@khu.ac.kr');
  const ex = client(); await login(ex, 'ex@khu.ac.kr');
  await ex.post('/api/apply', profile({ gender: 'F', want_gender: 'M', dept: '사학과', mbti: 'ENFP' }));
  // 같은 과 남자 → 나와는 안 잡혀야 함
  const same = client(); await login(same, 'same@khu.ac.kr');
  await same.post('/api/apply', profile({ gender: 'F', want_gender: 'M', dept: '컴퓨터공학부', same_dept: 'ok' }));

  assert.equal((await admin.post('/api/admin/login', { password: 'pw' })).status, 200);
  assert.equal((await admin.post('/api/admin/match', {})).status, 400); // 신청 중엔 매칭 불가
  await admin.post('/api/admin/phase', { phase: 'closed' });
  assert.equal((await me.post('/api/apply', profile())).status, 400); // 마감 후 수정 불가
  const m = await admin.post('/api/admin/match', { commit: true });
  assert.equal(m.status, 200);
  await admin.post('/api/admin/phase', { phase: 'announced' });
  assert.deepEqual(jobs, [{ type: 'announce-mail' }]);
  assert.equal((await admin.post('/api/admin/phase', { phase: 'open' })).status, 400); // 발표 후 잠금
  assert.equal((await admin.post('/api/admin/match', { commit: true })).status, 400);

  const r1 = (await me.get('/api/result')).json;
  assert.equal(r1.matched, true);
  assert.equal(r1.partner.mbti, 'INFJ'); // 지인 제외·같은 과 제외로 하은만 가능
  assert.equal(r1.partner.name, undefined);
  assert.equal(r1.partner.instagram, undefined);
  assert.equal(r1.partner.instagram, undefined);
  assert.equal(r1.partner.dept, undefined);
  assert.equal(r1.partner.college, '경영대학');
  const raw = JSON.stringify(r1);
  assert.ok(Array.isArray(r1.partner.likes) && r1.compat.taste.score > 0);
  for (const leak of ['ilju', 'zodiac', 'birth', 'age"', 'email', '2002']) assert.ok(!raw.includes(leak), 'leak: ' + leak);


  await me.post('/api/result/answer', { answer: 'yes' });
  assert.equal((await me.post('/api/result/answer', { answer: 'no' })).status, 400); // 한 번만
  assert.equal((await me.get('/api/result')).json.partner.instagram, undefined);
  await her.post('/api/result/answer', { answer: 'yes' });
  const r2 = (await me.get('/api/result')).json;
  assert.equal(r2.partner.instagram, 'haeun_k');
  assert.equal(r2.partner.instagram, 'haeun_k');

  // 차단하면 실명·인스타가 상대에게서 사라짐
  await her.post('/api/result/block', { reason: 'test' });
  const r3 = (await me.get('/api/result')).json;
  assert.equal(r3.partner.instagram, undefined);
  assert.equal(r3.partner.instagram, undefined);
  assert.equal(r3.blocked, true);
  const reports = await store.listReports();
  assert.equal(reports.length, 1);
});

test('제재된 사람은 매칭 제외, 상대 탈퇴 시 안내', async () => {
  const { client, store } = setup();
  await seed(store, 20);
  const a = client(), admin = client();
  await login(a, 'me@khu.ac.kr'); await a.post('/api/apply', profile());
  await admin.post('/api/admin/login', { password: 'pw' });
  const users = (await admin.get('/api/admin/users')).json;
  assert.equal(users.length, 21);
  await admin.post('/api/admin/ban', { id: users[0].id, banned: true });
  await admin.post('/api/admin/phase', { phase: 'closed' });
  const m = (await admin.post('/api/admin/match', { commit: true })).json;
  assert.ok(m.unmatched >= 1);
  await admin.post('/api/admin/phase', { phase: 'announced' });
  const r = (await a.get('/api/result')).json;
  if (r.matched) {
    const meU = await store.getUser((await a.get('/api/me')).json.id);
    const m = await store.getMatch(meU.match.mid);
    await store.deleteUser(m.aId === meU.id ? m.bId : m.aId);
    assert.equal((await a.get('/api/result')).json.partnerGone, true);
  }
});

test('관리자 로그인 10번 실패 시 잠금', async () => {
  const { client } = setup(); const c = client();
  for (let i = 0; i < 10; i++) await c.post('/api/admin/login', { password: 'x' });
  assert.equal((await c.post('/api/admin/login', { password: 'pw' })).status, 429);
});

test('알림 메일: 개인 메일로도 발송 + 마감 24시간 전 리마인드', async () => {
  const { client, app, sent, store } = setup();
  const me = client(), her = client(), admin = client();
  await login(me, 'me@khu.ac.kr'); await me.post('/api/apply', profile({ notify_email: 'me@gmail.com' }));
  await login(her, 'her@khu.ac.kr'); await her.post('/api/apply', profile({ gender: 'F', want_gender: 'M', dept: '경영학과', instagram: 'haeun' }));
  await admin.post('/api/admin/login', { password: 'pw' });
  await admin.post('/api/admin/phase', { phase: 'closed' }); await admin.post('/api/admin/match', { commit: true }); await admin.post('/api/admin/phase', { phase: 'announced' });
  await app.runJob({ type: 'announce-mail' });
  assert.ok(sent.some((m) => m.to === 'me@gmail.com' && m.subject.includes('결과')));
  await her.post('/api/result/answer', { answer: 'yes' });
  assert.deepEqual(await app.runJob({ type: 'reminders' }), { sent: 0 }); // 아직 24시간 전이 아님
  const s = await store.getSettings(); s.announcedAt = new Date(Date.now() - 30 * 36e5).toISOString(); await store.putSettings(s);
  sent.length = 0;
  assert.deepEqual(await app.runJob({ type: 'reminders' }), { sent: 1 }); // 답 안 한 나에게만
  assert.ok(sent.every((m) => m.to.startsWith('me@')) && sent.length === 2); // 학교 + 개인 메일
  assert.deepEqual(await app.runJob({ type: 'reminders' }), { sent: 0 }); // 한 번만
});

test('학과 없이 신청 가능, 학과 없는 두 사람은 같은 과 규칙에 안 걸림', () => {
  const { runMatching } = require('../lib/matching');
  const a = { id: 'a', gender: 'M', want_gender: 'F', dept: '', birth: '2002-01-01', mbti: 'ENFP', exclude: [] };
  const b = { ...a, id: 'b', gender: 'F', want_gender: 'M' };
  assert.equal(runMatching([a, b]).length, 1);
  assert.equal(runMatching([{ ...a, same_campus: true }, b]).length, 0);
});

test('인스타 대신 카톡 ID만 적어도 신청 가능, 둘 다 없으면 거절', async () => {
  const store = mkStore();
  const app = createApp({ store, mail: async () => {}, enqueue: async () => {}, cfg: { emailDomain: 'khu.ac.kr', secret: 's'.repeat(40), adminPassword: 'pw', siteUrl: 'http://x', dev: true } });
  const call = async (method, path, body, cookie) => app({ method, path, body, cookies: cookie ? { sid: cookie } : {}, ip: '1' });
  const r = await call('POST', '/api/auth/request', { email: 'k@khu.ac.kr' });
  const v = await call('POST', '/api/auth/verify', { email: 'k@khu.ac.kr', code: r.json.devCode });
  const sid = v.cookies[0].split(';')[0].split('=')[1];
  assert.equal((await call('POST', '/api/apply', profile({ instagram: '', kakao: '' }), sid)).status, 400);
  assert.equal((await call('POST', '/api/apply', profile({ instagram: '', kakao: 'a!' }), sid)).status, 400);
  assert.equal((await call('POST', '/api/apply', profile({ instagram: '', kakao: 'Santa_Kim' }), sid)).status, 200);
  const me = await call('GET', '/api/me', null, sid);
  assert.equal(me.json.kakao, 'santa_kim'); assert.equal(me.json.instagram, '');
});
