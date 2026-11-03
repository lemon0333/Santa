// 데이터 저장소: Upstash Redis(운영, Vercel) / 메모리(로컬 개발·테스트) 두 구현이 같은 인터페이스를 가짐.

const DEFAULT_SETTINGS = { phase: 'open', closeAt: '2026-11-17T23:59:00+09:00', announceAt: '2026-11-20T20:00:00+09:00', runId: null, announcedAt: null };

function strip(item) {
  if (!item) return null;
  const { pk, sk, ttl, ...rest } = item;
  return rest;
}

// ---------------- Upstash Redis (Vercel 운영) ----------------
// 키: settings / code:<email> / user:<id> + users(집합) / match:<mid> + matches:<runId>(집합)
//     ans:<mid>:<field> (답변·차단, 답변은 NX로 한 번만) / reports(리스트) / rl:<key>:<bucket>
function redisStore(redis) {
  const J = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
  const S = (v) => JSON.stringify(v);
  const ANS = ['aAnswer', 'bAnswer', 'aBlock', 'bBlock'];
  async function withAnswers(m) {
    if (!m) return null;
    const vals = await redis.mget(...ANS.map((f) => `ans:${m.mid}:${f}`));
    ANS.forEach((f, i) => { if (vals[i] != null) m[f] = f.endsWith('Block') ? vals[i] === true || vals[i] === 'true' || vals[i] === 1 || vals[i] === '1' : String(vals[i]); });
    return m;
  }
  return {
    async getSettings() { return { ...DEFAULT_SETTINGS, ...J(await redis.get('settings')) }; },
    async putSettings(s) { await redis.set('settings', S(s)); },

    async getCode(email) { return J(await redis.get('code:' + email)); },
    async putCode(email, c) { await redis.set('code:' + email, S(c), { ex: 3600 }); },
    async deleteCode(email) { await redis.del('code:' + email); },
    async incCodeAttempts(email) {
      const c = J(await redis.get('code:' + email));
      if (c) { c.attempts = (c.attempts || 0) + 1; await redis.set('code:' + email, S(c), { ex: 3600 }); }
    },

    async getUser(id) { return J(await redis.get('user:' + id)); },
    async putUser(u) { await redis.set('user:' + u.id, S(u)); await redis.sadd('users', u.id); },
    async createUserIfMissing(u) {
      const ok = await redis.set('user:' + u.id, S(u), { nx: true });
      if (ok) await redis.sadd('users', u.id);
    },
    async deleteUser(id) { await redis.del('user:' + id); await redis.srem('users', id); },
    async listApplicants() {
      const ids = await redis.smembers('users');
      if (!ids.length) return [];
      const out = [];
      for (let i = 0; i < ids.length; i += 200) out.push(...(await redis.mget(...ids.slice(i, i + 200).map((id) => 'user:' + id))).map(J));
      return out.filter((u) => u && u.applied);
    },

    async getMatch(mid) { return withAnswers(J(await redis.get('match:' + mid))); },
    async putMatches(list) {
      for (const m of list) { await redis.set('match:' + m.mid, S(m)); await redis.sadd('matches:' + m.runId, m.mid); }
    },
    async listMatches(runId) {
      const mids = await redis.smembers('matches:' + runId);
      if (!mids.length) return [];
      const ms = (await redis.mget(...mids.map((x) => 'match:' + x))).map(J).filter(Boolean);
      return Promise.all(ms.map(withAnswers));
    },
    // 아직 답하지 않았을 때만 기록 (NX라서 동시에 눌러도 한 번만)
    async setAnswer(mid, field, answer) {
      if (!(await redis.get('match:' + mid))) return null;
      const ok = await redis.set(`ans:${mid}:${field}`, answer, { nx: true });
      return ok ? this.getMatch(mid) : null;
    },
    async setMatchField(mid, field, value) { await redis.set(`ans:${mid}:${field}`, String(value)); },

    async putReport(r) { await redis.lpush('reports', S(r)); },
    async listReports() { return (await redis.lrange('reports', 0, 499)).map(J); },
    async hit(key, windowSec, by = 1) {
      const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
      const n = await redis.incrby(k, by);
      if (n === by) await redis.expire(k, windowSec * 2);
      return n;
    },
  };
}

// ---------------- 메모리 (로컬 개발용) ----------------
function memoryStore() {
  const m = new Map();
  const k = (pk, sk) => pk + '|' + sk;
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
  const byPrefix = (p) => [...m.entries()].filter(([key]) => key.startsWith(p)).map(([, v]) => clone(v));
  return {
    _dump: () => m,
    async getSettings() { return { ...DEFAULT_SETTINGS, ...clone(m.get(k('SETTINGS', 'S'))) }; },
    async putSettings(s) { m.set(k('SETTINGS', 'S'), clone(s)); },
    async getCode(e) { return clone(m.get(k('CODE#' + e, 'C'))) || null; },
    async putCode(e, c) { m.set(k('CODE#' + e, 'C'), clone(c)); },
    async deleteCode(e) { m.delete(k('CODE#' + e, 'C')); },
    async incCodeAttempts(e) { const c = m.get(k('CODE#' + e, 'C')); if (c) c.attempts = (c.attempts || 0) + 1; },
    async getUser(id) { return clone(m.get(k('USER#' + id, 'P'))) || null; },
    async putUser(u) { m.set(k('USER#' + u.id, 'P'), clone(u)); },
    async createUserIfMissing(u) { if (!m.has(k('USER#' + u.id, 'P'))) m.set(k('USER#' + u.id, 'P'), clone(u)); },
    async deleteUser(id) { m.delete(k('USER#' + id, 'P')); },
    async listApplicants() { return byPrefix('USER#').filter((u) => u.applied); },
    async getMatch(mid) { return clone(m.get(k('MATCH#' + mid, 'M'))) || null; },
    async putMatches(list) { for (const x of list) m.set(k('MATCH#' + x.mid, 'M'), clone(x)); },
    async listMatches(runId) { return byPrefix('MATCH#').filter((x) => x.runId === runId); },
    async setAnswer(mid, field, answer) {
      const x = m.get(k('MATCH#' + mid, 'M'));
      if (!x || x[field]) return null;
      x[field] = answer; return clone(x);
    },
    async putReport(r) { m.set(k(`REPORT#${Date.now()}-${Math.random()}`, 'R'), clone(r)); },
    async setMatchField(mid, field, value) { const x = m.get(k('MATCH#' + mid, 'M')); if (x) x[field] = value; },
    async hit(key, windowSec, by = 1) {
      const kk = k(`RL#${key}#${Math.floor(Date.now() / 1000 / windowSec)}`, 'R');
      const x = m.get(kk) || { n: 0 }; x.n += by; m.set(kk, x); return x.n;
    },
    async listReports() { return byPrefix('REPORT#').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
  };
}

module.exports = { redisStore, memoryStore };
