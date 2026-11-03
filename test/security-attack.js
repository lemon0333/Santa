// 보안 공격 테스트: 'PORT=3130 node local/dev-server.js' 실행 후 'node test/security-attack.js' (서버 로그를 /tmp/claude-0/dev3.log로 남겨야 인증 코드를 읽음)
const B = 'http://localhost:3130';
const fs = require('fs');
const out = [];
const rec = (name, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
async function req(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j, h: r.headers };
}
const codeFor = (email) => { const m = [...fs.readFileSync('/tmp/claude-0/dev3.log', 'utf8').matchAll(new RegExp(`to=${email.replace('.', '\\.')} .*?인증 코드: (\\d{6})`, 'g'))]; return m.length ? m[m.length - 1][1] : null; };
async function login(email) {
  await req('/api/auth/request', { method: 'POST', body: { email } });
  const r = await fetch(B + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code: codeFor(email) }) });
  return r.headers.get('set-cookie').split(';')[0];
}
(async () => {
  // 1. 학교 메일 아닌 주소
  for (const e of ['a@gmail.com', 'a@khu.ac.kr.evil.com', 'a@evilkhu.ac.kr', 'a@khu.ac.kr\nBcc: x@y.com']) {
    const r = await req('/api/auth/request', { method: 'POST', body: { email: e } }); rec('다른 도메인 메일 거절: ' + JSON.stringify(e), r.s === 400, r.s);
  }
  // 2. 인증 코드 무차별 대입
  await req('/api/auth/request', { method: 'POST', body: { email: 'victim@khu.ac.kr' } });
  let codes = []; for (let i = 0; i < 7; i++) codes.push((await req('/api/auth/verify', { method: 'POST', body: { email: 'victim@khu.ac.kr', code: String(100000 + i) } })).s);
  rec('코드 추측 5번 후 차단', codes.slice(5).every((s) => s === 429), codes.join(','));
  const real = codeFor('victim@khu.ac.kr');
  const after = await req('/api/auth/verify', { method: 'POST', body: { email: 'victim@khu.ac.kr', code: real } });
  rec('차단 후엔 진짜 코드도 거절', after.s !== 200, after.s);
  // 3. 코드 재요청 1분 제한
  const rr = await req('/api/auth/request', { method: 'POST', body: { email: 'victim@khu.ac.kr' } }); rec('코드 1분 내 재요청 거절', rr.s === 429, rr.s);
  // 4. 위조 쿠키
  const fake = 'sid=' + Buffer.from(JSON.stringify({ uid: 'x', exp: 9e15 })).toString('base64url') + '.AAAA';
  rec('위조 세션 쿠키 거절', (await req('/api/me', { cookie: fake })).s === 401, '');
  const me = await login('attacker@khu.ac.kr');
  rec('정상 로그인', (await req('/api/me', { cookie: me })).s === 200, '');
  // 5. 사용자 쿠키로 관리자 API
  for (const p of ['/api/admin/stats', '/api/admin/users']) rec('일반 사용자 → 관리자 API 거절 ' + p, (await req(p, { cookie: me })).s === 401, '');
  const swap = 'adm=' + me.split('=')[1];
  rec('사용자 토큰을 관리자 쿠키로 바꿔치기 거절', (await req('/api/admin/users', { cookie: swap })).s === 401, '');
  rec('관리자 매칭 확정 API 무단 호출 거절', (await req('/api/admin/match', { method: 'POST', body: { commit: true }, cookie: me })).s === 401, '');
  // 6. 관리자 비밀번호 대입
  const tries = []; for (let i = 0; i < 7; i++) tries.push((await req('/api/admin/login', { method: 'POST', body: { password: 'guess' + i } })).s);
  rec('관리자 비번 5번 틀리면 잠금', tries.slice(5).every((s) => s === 429), tries.join(','));
  // 7. CSRF: 다른 사이트 Origin
  const cs = await req('/api/account/delete', { method: 'POST', body: {}, cookie: me, headers: { Origin: 'https://evil.com' } });
  rec('다른 사이트에서 온 탈퇴 요청 차단(CSRF)', cs.s === 403, cs.s);
  rec('CSRF 차단 후 계정 그대로', (await req('/api/me', { cookie: me })).s === 200, '');
  // 8. 입력값 공격
  const base = { gender: 'M', want_gender: 'F', student_no: '21', birth: '2002-03-15', mbti: 'ENTP', instagram: 'atk', likes: ['☕ 카페 투어'], xmas: ['🎪 크리스마스 마켓'], agree_collect: true, agree_share: true };
  const cfg = (await req('/api/config')).j; base.likes = [cfg.tastes.LIKES[0]]; base.xmas = [cfg.tastes.XMAS[0]];
  const bads = {
    'dept=__proto__': { dept: '__proto__' }, 'dept=constructor': { dept: 'constructor' },
    'XSS 인스타': { instagram: '<img src=x onerror=alert(1)>' }, '없는 취향 칩': { likes: ['<script>'] },
    '취향 칩 6개': { likes: cfg.tastes.LIKES.slice(0, 6) }, '미성년 생일': { birth: '2010-01-01' }, 'MBTI 이상값': { mbti: 'XXXX' },
    '성별 이상값': { gender: 'Z' }, '동의 안 함': { agree_share: false }, 'mbti 객체': { mbti: { a: 1 } },
  };
  for (const [n, o] of Object.entries(bads)) { const r = await req('/api/apply', { method: 'POST', body: { ...base, ...o }, cookie: me }); rec('잘못된 입력 거절: ' + n, r.s === 400, r.s + ' ' + (r.j.error || '')); }
  const longIntro = await req('/api/apply', { method: 'POST', body: { ...base, intro: '<script>alert(1)</script>' + 'a'.repeat(5000), role: 'admin', blocked: false, applied: false, id: 'other' }, cookie: me });
  const mine = (await req('/api/me', { cookie: me })).j;
  rec('추가 필드 주입 무시(id/role)·소개 200자 제한', longIntro.s === 200 && mine.id !== 'other' && mine.intro.length <= 200 && mine.role === undefined, `intro ${mine.intro.length}자, id ${mine.id.slice(0, 6)}…`);
  rec('깨진 JSON 처리', (await req('/api/apply', { method: 'POST', body: '{"broken', cookie: me })).s === 400, '');
  // 9. 발표 전 결과·신고 API
  const r1 = await req('/api/result', { cookie: me }); rec('발표 전 결과에 상대 정보 없음', !r1.j.partner, JSON.stringify(r1.j).slice(0, 60));
  rec('발표 전 신고 거절', (await req('/api/report', { method: 'POST', body: { reason: 'x' }, cookie: me })).s === 400, '');
  rec('발표 전 수락 거절', (await req('/api/result/answer', { method: 'POST', body: { answer: 'yes' }, cookie: me })).s === 400, '');
  // 10. 공개 API에 개인정보 없음
  const pub = JSON.stringify((await req('/api/config')).j);
  rec('공개 설정 API에 메일·인스타 없음', !/@khu|atk/.test(pub), '');
  // 11. 경로 탐색
  const tr = await fetch(B + '/..%2f..%2fpackage.json'); const tt = await tr.text();
  rec('경로 탐색으로 서버 파일 못 읽음', !tt.includes('"dependencies"'), tr.status);
  const tr2 = await fetch(B + '/../lib/app.js'); rec('lib 소스 노출 없음', !(await tr2.text()).includes('createApp'), '');
  // 12. 보안 헤더
  const h = (await fetch(B + '/')).headers;
  rec('CSP 헤더', !!h.get('content-security-policy'), ''); rec('클릭재킹 방지 헤더', h.get('x-frame-options') === 'DENY', '');
  // 13. 탈퇴 후 쿠키 무효
  await req('/api/account/delete', { method: 'POST', body: {}, cookie: me });
  rec('탈퇴 후 기존 쿠키로 정보 조회 불가', (await req('/api/me', { cookie: me })).s === 401, '');
  console.log(out.join('\n'));
  console.log('\n총', out.length, '개 중 실패', out.filter((x) => x.startsWith('FAIL')).length);
})();
