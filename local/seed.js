// 테스트용 가짜 신청자
const DEPTS = require('../lib/departments');
const { uidOf } = require('../lib/app');
const T = require('../lib/tastes');
exports.seed = async (store, n) => {
  const names = ['민준', '서연', '도윤', '지우', '하준', '서윤', '시우', '하은', '주원', '지유', '예준', '수아'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < n; i++) {
    const email = `test${i}@khu.ac.kr`, g = i % 2 ? 'F' : 'M';
    const y = 1999 + Math.floor(Math.random() * 7);
    await store.putUser({
      id: uidOf(email), email, name: '테스트' + pick(names), gender: g, want_gender: g === 'M' ? 'F' : 'M', dept: pick(DEPTS.slice(0, 12)),
      student_no: String(y - 1981).padStart(2, '0'), birth: `${y}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`,
      mbti: pick(['E', 'I']) + pick(['N', 'S']) + pick(['T', 'F']) + pick(['J', 'P']), intro: '테스트 계정이에요', instagram: 'test_insta_' + i, likes: [...T.LIKES].sort(() => Math.random() - 0.5).slice(0, 3), xmas: [...T.XMAS].sort(() => Math.random() - 0.5).slice(0, 2), applied: true, exclude: [],
    });
  }
  console.log(`가짜 신청자 ${n}명 추가`);
};
