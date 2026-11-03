// Vercel Cron이 하루 한 번(한국 시간 밤 8시) 호출: 답변 마감 24시간 전이면 리마인드 메일 발송
const { getApp } = require('../../lib/vercel-app');

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const result = await getApp().runJob({ type: 'reminders' });
  res.json(result || {});
};
