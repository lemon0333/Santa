// 서버에 세션 저장 없이 HMAC 서명 쿠키로 로그인 상태 유지
const crypto = require('crypto');
// base64url (브라우저 체험판의 Buffer 폴리필과도 호환되게 직접 변환)
const toUrl = (b64s) => b64s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl = (u) => u.replace(/-/g, '+').replace(/_/g, '/');
const b64 = (s) => toUrl(Buffer.from(s).toString('base64'));
function sign(payload, secret) {
  const body = b64(JSON.stringify(payload));
  const mac = toUrl(crypto.createHmac('sha256', secret).update(body).digest('base64'));
  return body + '.' + mac;
}
function verify(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = toUrl(crypto.createHmac('sha256', secret).update(body).digest('base64'));
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(fromUrl(body), 'base64').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
module.exports = { sign, verify };
