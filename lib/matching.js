// 매칭 알고리즘
// 목표 1: 최대한 많은 사람을 짝지어 주기 / 목표 2: 그 안에서 궁합 점수 높이기
const { compat } = require('./compat');
const { INFO } = require('./departments');

function canPair(u, v) {
  if (u.id === v.id) return false;
  // 같은 과: 둘 다 '같은 과도 괜찮아요'를 골랐을 때만 매칭 ('기타'는 학과를 모르니 허용)
  if (u.dept && u.dept === v.dept && u.dept !== '기타' && !(u.allow_same_dept && v.allow_same_dept)) return false;
  const campus = (x) => (INFO[x.dept] || {}).campus;
  if ((u.same_campus || v.same_campus) && (!campus(u) || campus(u) !== campus(v))) return false; // 같은 캠퍼스만 원하는 경우
  const wants = (x, y) => x.want_gender === 'A' || x.want_gender === y.gender;
  if (!wants(u, v) || !wants(v, u)) return false;
  if ((u.exclude || []).includes(v.id) || (v.exclude || []).includes(u.id)) return false; // 지인 제외 (양방향)
  if (u.blocked || v.blocked) return false;
  return true;
}

function runMatching(users, rand = Math.random) {
  const n = users.length;
  const adj = Array.from({ length: n }, () => new Map()); // i -> Map(j -> score)
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (canPair(users[i], users[j])) {
        const s = compat(users[i], users[j]).total + rand() * 0.9; // 소수점 랜덤은 동점 깨기용 (표시 점수는 정수 부분만)
        adj[i].set(j, s); adj[j].set(i, s);
      }

  const mate = new Array(n).fill(-1);
  // 1단계: 후보가 적은 사람부터, 남은 후보 중 궁합 제일 좋은 사람과 짝짓기
  const order = [...Array(n).keys()].sort((a, b) => adj[a].size - adj[b].size);
  for (const i of order) {
    if (mate[i] !== -1) continue;
    let best = -1, bestS = -1;
    for (const [j, s] of adj[i]) if (mate[j] === -1 && s > bestS) { best = j; bestS = s; }
    if (best !== -1) { mate[i] = best; mate[best] = i; }
  }
  // 2단계: 남은 사람을 위해 짝을 바꿔서 한 쌍 더 만들 수 있으면 바꿈 (증가 경로 탐색)
  let improved = true;
  while (improved) {
    improved = false;
    for (let u = 0; u < n; u++) {
      if (mate[u] !== -1) continue;
      if (augment(u, adj, mate)) improved = true;
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (mate[i] > i) out.push({ a: users[i], b: users[mate[i]], score: Math.floor(adj[i].get(mate[i])) });
  return out.sort((x, y) => y.score - x.score);
}

// 짝 없는 u에서 시작하는 교대 경로를 BFS로 찾아 뒤집음 (일반 그래프라 블로섬은 생략, 대부분 경우 충분)
function augment(root, adj, mate) {
  const parent = new Map([[root, -1]]);
  const queue = [root];
  const visitedOuter = new Set([root]);
  while (queue.length) {
    const u = queue.shift();
    for (const v of adj[u].keys()) {
      if (parent.has(v) || v === root) continue;
      parent.set(v, u);
      if (mate[v] === -1) {
        // 경로 뒤집기: v - u - mate[u] - ... - root
        let x = v, y = u;
        while (y !== -1) {
          const next = mate[y];
          mate[x] = y; mate[y] = x;
          x = next; y = x === -1 ? -1 : parent.get(x);
        }
        return true;
      }
      const w = mate[v];
      if (!visitedOuter.has(w)) { visitedOuter.add(w); parent.set(w, v); queue.push(w); }
    }
  }
  return false;
}

module.exports = { runMatching, canPair };
