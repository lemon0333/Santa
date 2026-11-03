// 핵심 API 로직. 저장소/메일/작업큐를 주입받아서 Vercel 함수와 로컬 개발 서버가 같은 코드를 씀.
const crypto = require('crypto');
const DEPARTMENTS = require('./departments');
const { INFO, TREE } = DEPARTMENTS;
const { compatPublic, saju } = require('./compat');
const { runMatching } = require('./matching');
const TASTES = require('./tastes');
const session = require('./session');

class HttpError extends Error { constructor(status, msg, field) { super(msg); this.status = status; this.field = field; } }
const bad = (msg, status = 400, field) => { throw new HttpError(status, msg, field); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const uidOf = (email) => sha('uid:' + email).slice(0, 20);
// 인스타 아이디: 앞의 @와 링크 부분을 떼고 규칙에 맞는지 확인
const normInsta = (v) => { const id = String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, ''); return /^[A-Za-z0-9._]{1,30}$/.test(id) ? id.toLowerCase() : ''; };
const givenName = (name) => (name && name.length >= 2 ? name.slice(1) : name || ''); // 성 빼고 이름만
const ANSWER_HOURS = 48;
const RETENTION_DATE = '2026년 11월 21일';

function createApp({ store, mail, enqueue, cfg }) {
  const EMAIL_RE = new RegExp(`^[a-z0-9._%+-]+@${cfg.emailDomain.replace(/\./g, '\\.')}$`);
  const SESSION_DAYS = 30;
  let statCache = { at: 0, v: null };
  // 사용자 알림: 학교 메일 + (적었다면) 평소 쓰는 메일로도
  const notify = async (u, subject, text) => {
    const to = [...new Set([u.email, u.notify_email].filter(Boolean))];
    for (const addr of to) await mail(addr, subject, text).catch((e) => console.error('mail fail', u.id, e.message));
  };

  async function publicStats() {
    if (Date.now() - statCache.at > 30_000) {
      const users = await store.listApplicants();
      statCache = { at: Date.now(), v: { applicants: users.length, M: users.filter((u) => u.gender === 'M').length, F: users.filter((u) => u.gender === 'F').length } };
    }
    return statCache.v;
  }
  const answerDeadline = (s) => (s.announcedAt ? new Date(Date.parse(s.announcedAt) + ANSWER_HOURS * 36e5).toISOString() : null);

  const routes = {
    'GET /api/config': async () => {
      const s = await store.getSettings();
      const st = await publicStats();
      return {
        phase: s.phase, closeAt: s.closeAt, announceAt: s.announceAt, emailDomain: cfg.emailDomain, departments: TREE, tastes: TASTES, retentionDate: RETENTION_DATE,
        applicants: st.applicants, ratio: st.applicants >= 10 ? { M: st.M, F: st.F } : null, // 10명 미만이면 성비 숨김
      };
    },

    // 1) 인증 코드 발송 (메일별 하루 5번, IP별 시간당 20번)
    'POST /api/auth/request': async ({ body, ip }) => {
      const email = normEmail(body.email);
      if (!EMAIL_RE.test(email)) bad(`@${cfg.emailDomain} 학교 메일만 가능해요`);
      if (ip && (await store.hit('ip-code:' + ip, 3600)) > 20) bad('요청이 너무 많아요. 잠시 뒤에 다시 해주세요', 429);
      const prev = await store.getCode(email);
      if (prev && Date.now() - prev.sentAt < 60_000) bad('1분 뒤에 다시 시도해 주세요', 429);
      if ((await store.hit('mail-code:' + email, 86400)) > 5) bad('오늘은 인증 메일을 더 보낼 수 없어요. 내일 다시 해주세요', 429);
      const code = String(crypto.randomInt(100000, 1000000));
      await store.putCode(email, { codeHash: sha(email + code), expires: Date.now() + 10 * 60_000, attempts: 0, sentAt: Date.now() });
      await mail(email, '[산타가 이어줄게] 인증 코드', `인증 코드: ${code}\n10분 안에 입력해 주세요.\n\n본인이 요청하지 않았다면 이 메일은 무시하세요.`);
      return { ok: true, ...(cfg.dev ? { devCode: code } : {}) };
    },

    // 2) 코드 확인 → 로그인 쿠키 (코드당 5번, 메일별 하루 15번까지 시도)
    'POST /api/auth/verify': async ({ body }) => {
      const email = normEmail(body.email);
      const c = await store.getCode(email);
      if (!c || c.expires < Date.now()) bad('코드가 만료됐어요. 다시 받아주세요');
      if ((c.attempts || 0) >= 5) bad('시도 횟수를 넘었어요. 코드를 다시 받아주세요', 429);
      if (sha(email + String(body.code || '').trim()) !== c.codeHash) {
        await store.incCodeAttempts(email);
        if ((await store.hit('verify-fail:' + email, 86400)) >= 15) await store.deleteCode(email);
        bad('코드가 맞지 않아요');
      }
      await store.deleteCode(email);
      const id = uidOf(email);
      await store.createUserIfMissing({ id, email, applied: false, createdAt: new Date().toISOString() });
      return { ok: true, __cookie: session.sign({ uid: id, exp: Date.now() + SESSION_DAYS * 864e5 }, cfg.secret) };
    },
    'POST /api/auth/logout': async () => ({ ok: true, __cookie: '' }),

    'GET /api/me': async (ctx) => {
      const u = await needUser(ctx);
      return { ...selfView(u), saju: u.birth ? saju(u.birth) : null };
    },

    // 3) 신청서 제출/수정 (신청 기간에만)
    'POST /api/apply': async (ctx) => {
      const u = await needUser(ctx);
      const s = await store.getSettings();
      if (s.phase !== 'open') bad('지금은 신청 기간이 아니에요');
      const b = ctx.body;
      validate(b, u);
      const rawEx = String(b.exclude_emails || '').trim();
      const excludes = rawEx.split(/[\s,]+/).map(normEmail).filter((e) => EMAIL_RE.test(e) && e !== u.email).slice(0, 30);
      await store.putUser({
        ...u,
        name: b.name.trim(), gender: b.gender, want_gender: b.want_gender, dept: b.dept, allow_same_dept: b.same_dept === 'ok', same_campus: !!b.same_campus, student_no: b.student_no,
        birth: b.birth, mbti: b.mbti.toUpperCase(), intro: String(b.intro || '').trim().slice(0, 200), instagram: normInsta(b.instagram), notify_email: normEmail(b.notify_email) || null,
        likes: b.likes, xmas: b.xmas,
        // 칸을 비워 두면 기존 제외 목록 유지. 제외할 사람의 메일은 저장하지 않고 해시 ID만 저장.
        ...(rawEx ? { exclude: excludes.map((e) => uidOf(e)), excludeCount: excludes.length } : {}),
        ...(b.clear_exclude ? { exclude: [], excludeCount: 0 } : {}),
        applied: true, agreedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      statCache.at = 0;
      return { ok: true };
    },

    'POST /api/apply/cancel': async (ctx) => {
      const u = await needUser(ctx);
      if ((await store.getSettings()).phase !== 'open') bad('신청 기간이 끝나서 취소할 수 없어요');
      await store.putUser({ ...u, applied: false });
      statCache.at = 0;
      return { ok: true };
    },

    // 탈퇴: 프로필과 사진 즉시 삭제
    'POST /api/account/delete': async (ctx) => {
      const u = await needUser(ctx);
      await store.deleteUser(u.id);
      statCache.at = 0;
      return { ok: true, __cookie: '' };
    },

    // 4) 결과
    'GET /api/result': async (ctx) => {
      const u = await needUser(ctx);
      const s = await store.getSettings();
      if (s.phase !== 'announced') return { announced: false, announceAt: s.announceAt };
      if (!u.match || u.match.runId !== s.runId) return { announced: true, matched: false, applied: !!u.applied };
      const found = await matchOf(u, s);
      if (!found || !found.other || found.other.blocked) return { announced: true, matched: true, partnerGone: true };
      const { m, other, mine, theirs } = found;
      const deadline = answerDeadline(s);
      const expired = deadline && Date.now() > Date.parse(deadline);
      const blocked = m.aBlock || m.bBlock;
      const both = mine === 'yes' && theirs === 'yes' && !blocked;
      const info = INFO[other.dept] || {};
      return {
        announced: true, matched: true, deadline, expired: !!expired,
        // 수락 전: 사진 + 이름(성 제외) + 단과대 + MBTI + 궁합 / 서로 수락 후: 실명, 학과, 학번, 연락처
        partner: {
          givenName: givenName(other.name), college: info.college, mbti: other.mbti, intro: other.intro, likes: other.likes || [], xmas: other.xmas || [], element: compatPublic(u, other).saju.theirElement,
          ...(both ? { name: other.name, dept: other.dept, student_no: other.student_no, instagram: other.instagram } : {}),
        },
        compat: compatPublic(u, other),
        myAnswer: mine || null,
        theirAnswer: mine ? (theirs || (expired ? 'expired' : 'waiting')) : null,
        iBlocked: !!(m.aId === u.id ? m.aBlock : m.bBlock),
        blocked: !!blocked,
      };
    },

    'POST /api/result/answer': async (ctx) => {
      const u = await needUser(ctx);
      const s = await store.getSettings();
      if (s.phase !== 'announced') bad('아직 발표 전이에요');
      const deadline = answerDeadline(s);
      if (deadline && Date.now() > Date.parse(deadline)) bad('답변 기한이 지났어요');
      const found = await matchOf(u, s);
      if (!found || !found.other || found.other.blocked) bad('매칭이 없어요', 404);
      const field = found.m.aId === u.id ? 'aAnswer' : 'bAnswer';
      const ans = ctx.body.answer === 'yes' ? 'yes' : 'no';
      const updated = await store.setAnswer(found.m.mid, field, ans);
      if (!updated) bad('이미 답했어요');
      if (updated.aAnswer === 'yes' && updated.bAnswer === 'yes') {
        for (const x of [u, found.other]) await notify(x, '[산타가 이어줄게] 서로 수락했어요! 🎄', `상대방도 수락했어요. ${cfg.siteUrl} 에서 연락처를 확인해 보세요.`).catch(console.error);
      } else if (ans === 'yes' && !updated[field === 'aAnswer' ? 'bAnswer' : 'aAnswer']) {
        await notify(found.other, '[산타가 이어줄게] 상대가 답을 기다리고 있어요 💌', `${cfg.siteUrl} 에서 매칭 결과를 확인하고 답해 주세요. 기한: 발표 후 ${ANSWER_HOURS}시간`).catch(console.error);
      }
      return { ok: true };
    },

    // 차단: 내 연락처를 상대에게서 숨기고 자동으로 신고 접수
    'POST /api/result/block': async (ctx) => {
      const u = await needUser(ctx);
      const s = await store.getSettings();
      const found = await matchOf(u, s);
      if (!found) bad('매칭이 없어요', 404);
      await store.setMatchField(found.m.mid, found.m.aId === u.id ? 'aBlock' : 'bBlock', true);
      await store.putReport({ reporterId: u.id, targetId: found.m.aId === u.id ? found.m.bId : found.m.aId, reason: '[차단] ' + String(ctx.body.reason || '').slice(0, 500), createdAt: new Date().toISOString() });
      return { ok: true };
    },

    'POST /api/report': async (ctx) => {
      const u = await needUser(ctx);
      const s = await store.getSettings();
      const found = await matchOf(u, s);
      if (!found) bad('매칭이 없어요', 404);
      await store.putReport({ reporterId: u.id, targetId: found.m.aId === u.id ? found.m.bId : found.m.aId, reason: String(ctx.body.reason || '').slice(0, 500), createdAt: new Date().toISOString() });
      return { ok: true };
    },

    // ---------- 관리자 ----------
    'POST /api/admin/login': async ({ body, ip }) => {
      if (!cfg.adminPassword) bad('ADMIN_PASSWORD가 설정되지 않았어요', 500);
      if ((await store.hit('admin-fail', 900, 0)) >= 10) bad('로그인 실패가 많아서 15분 동안 잠겼어요', 429);
      const a = Buffer.from(sha(String(body.password || ''))), b = Buffer.from(sha(cfg.adminPassword));
      if (!crypto.timingSafeEqual(a, b)) { await store.hit('admin-fail', 900); console.warn('admin login fail', ip); bad('비밀번호가 틀렸어요', 401); }
      return { ok: true, __adminCookie: session.sign({ admin: true, exp: Date.now() + 12 * 36e5 }, cfg.secret) };
    },
    'GET /api/admin/stats': async (ctx) => {
      needAdmin(ctx);
      const s = await store.getSettings();
      const users = await store.listApplicants();
      const matches = s.runId ? await store.listMatches(s.runId) : [];
      const group = (f) => Object.entries(users.reduce((acc, u) => ((acc[f(u)] = (acc[f(u)] || 0) + 1), acc), {})).map(([k, c]) => ({ k, c })).sort((a, b) => b.c - a.c);
      const reports = await store.listReports();
      const byId = Object.fromEntries(users.map((u) => [u.id, u]));
      return {
        phase: s.phase, closeAt: s.closeAt, announceAt: s.announceAt, announcedAt: s.announcedAt, total: users.length,
        byGender: group((u) => `${u.gender}→${u.want_gender}`), byCampus: group((u) => (INFO[u.dept] || {}).campus || '?'), byDept: group((u) => u.dept),
        matches: matches.length, accepted: matches.filter((m) => m.aAnswer === 'yes' && m.bAnswer === 'yes').length,
        answered: matches.reduce((n, m) => n + (m.aAnswer ? 1 : 0) + (m.bAnswer ? 1 : 0), 0),
        reports: reports.slice(0, 100).map((r) => ({ ...r, targetName: byId[r.targetId]?.name || '(탈퇴/미신청)', targetEmail: byId[r.targetId]?.email || '' })),
      };
    },
    // 사진 검수 + 제재용 신청자 목록
    'GET /api/admin/users': async (ctx) => {
      needAdmin(ctx);
      const users = await store.listApplicants();
      const reports = await store.listReports();
      const rc = reports.reduce((acc, r) => ((acc[r.targetId] = (acc[r.targetId] || 0) + 1), acc), {});
      return users.map((u) => ({ id: u.id, name: u.name, email: u.email, dept: u.dept, gender: u.gender, student_no: u.student_no, birth: u.birth, instagram: u.instagram, blocked: !!u.blocked, reports: rc[u.id] || 0 }))
        .sort((a, b) => b.reports - a.reports);
    },
    'POST /api/admin/ban': async (ctx) => {
      needAdmin(ctx);
      const u = await store.getUser(String(ctx.body.id || ''));
      if (!u) bad('없는 사용자예요', 404);
      await store.putUser({ ...u, blocked: !!ctx.body.banned });
      return { ok: true };
    },
    'POST /api/admin/phase': async (ctx) => {
      needAdmin(ctx);
      const s = await store.getSettings();
      const { phase, announceAt, closeAt } = ctx.body;
      if (phase) {
        if (!['open', 'closed', 'announced'].includes(phase)) bad('phase 값이 이상해요');
        if (s.phase === 'announced') bad('이미 발표했어요. 되돌릴 수 없어요');
        if (phase === 'announced' && !s.runId) bad('먼저 매칭을 확정하세요');
        s.phase = phase;
        if (phase === 'announced') s.announcedAt = new Date().toISOString();
      }
      for (const [k, v] of Object.entries({ announceAt, closeAt })) if (v) { if (isNaN(Date.parse(v))) bad('날짜 형식이 이상해요'); s[k] = v; }
      await store.putSettings(s);
      if (phase === 'announced') await enqueue({ type: 'announce-mail' });
      return { ok: true };
    },
    // 리마인드 메일 지금 보내기 (원래는 마감 하루 전 저녁에 자동)
    'POST /api/admin/remind': async (ctx) => {
      needAdmin(ctx);
      const s = await store.getSettings();
      if (s.phase !== 'announced') bad('발표 후에만 보낼 수 있어요');
      if (s.reminderSent) bad('리마인드 메일은 이미 보냈어요');
      await enqueue({ type: 'reminders', force: true });
      return { ok: true };
    },
    'POST /api/admin/match': async (ctx) => {
      needAdmin(ctx);
      const s = await store.getSettings();
      if (s.phase === 'open') bad('먼저 신청을 마감하세요');
      if (s.phase === 'announced') bad('이미 발표했어요');
      const users = await store.listApplicants();
      const pairs = runMatching(users);
      if (ctx.body.commit) {
        const runId = Date.now().toString(36);
        const matches = pairs.map((p, i) => ({ mid: `${runId}-${i}`, runId, aId: p.a.id, bId: p.b.id, score: p.score }));
        await store.putMatches(matches);
        // 사용자마다 이번 매칭 결과를 기록 (발표 전 재실행하면 runId가 바뀌어 이전 결과는 무시됨)
        const midOf = {};
        for (const m of matches) { midOf[m.aId] = m.mid; midOf[m.bId] = m.mid; }
        for (const u of users) await store.putUser({ ...u, match: midOf[u.id] ? { runId, mid: midOf[u.id] } : null });
        s.runId = runId;
        await store.putSettings(s);
      }
      return {
        committed: !!ctx.body.commit, applicants: users.length, matched: pairs.length * 2, unmatched: users.length - pairs.length * 2,
        pairs: pairs.map((p) => ({ a: `${p.a.name} (${p.a.dept})`, b: `${p.b.name} (${p.b.dept})`, score: p.score })),
      };
    },
  };

  // 여러 명에게 같은 내용: 숨은참조(BCC) 50명씩 묶어서 발송 (지메일 발송 횟수 절약)
  async function bulk(users, subject, text) {
    const addrs = [...new Set(users.flatMap((u) => [u.email, u.notify_email]).filter(Boolean))];
    for (let i = 0; i < addrs.length; i += 50) await mail(null, subject, text, { bcc: addrs.slice(i, i + 50) }).catch((e) => console.error('bulk mail fail', e.message));
    return addrs.length;
  }

  // 응답 후에 이어서 처리하는 작업 (Vercel waitUntil / 크론)
  async function runJob(job) {
    if (job.type === 'announce-mail') {
      const users = await store.listApplicants();
      const n = await bulk(users, '[산타가 이어줄게] 매칭 결과가 나왔어요 🎁', `${cfg.siteUrl} 에 들어가서 결과를 확인해 보세요!\n답변 기한은 발표 후 ${ANSWER_HOURS}시간이에요.`);
      console.log('announce mails sent:', n);
      return { sent: n };
    }
    // 답변 마감 24시간 전쯤 아직 답 안 한 사람에게 한 번 더 (크론이 하루 한 번 호출, 한 번만 발송)
    if (job.type === 'reminders') {
      const s = await store.getSettings();
      const deadline = answerDeadline(s);
      if (s.phase !== 'announced' || !deadline || s.reminderSent) return { sent: 0 };
      const left = Date.parse(deadline) - Date.now();
      if (!job.force && (left > 25 * 36e5 || left <= 0)) return { sent: 0 };
      s.reminderSent = new Date().toISOString();
      await store.putSettings(s);
      const waitingForMe = [], notYet = [];
      for (const m of await store.listMatches(s.runId)) {
        if (m.aBlock || m.bBlock) continue;
        const [a, b] = [await store.getUser(m.aId), await store.getUser(m.bId)];
        if (!a || !b || a.blocked || b.blocked) continue;
        for (const [me, mine, theirs] of [[a, m.aAnswer, m.bAnswer], [b, m.bAnswer, m.aAnswer]]) {
          if (mine || theirs === 'no') continue;
          (theirs === 'yes' ? waitingForMe : notYet).push(me);
        }
      }
      const tail = `\n${cfg.siteUrl} 에서 확인하고 답해 주세요. 기한이 지나면 매칭이 끝나요.`;
      await bulk(waitingForMe, '[산타가 이어줄게] 상대가 기다리고 있어요! 마감 24시간 전 ⏰', '상대는 이미 "만나볼래요"를 눌렀어요! 💌' + tail);
      await bulk(notYet, '[산타가 이어줄게] 답변 마감까지 24시간 남았어요 ⏰', '아직 매칭 결과에 답하지 않았어요.' + tail);
      const sent = waitingForMe.length + notYet.length;
      console.log('reminder mails sent:', sent);
      return { sent };
    }
  }

  // ---------- 도우미 ----------
  async function needUser(ctx) {
    if (!ctx.session.uid) bad('로그인이 필요해요', 401);
    const u = await store.getUser(ctx.session.uid);
    if (!u) bad('로그인이 필요해요', 401);
    return u;
  }
  function needAdmin(ctx) { if (!ctx.session?.admin) bad('관리자 로그인이 필요해요', 401); }
  async function matchOf(u, s) {
    if (!u.match || u.match.runId !== s.runId) return null;
    const m = await store.getMatch(u.match.mid);
    if (!m) return null;
    const isA = m.aId === u.id;
    const other = await store.getUser(isA ? m.bId : m.aId);
    return { m, other, mine: isA ? m.aAnswer : m.bAnswer, theirs: isA ? m.bAnswer : m.aAnswer };
  }
  function selfView(u) {
    return {
      id: u.id, email: u.email, name: u.name, gender: u.gender, want_gender: u.want_gender, dept: u.dept, allow_same_dept: !!u.allow_same_dept, same_campus: !!u.same_campus, student_no: u.student_no,
      birth: u.birth, mbti: u.mbti, intro: u.intro, instagram: u.instagram, notify_email: u.notify_email || '', likes: u.likes || [], xmas: u.xmas || [], excludeCount: u.excludeCount || 0, applied: !!u.applied,
      college: (INFO[u.dept] || {}).college,
    };
  }
  function validate(b, u) {
    const str = (v) => (typeof v === 'string' ? v : '');
    if (str(b.name).trim().length < 2 || str(b.name).trim().length > 20) bad('이름을 확인해 주세요', 400, 'name');
    if (!['M', 'F'].includes(b.gender)) bad('성별을 골라주세요', 400, 'gender');
    if (!['M', 'F', 'A'].includes(b.want_gender)) bad('원하는 상대 성별을 골라주세요', 400, 'want_gender');
    if (!INFO[b.dept]) bad('학과를 목록에서 골라주세요', 400, 'dept');
    if (!/^\d{2}$/.test(str(b.student_no))) bad('학번은 두 자리로 입력해 주세요 (예: 23)', 400, 'student_no');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(b.birth)) || isNaN(Date.parse(b.birth))) bad('생년월일을 확인해 주세요', 400, 'birth');
    const year = Number(b.birth.slice(0, 4));
    // 청소년보호법 기준: 만 19세가 되는 해의 1월 1일부터 신청 가능
    if (year > new Date().getFullYear() - 19) bad('19세가 되는 해부터 신청할 수 있어요', 400, 'birth');
    if (year < new Date().getFullYear() - 40) bad('생년월일을 확인해 주세요', 400, 'birth');
    if (!/^[EI][NS][TF][JP]$/i.test(str(b.mbti))) bad('MBTI를 골라주세요', 400, 'mbti');
    const pick = (arr, list, max) => Array.isArray(arr) && arr.length <= max && arr.every((x) => list.includes(x)) && new Set(arr).size === arr.length;
    if (!pick(b.likes, TASTES.LIKES, TASTES.MAX_LIKES) || !b.likes.length) bad(`좋아하는 것을 1~${TASTES.MAX_LIKES}개 골라주세요`, 400, 'likes');
    if (!pick(b.xmas, TASTES.XMAS, TASTES.MAX_XMAS) || !b.xmas.length) bad(`크리스마스에 하고 싶은 것을 1~${TASTES.MAX_XMAS}개 골라주세요`, 400, 'xmas');
    if (b.notify_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(b.notify_email))) bad('알림 받을 메일 주소를 확인해 주세요', 400, 'notify_email');
    if (!normInsta(b.instagram)) bad('인스타 아이디를 확인해 주세요 (영문, 숫자, 마침표, 밑줄)', 400, 'instagram');
    if (b.agree_collect !== true) bad('개인정보 수집·이용에 동의해 주세요', 400, 'agree_collect');
    if (b.agree_share !== true) bad('매칭 상대에게 정보 제공하는 데 동의해 주세요', 400, 'agree_share');
  }

  // ---------- 라우터 ----------
  const table = Object.entries(routes).map(([key, fn]) => {
    const [method, pattern] = key.split(' ');
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
    return { method, re, names, fn };
  });

  // req: { method, path, cookies: {name: value}, body: object, ip }
  async function handle(req) {
    const cookieOut = (v, name = 'sid', days = SESSION_DAYS) => `${name}=${v}; Path=/; HttpOnly; SameSite=Lax${cfg.secureCookie ? '; Secure' : ''}; Max-Age=${v ? days * 86400 : 0}`;
    try {
      for (const r of table) {
        if (r.method !== req.method) continue;
        const mm = r.re.exec(req.path);
        if (!mm) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(mm[i + 1])]));
        // 사용자 세션(sid)과 관리자 세션(adm)은 쿠키를 따로 씀
        const userSess = session.verify(req.cookies?.sid, cfg.secret);
        const adminSess = session.verify(req.cookies?.adm, cfg.secret);
        const ctx = { ...req, params, body: req.body || {}, session: { uid: userSess?.uid, admin: !!adminSess?.admin } };
        const out = await r.fn(ctx);
        if (out && out.__redirect) return { status: 302, headers: { Location: out.__redirect, 'Cache-Control': 'no-store' } };
        const cookies = [];
        if (out && !Array.isArray(out) && '__cookie' in out) { cookies.push(cookieOut(out.__cookie)); delete out.__cookie; }
        if (out && !Array.isArray(out) && '__adminCookie' in out) { cookies.push(cookieOut(out.__adminCookie, 'adm', 0.5)); delete out.__adminCookie; }
        return { status: 200, json: out, cookies };
      }
      return { status: 404, json: { error: '없는 주소예요' } };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, json: { error: e.message, field: e.field } };
      console.error(e);
      return { status: 500, json: { error: '서버 오류가 났어요' } };
    }
  }
  handle.runJob = runJob;
  return handle;
}

module.exports = { createApp, uidOf };
