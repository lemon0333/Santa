// ---------- 눈 내리기 ----------
(() => {
  const c = document.getElementById('snow'), x = c.getContext('2d');
  let w, h, flakes;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() {
    w = c.width = innerWidth; h = c.height = innerHeight;
    flakes = Array.from({ length: reduce ? 0 : Math.min(120, Math.floor(w / 8)) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 2.2 + .6, s: Math.random() * .6 + .3, d: Math.random() * 2 * Math.PI }));
  }
  function tick() {
    x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.85)';
    for (const f of flakes) {
      f.y += f.s; f.d += .01; f.x += Math.sin(f.d) * .4;
      if (f.y > h) { f.y = -5; f.x = Math.random() * w; }
      x.beginPath(); x.arc(f.x, f.y, f.r, 0, 7); x.fill();
    }
    requestAnimationFrame(tick);
  }
  addEventListener('resize', size); size(); tick();
})();

// ---------- 유틸 ----------
const $ = (s) => document.querySelector(s);
const VIEWS = ['intro', 'login', 'apply', 'done', 'closed', 'result', 'nomatch'];
function show(v) { VIEWS.forEach((n) => $('#v-' + n).classList.toggle('hidden', n !== v)); scrollTo({ top: 0, behavior: 'smooth' }); }
async function api(url, opts = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || '오류가 났어요'), { status: r.status, field: data.field });
  return data;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시${d.getMinutes() ? ' ' + d.getMinutes() + '분' : ''}`; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

let CONFIG, ME;
const ELEMENT_EMOJI = { 나무: '🌲', 불: '🔥', 흙: '⛰️', 쇠: '⚔️', 물: '🌊' };

// ---------- 카운트다운: 신청 중엔 마감까지, 마감 후엔 발표까지 ----------
let cdTimer;
function startCountdown() {
  clearInterval(cdTimer);
  const { phase } = CONFIG;
  if (phase === 'announced') { $('#countdown').classList.add('hidden'); $('#count-note').textContent = '🎉 매칭 결과가 발표됐어요!'; return; }
  const targetIso = phase === 'open' ? CONFIG.closeAt : CONFIG.announceAt;
  const target = new Date(targetIso).getTime();
  const label = phase === 'open' ? `신청 마감까지 · ${fmtDate(targetIso)}` : `매칭 발표까지 · ${fmtDate(targetIso)}`;
  const set = (id, v) => ($(id).textContent = String(v).padStart(2, '0'));
  function step() {
    const diff = target - Date.now();
    if (diff <= 0) {
      $('#countdown').classList.add('hidden');
      $('#count-note').innerHTML = phase === 'open' ? '<div class="coming">곧 신청이 마감돼요 ⏰</div>' : '<div class="coming">곧 공개돼요! 🎁 잠시만요</div>';
      clearInterval(cdTimer);
      if (phase === 'closed') setTimeout(() => location.reload(), 60_000); // 발표 전환을 기다리며 1분마다 새로고침
      return;
    }
    set('#cd-d', Math.floor(diff / 864e5)); set('#cd-h', Math.floor(diff / 36e5) % 24);
    set('#cd-m', Math.floor(diff / 6e4) % 60); set('#cd-s', Math.floor(diff / 1e3) % 60);
  }
  $('#count-note').textContent = label;
  step(); cdTimer = setInterval(step, 1000);
}

// ---------- 화면 결정 ----------
async function route() {
  try { CONFIG = await api('/api/config'); }
  catch (e) {
    $('#count-note').textContent = '';
    const box = document.createElement('section'); box.className = 'card';
    box.innerHTML = '<h2>🛠 잠깐 점검 중이에요</h2><p class="sub"></p>';
    box.querySelector('.sub').textContent = '서버에 연결하지 못했어요. 잠시 후 새로고침해 주세요. (' + e.message + ')';
    document.querySelector('.wrap').appendChild(box); return;
  }
  try { ME = await api('/api/me'); } catch { ME = null; }
  $('#foot-auth').classList.toggle('hidden', !ME);
  if (ME) $('#foot-email').textContent = ME.email;
  document.querySelectorAll('.retention').forEach((el) => (el.textContent = CONFIG.retentionDate));
  $('#applicant-count').textContent = CONFIG.applicants >= 10 ? `지금까지 ${CONFIG.applicants}명이 신청했어요 🔥` : '친구들보다 먼저 신청해 보세요!';
  startCountdown();

  const { phase } = CONFIG;
  if (!ME) {
    $('#go-login').textContent = phase === 'announced' ? '로그인하고 결과 보기' : phase === 'open' ? '학교 메일로 시작하기' : '로그인해서 신청 상태 보기';
    return show('intro');
  }
  if (phase === 'open') {
    if (ME.applied) return showDone(true);
    fillForm(); return show('apply');
  }
  if (phase === 'closed') {
    if (ME.applied) return showDone(false);
    $('#closed-title').textContent = '신청이 마감됐어요';
    $('#closed-msg').textContent = '이번 시즌은 신청이 끝났어요. 다음 시즌에 꼭 신청해 주세요!';
    return show('closed');
  }
  const r = await api('/api/result');
  if (!r.matched) {
    if (!r.applied) { $('#closed-title').textContent = '이번 시즌이 끝났어요'; $('#closed-msg').textContent = '다음 시즌에 꼭 신청해 주세요!'; return show('closed'); }
    return show('nomatch');
  }
  if (r.partnerGone) {
    $('#closed-title').textContent = '매칭이 취소됐어요';
    $('#closed-msg').textContent = '상대가 탈퇴했거나 운영 정책에 따라 매칭이 취소됐어요. 미안해요. 다음 시즌엔 꼭 좋은 인연이 있길 바라요 🎄';
    return show('closed');
  }
  renderResult(r);
  show('result');
}

// ---------- 로그인 ----------
$('#go-login').onclick = () => show('login');
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => show(b.dataset.back)));
$('#send-code').onclick = async () => {
  $('#login-err').textContent = '';
  let email = $('#email').value.trim();
  if (email && !email.includes('@')) { email += '@' + CONFIG.emailDomain; $('#email').value = email; }
  $('#send-code').disabled = true;
  try {
    const r = await post('/api/auth/request', { email });
    $('#code-area').classList.remove('hidden');
    $('#send-code').textContent = '코드 다시 받기';
    if (r.devCode) $('#code').value = r.devCode; // 로컬 개발 모드에서만
    $('#code').focus();
  } catch (e) { $('#login-err').textContent = e.message; }
  setTimeout(() => ($('#send-code').disabled = false), 3000);
};
$('#verify-code').onclick = async () => {
  $('#login-err').textContent = '';
  try { await post('/api/auth/verify', { email: $('#email').value.trim(), code: $('#code').value }); route(); }
  catch (e) { $('#login-err').textContent = e.message; }
};
$('#code').addEventListener('keydown', (e) => e.key === 'Enter' && $('#verify-code').click());
$('#email').addEventListener('keydown', (e) => e.key === 'Enter' && $('#send-code').click());

// ---------- 신청서 ----------
function renderChips(id, list, selected) {
  const box = $('#' + id), max = Number(box.dataset.max);
  box.innerHTML = list.map((t) => `<button type="button" class="chip" aria-pressed="${selected.includes(t)}">${esc(t)}</button>`).join('');
  const sync = () => {
    const on = box.querySelectorAll('[aria-pressed="true"]').length;
    box.querySelectorAll('.chip').forEach((c) => (c.disabled = c.getAttribute('aria-pressed') !== 'true' && on >= max));
    $('#' + id + '-count').textContent = `(${on}/${max})`;
  };
  box.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); sync(); }));
  sync();
}
const chipValues = (id) => [...document.querySelectorAll(`#${id} [aria-pressed="true"]`)].map((c) => c.textContent);

function fillForm() {
  const sel = $('#dept');
  if (sel.options.length <= 1) {
    for (const [campus, colleges] of Object.entries(CONFIG.departments))
      for (const [college, depts] of Object.entries(colleges)) {
        const g = document.createElement('optgroup'); g.label = `${campus}캠 · ${college}`;
        depts.forEach((d) => g.appendChild(new Option(d, d))); sel.appendChild(g);
      }
    sel.add(new Option('기타', '기타'));
  }
  renderChips('likes', CONFIG.tastes.LIKES, ME.likes || []);
  renderChips('xmas', CONFIG.tastes.XMAS, ME.xmas || []);
  const f = $('#apply-form');
  $('#apply-title').textContent = ME.applied ? '프로필 수정' : '프로필 작성';
  $('#apply-btn').textContent = ME.applied ? '수정 완료' : '신청하기 🎁';
  if (!ME.applied) return;
  sel.value = ME.dept || '';
  f.same_campus.checked = !!ME.same_campus;
  f.student_no.value = ME.student_no || ''; f.birth.value = ME.birth || '';
  f.intro.value = ME.intro || ''; f.instagram.value = ME.instagram || ''; f.notify_email.value = ME.notify_email || '';
  if (ME.excludeCount) f.exclude_emails.placeholder = `지금 ${ME.excludeCount}명을 제외 중이에요. 비워 두면 그대로 유지되고, 새로 적으면 새 목록으로 바뀌어요`;
  const check = (name, v) => { const el = f.querySelector(`input[name=${name}][value="${v}"]`); if (el) el.checked = true; };
  check('gender', ME.gender); check('want_gender', ME.want_gender); check('same_dept', ME.allow_same_dept ? 'ok' : 'no');
  (ME.mbti || '').split('').forEach((ch, i) => check('m' + i, ch));
}
// 오류가 난 칸을 한꺼번에 표시
const FIELD_EL = { instagram: '.insta', likes: '#likes', xmas: '#xmas', gender: '#g-m', want_gender: '#w-m', dept: '#dept', student_no: '#student_no', birth: '#birth', mbti: '.mbti', agree_collect: '#agree_collect', agree_share: '#agree_share' };
function fieldEl(field) {
  const el = $(FIELD_EL[field] || '#' + field); if (!el) return null;
  if (el.type === 'radio') return el.closest('.seg');
  if (el.type === 'checkbox') return el.closest('.check');
  return el;
}
function markErrors(errs) {
  document.querySelectorAll('.field-err').forEach((el) => el.classList.remove('field-err'));
  errs.forEach(([field]) => fieldEl(field)?.classList.add('field-err'));
  $('#apply-err').innerHTML = errs.length ? `아래 항목을 확인해 주세요<ul>${errs.map(([, m]) => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
  if (errs.length) fieldEl(errs[0][0])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function collect(f) {
  const val = (n) => (f.querySelector(`input[name=${n}]:checked`) || {}).value || '';
  const mbti = [0, 1, 2, 3].map((i) => val('m' + i)).join('');
  return {
    gender: val('gender'), want_gender: val('want_gender'), dept: f.dept.value, same_dept: val('same_dept') || 'no', same_campus: f.same_campus.checked,
    student_no: f.student_no.value ? String(f.student_no.value).padStart(2, '0') : '', birth: f.birth.value,
    mbti: mbti.length === 4 ? mbti : '', intro: f.intro.value, instagram: f.instagram.value.trim(), notify_email: f.notify_email.value.trim(), likes: chipValues('likes'), xmas: chipValues('xmas'), exclude_emails: f.exclude_emails.value,
    agree_collect: f.agree_collect.checked, agree_share: f.agree_share.checked,
  };
}
function clientCheck(b, f) {
  const e = [];
  if (!b.gender) e.push(['gender', '성별을 골라주세요']);
  if (!b.want_gender) e.push(['want_gender', '만나고 싶은 상대를 골라주세요']);
  if (b.same_campus && !b.dept) e.push(['dept', '같은 캠퍼스만 원하면 학과를 골라주세요']);
  if (!/^\d{2}$/.test(b.student_no)) e.push(['student_no', '학번 두 자리를 적어주세요']);
  if (!b.birth) e.push(['birth', '생년월일을 골라주세요']);
  if (!b.mbti) e.push(['mbti', 'MBTI 네 글자를 모두 골라주세요']);
  if (!b.likes.length) e.push(['likes', '좋아하는 것을 하나 이상 골라주세요']);
  if (!b.xmas.length) e.push(['xmas', '크리스마스에 하고 싶은 것을 하나 이상 골라주세요']);
  if (!/^@?[A-Za-z0-9._]{1,30}$/.test(b.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, ''))) e.push(['instagram', '인스타 아이디를 적어주세요 (영문, 숫자, 마침표, 밑줄)']);
  if (!b.agree_collect) e.push(['agree_collect', '개인정보 수집·이용에 동의해 주세요']);
  if (!b.agree_share) e.push(['agree_share', '매칭 상대 정보 제공에 동의해 주세요']);
  return e;
}
$('#apply-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, body = collect(f);
  const errs = clientCheck(body, f);
  markErrors(errs);
  if (errs.length) return;
  $('#apply-btn').disabled = true;
  try {
    await post('/api/apply', body); await route();
  } catch (err) { markErrors([[err.field || '', err.message]]); }
  $('#apply-btn').disabled = false;
};

// ---------- 신청 완료 ----------
function showDone(editable) {
  $('#edit-btn').parentElement.classList.toggle('hidden', !editable);
  $('#done-msg').innerHTML = editable
    ? `${fmtDate(CONFIG.announceAt)}에 메일로 결과를 알려드릴게요.<br>마감 전까지 프로필은 언제든 고칠 수 있어요.`
    : '신청이 마감됐어요. 지금 짝을 맞추는 중이니 발표일을 기다려 주세요!';
  if (CONFIG.ratio) {
    const { M, F } = CONFIG.ratio, tot = M + F || 1;
    const fewer = M < F ? '남자' : F < M ? '여자' : null;
    $('#ratio').innerHTML = `지금 신청 <b>${CONFIG.applicants}명</b> · 남 ${M} : 여 ${F}<div class="bar2"><i style="width:${(M / tot) * 100}%"></i><i style="width:${(F / tot) * 100}%"></i></div>${fewer ? `<span class="hint">${fewer} 친구를 데려오면 모두의 매칭 확률이 올라가요!</span>` : ''}`;
    $('#ratio').classList.remove('hidden');
  }
  const s = ME.saju;
  $('#my-saju').innerHTML = s ? `🔮 나는 <b>${s.ilju}일주(${s.stemHanja})</b>, <b>${s.element}</b> 기운이에요.<br>${s.elementDesc} · ${esc(ME.mbti)}` : '';
  $('#preview-card').innerHTML = `<div class="avatar sm el-${esc(s?.element || '')}">${ELEMENT_EMOJI[s?.element] || '🎁'}</div>
    <div><small>매칭 상대에게는 처음에 이렇게 보여요</small><br><b>${esc([ME.college, ME.mbti].filter(Boolean).join(' · '))}</b><br><small>학과, 학번, 인스타는 서로 수락한 뒤에만 공개돼요 (이름은 받지 않아요)</small></div>`;
  // 캘린더: 발표 시각부터 1시간
  const start = new Date(CONFIG.announceAt), end = new Date(start.getTime() + 36e5);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const title = '🎅 산타가 이어줄게 결과 발표', detail = `매칭 결과 확인하기: ${location.origin}`;
  $('#gcal-btn').href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(detail)}`;
  $('#ics-btn').onclick = () => {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//santa-match//KO', 'BEGIN:VEVENT', `UID:announce-${fmt(start)}@santa-match`, `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${title}`, `DESCRIPTION:${detail}`, `URL:${location.origin}`,
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'santa-match.ics'; a.click();
  };
  show('done');
}
$('#edit-btn').onclick = () => { fillForm(); show('apply'); };
$('#cancel-btn').onclick = async () => {
  if (!confirm('신청을 취소할까요? 프로필은 남아 있어서 다시 신청할 수 있어요.')) return;
  try { await post('/api/apply/cancel'); route(); } catch (e) { alert(e.message); }
};
$('#share-btn').onclick = async () => {
  const data = { title: '산타가 이어줄게 🎅', text: '경희대생끼리 하는 크리스마스 매칭. 같이 신청하자!', url: location.origin };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(`${data.text}\n${data.url}`); $('#share-btn').textContent = '링크 복사됨! ✅'; }
  } catch {}
};

// 인스타 스토리용 사주 카드 (생일을 좁힐 수 있는 일주는 넣지 않고 오행·MBTI만)
$('#card-btn').onclick = async () => {
  const s = ME.saju; if (!s) return;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const x = c.getContext('2d');
  await document.fonts.load('80px Jua');
  const g = x.createLinearGradient(0, 0, 0, 1920); g.addColorStop(0, '#163b2c'); g.addColorStop(1, '#0b1f17');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  x.fillStyle = 'rgba(255,255,255,.7)';
  for (let i = 0; i < 160; i++) { x.beginPath(); x.arc(Math.random() * 1080, Math.random() * 1920, Math.random() * 5 + 1, 0, 7); x.fill(); }
  x.textAlign = 'center';
  x.fillStyle = '#fffaf2'; x.beginPath(); x.roundRect(90, 470, 900, 980, 48); x.fill();
  x.fillStyle = '#c8323c'; x.font = '64px Jua'; x.fillText('나의 크리스마스 사주', 540, 600);
  x.font = '220px serif'; x.fillText(ELEMENT_EMOJI[s.element] || '✨', 540, 870);
  x.fillStyle = '#2b1d14'; x.font = '110px Jua'; x.fillText(`${s.element} 기운 · ${ME.mbti}`, 540, 1050);
  x.fillStyle = '#7a6a5c'; x.font = '52px Jua'; x.fillText(s.elementDesc, 540, 1150);
  x.fillStyle = '#2f7a4f'; x.font = '48px Jua'; x.fillText('나랑 궁합 맞는 경희대생은 누굴까?', 540, 1330);
  x.fillStyle = '#fff'; x.font = '96px Jua'; x.fillText('🎅 산타가 이어줄게', 540, 300);
  x.font = '48px Jua'; x.fillStyle = '#d9e8df'; x.fillText(location.host, 540, 1640);
  c.toBlob(async (blob) => {
    const file = new File([blob], 'xmas-saju.png', { type: 'image/png' });
    try { if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: '나의 크리스마스 사주' }); } catch { return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'xmas-saju.png'; a.click();
  }, 'image/png');
};

// ---------- 결과: 점수 → 궁합 풀이 → 사진 순서로 공개 ----------
function renderResult(r) {
  const p = r.partner, c = r.compat;
  const item = (title, score, text) => `<div class="compat-item"><div class="t"><span>${title}</span><span>${score}점</span></div><div class="bar"><i style="width:${score}%"></i></div><p>${esc(text)}</p></div>`;
  const both = !!p.instagram;
  let action;
  if (r.blocked) action = `<div class="contact-box">${r.iBlocked ? '차단했어요. 상대는 더 이상 내 실명과 인스타를 볼 수 없어요.' : '이 매칭은 종료됐어요.'}</div>`;
  else if (!r.myAnswer && r.expired) action = `<div class="contact-box">답변 기한이 지났어요 ⛄</div>`;
  else if (!r.myAnswer) action = `<p class="sub" style="margin-top:18px">둘 다 수락하면 학과, 학번, 인스타가 공개돼요.<br>거절해도 상대에게 이유는 알려지지 않아요.</p>
      <div class="btn-row"><button class="btn ghost" data-ans="no">아쉽지만 패스</button><button class="btn" data-ans="yes">만나볼래요 💌</button></div>
      <div class="deadline">답변 기한: ${fmtDate(r.deadline)}</div>`;
  else if (r.myAnswer === 'no') action = `<div class="contact-box">패스했어요. 다음 시즌에 더 좋은 인연이 있길! 🎄</div>`;
  else if (both) action = `<div class="contact-box">🎉 서로 수락했어요!<br><a class="insta-link" href="https://instagram.com/${encodeURIComponent(p.instagram)}" target="_blank" rel="noopener">@${esc(p.instagram)}</a><br><span class="hint">먼저 DM 보내보세요. 메리 크리스마스!</span></div>
      <button class="link" id="block-btn">불쾌한 일이 있으면 차단하기</button>`;
  else if (r.theirAnswer === 'no') action = `<div class="contact-box">이번엔 인연이 아니었나 봐요. 다음 시즌에 더 좋은 짝이 있을 거예요 ⛄</div>`;
  else if (r.theirAnswer === 'expired') action = `<div class="contact-box">상대가 기한 안에 답하지 않았어요. 다음 시즌엔 꼭! ⛄</div>`;
  else action = `<div class="contact-box">💌 수락했어요! 상대의 답을 기다리는 중이에요.<br><span class="hint">상대도 수락하면 학교 메일로 알려드릴게요. 기한: ${fmtDate(r.deadline)}</span></div>`;

  const title = both ? '@' + esc(p.instagram) : '🎁 산타의 선물';
  const meta = esc((both ? [p.dept, p.student_no && p.student_no + '학번', p.mbti] : [p.college, p.mbti]).filter(Boolean).join(' · '));
  $('#partner').innerHTML = `
    <div class="stage s1"><div class="display" style="font-size:18px;color:var(--muted)">🎄 우리 둘의 궁합 점수는</div>
      <div class="score"><div class="big">${c.total}점</div></div></div>
    <div class="stage s2">
      ${item('MBTI 궁합', c.mbti.score, c.mbti.text)}
      ${item('취향 궁합', c.taste.score, c.taste.text)}
      ${item('사주 궁합', c.saju.score, c.saju.text)}
    </div>
    <div class="stage s3">
      <div class="display" style="font-size:18px;color:var(--muted);margin-top:22px">당신의 크리스마스 짝은</div>
      <div class="avatar el-${esc(p.element)}">${ELEMENT_EMOJI[p.element] || '🎁'}</div>
      <div class="name">${title}</div>
      <div class="meta">${meta}</div>
      ${p.intro ? `<div class="intro">${esc(p.intro)}</div>` : ''}
      <div class="tag-title">좋아하는 것</div><div class="tags">${p.likes.map((t) => `<span class="${(ME.likes || []).includes(t) ? 'same' : ''}">${esc(t)}</span>`).join('')}</div>
      <div class="tag-title">크리스마스에 하고 싶은 것</div><div class="tags">${p.xmas.map((t) => `<span class="${(ME.xmas || []).includes(t) ? 'same' : ''}">${esc(t)}</span>`).join('')}</div>
      ${action}
      <button class="link" id="report-btn" style="margin-top:12px">신고하기</button>
    </div>`;

  const gift = $('#gift');
  let opened = false; try { opened = sessionStorage.getItem('opened') === '1'; } catch {}
  const stages = ['.s1', '.s2', '.s3'].map((s) => $('#partner ' + s));
  async function reveal(fast) {
    gift.classList.add('open');
    try { sessionStorage.setItem('opened', '1'); } catch {}
    if (!fast) await sleep(650);
    $('#gift-wrap').classList.add('hidden'); $('#partner').classList.remove('hidden');
    for (const st of stages) { st.classList.add('on'); if (!fast) await sleep(1300); }
  }
  gift.onclick = () => reveal(false);
  if (opened || r.myAnswer) reveal(true);

  $('#partner').querySelectorAll('[data-ans]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.ans === 'no' && !confirm('정말 패스할까요? 되돌릴 수 없어요.')) return;
    try { await post('/api/result/answer', { answer: b.dataset.ans }); route(); } catch (e) { alert(e.message); }
  }));
  $('#report-btn').onclick = async () => {
    const reason = prompt('신고 사유를 적어주세요 (운영자만 볼 수 있어요)');
    if (!reason) return;
    try { await post('/api/report', { reason }); alert('신고가 접수됐어요. 운영자가 확인할게요.'); } catch (e) { alert(e.message); }
  };
  const bb = $('#block-btn');
  if (bb) bb.onclick = async () => {
    if (!confirm('차단하면 상대는 더 이상 내 실명과 인스타를 볼 수 없고, 운영자에게 자동으로 신고돼요. 진행할까요?')) return;
    const reason = prompt('무슨 일이 있었는지 적어주시면 운영자가 확인할게요 (선택)') || '';
    try { await post('/api/result/block', { reason }); route(); } catch (e) { alert(e.message); }
  };
}

// ---------- 계정 ----------
$('#logout').onclick = async () => { await post('/api/auth/logout'); location.reload(); };
$('#delete-account').onclick = async () => {
  if (!confirm('탈퇴하면 프로필, 사진, 매칭 기록이 모두 바로 삭제돼요. 진행할까요?')) return;
  await post('/api/account/delete'); location.reload();
};

route().catch((e) => { console.error(e); alert('서버에 연결할 수 없어요'); });
