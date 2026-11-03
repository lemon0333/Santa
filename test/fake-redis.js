// 테스트용 가짜 Redis: Upstash 클라이언트(automaticDeserialization:false)와 같은 모양으로 문자열만 저장
function fakeRedis() {
  const kv = new Map(), sets = new Map(), lists = new Map();
  const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  return {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async set(k, v, o = {}) { if (o.nx && kv.has(k)) return null; kv.set(k, str(v)); return 'OK'; },
    async mget(...ks) { return ks.map((k) => (kv.has(k) ? kv.get(k) : null)); },
    async del(k) { return kv.delete(k) ? 1 : 0; },
    async sadd(k, ...m) { const s = sets.get(k) || new Set(); m.forEach((x) => s.add(String(x))); sets.set(k, s); return m.length; },
    async srem(k, ...m) { const s = sets.get(k); if (s) m.forEach((x) => s.delete(String(x))); return 1; },
    async smembers(k) { return [...(sets.get(k) || [])]; },
    async incrby(k, by) { const n = Number(kv.get(k) || 0) + by; kv.set(k, String(n)); return n; },
    async expire() { return 1; },
    async lpush(k, ...v) { const l = lists.get(k) || []; l.unshift(...v.map(str)); lists.set(k, l); return l.length; },
    async lrange(k, a, b) { return (lists.get(k) || []).slice(a, b + 1); },
  };
}
module.exports = { fakeRedis };
