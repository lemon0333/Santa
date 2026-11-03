// 메일 발송: 지메일 SMTP(운영, 앱 비밀번호) / 콘솔 출력(로컬)
// opts.bcc 로 여러 명에게 한 번에 보낼 수 있음 (지메일은 하루 수신자 500명까지)
function gmailMailer(user, pass, fromName) {
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  return async (to, subject, text, opts = {}) => {
    await t.sendMail({ from: `"${fromName}" <${user}>`, to: to || user, bcc: opts.bcc, subject, text });
  };
}
const consoleMailer = () => async (to, subject, text, opts = {}) =>
  console.log(`[메일] to=${to || ''}${opts.bcc ? ` bcc=${opts.bcc.length}명` : ''} | ${subject} | ${text.replace(/\n/g, ' / ')}`);
module.exports = { gmailMailer, consoleMailer };
