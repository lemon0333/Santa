// 궁합 계산 (재미용!)
const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const STEM_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const ZODIAC = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
const ELEMENTS = ['나무', '불', '흙', '쇠', '물'];
const ELEMENT_DESC = {
  나무: '곧게 자라는 성장형',
  불: '열정적이고 밝은 분위기 메이커',
  흙: '든든하고 포용력 있는 타입',
  쇠: '단단하고 결단력 있는 타입',
  물: '유연하고 생각이 깊은 타입',
};

function dayPillar(birth) {
  // 1900-01-01 = 甲戌 (60갑자 인덱스 10)
  const [y, m, d] = birth.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 1)) / 86400000);
  const idx = (((10 + days) % 60) + 60) % 60;
  return { stem: idx % 10, branch: idx % 12 };
}

function saju(birth) {
  const y = Number(birth.slice(0, 4));
  const dp = dayPillar(birth);
  const element = ELEMENTS[Math.floor(dp.stem / 2)];
  const yearBranch = (((y - 4) % 12) + 12) % 12; // 입춘 무시 (재미용)
  return {
    ilju: STEMS[dp.stem] + BRANCHES[dp.branch],
    stemHanja: STEM_HANJA[dp.stem],
    element,
    elementDesc: ELEMENT_DESC[element],
    elementIdx: Math.floor(dp.stem / 2),
    yearBranch,
    zodiac: ZODIAC[yearBranch],
  };
}

// 받침에 따라 조사 고르기: josa('물','와','과') -> '물과'
function josa(word, noFinal, withFinal) {
  const c = word.charCodeAt(word.length - 1);
  const has = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return word + (has ? withFinal : noFinal);
}

function sajuScore(a, b) {
  const A = saju(a), B = saju(b);
  let score, text;
  const diff = (B.elementIdx - A.elementIdx + 5) % 5;
  if (diff === 0) { score = 75; text = `둘 다 ${A.element} 기운이라 말 안 해도 통하는 사이`; }
  else if (diff === 1 || diff === 4) {
    score = 92;
    const [g, r] = diff === 1 ? [A, B] : [B, A];
    text = `${josa(g.element, '가', '이')} ${josa(r.element, '를', '을')} 살려주는 상생 궁합`;
  } else { score = 60; text = `${josa(A.element, '와', '과')} ${B.element}, 부딪히면서 더 끌리는 밀당 궁합`; }

  const zd = Math.abs(A.yearBranch - B.yearBranch);
  let zText = '';
  if (A.yearBranch % 4 === B.yearBranch % 4 && zd !== 0) { score += 8; zText = '띠 궁합도 삼합이라 찰떡'; }
  else if (zd === 6) { score -= 8; zText = '띠끼리는 충이라 티격태격'; }
  score = Math.max(0, Math.min(100, score));
  return { score, text, zodiacText: zText, a: A, b: B };
}

function mbtiScore(a, b) {
  if (!a || !b) return { score: 60, text: 'MBTI 정보가 부족해요' };
  let s = 15;
  const notes = [];
  if (a[1] === b[1]) { s += 30; notes.push(a[1] === 'N' ? '상상력 대화가 끝이 없음' : '현실 감각이 잘 맞음'); }
  if (a[0] !== b[0]) { s += 20; notes.push('E와 I가 서로 균형을 맞춤'); } else s += 8;
  if (a[2] !== b[2]) { s += 15; notes.push('T와 F가 서로 부족한 부분을 채움'); } else s += 8;
  if (a[3] !== b[3]) { s += 20; notes.push('계획러와 즉흥러의 조합'); } else s += 10;
  return { score: Math.min(100, s), text: notes.join(', ') || '비슷해서 편한 사이' };
}

function age(birth, now = new Date()) {
  const [y, m, d] = birth.split('-').map(Number);
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

// 겹치는 취향 (좋아하는 것 + 크리스마스에 하고 싶은 것)
function tasteScore(u, v) {
  const likes = (u.likes || []).filter((x) => (v.likes || []).includes(x));
  const xmas = (u.xmas || []).filter((x) => (v.xmas || []).includes(x));
  const n = likes.length + xmas.length * 1.5;
  const score = Math.min(100, Math.round(40 + n * 15));
  const text = likes.length || xmas.length
    ? [likes.length ? `둘 다 ${likes.map((x) => x.replace(/^\S+\s/, '')).join(', ')} 좋아해요` : '', xmas.length ? `크리스마스 계획도 겹쳐요 (${xmas.map((x) => x.replace(/^\S+\s/, '')).join(', ')})` : ''].filter(Boolean).join(' · ')
    : '취향이 달라서 서로 새로운 걸 알려줄 수 있는 사이';
  return { score, text, likes, xmas };
}

function compat(u, v) {
  const m = mbtiScore(u.mbti, v.mbti);
  const s = sajuScore(u.birth, v.birth);
  const t = tasteScore(u, v);
  const ageGap = Math.abs(Number(u.birth.slice(0, 4)) - Number(v.birth.slice(0, 4)));
  const ageScore = Math.max(0, 100 - ageGap * 15);
  const total = Math.round(m.score * 0.3 + s.score * 0.3 + t.score * 0.25 + ageScore * 0.15);
  return { total, mbti: m, saju: s, taste: t, ageScore };
}

// 상대에게 보여줄 때: 생일을 좁힐 수 있는 일주·띠·나이 정보는 빼고 풀이 문구만
function compatPublic(u, v) {
  const c = compat(u, v);
  return {
    total: c.total,
    mbti: c.mbti,
    taste: c.taste,
    saju: { score: c.saju.score, text: c.saju.text + (c.saju.zodiacText ? '. ' + c.saju.zodiacText : ''), myElement: c.saju.a.element, theirElement: c.saju.b.element },
    ageScore: c.ageScore,
  };
}

module.exports = { compat, compatPublic, saju, age, mbtiScore, sajuScore };
