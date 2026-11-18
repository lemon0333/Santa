// 관리자 페이지 스크립트 (CSP 때문에 인라인 대신 별도 파일)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || '오류'); return d;
}
const P = { open: '신청 중', closed: '마감 (매칭 준비)', announced: '발표됨' };
async function load() {
  const r = await fetch('/api/admin/stats'); if (!r.ok) return;
  const s = await r.json();
  $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden');
  $('#phase').textContent = P[s.phase]; $('#announce').value = s.announceAt; $('#close').value = s.closeAt;
  $('#stats').innerHTML = `
    <p>총 신청 <b>${s.total}</b>명 · 매칭 <b>${s.matches}</b>쌍 · 답변 ${s.answered}건 · 서로 수락 <b>${s.accepted}</b>쌍</p>
    <h3>성별 → 원하는 상대</h3><table>${s.byGender.map((g) => `<tr><td>${g.k.replace('M', '남').replace('F', '여').replace('A', '상관없음')}</td><td>${g.c}</td></tr>`).join('')}</table>
    <h3>캠퍼스</h3><table>${s.byCampus.map((d) => `<tr><td>${esc(d.k)}</td><td>${d.c}</td></tr>`).join('')}</table>
    <h3>학과별</h3><table>${s.byDept.map((d) => `<tr><td>${esc(d.k)}</td><td>${d.c}</td></tr>`).join('')}</table>
    <h3>신고 (${s.reports.length})</h3><table>${s.reports.map((x) => `<tr><td>${esc(x.createdAt?.slice(0, 16))}</td><td>${esc(x.targetName)}<br>${esc(x.targetEmail)}</td><td>${esc(x.reason)}</td></tr>`).join('') || '<tr><td>없음</td></tr>'}</table>`;
}
$('#login-btn').onclick = async () => { try { await post('/api/admin/login', { password: $('#pw').value }); load(); } catch (e) { $('#login-err').textContent = e.message; } };
document.querySelectorAll('[data-phase]').forEach((b) => (b.onclick = async () => {
  $('#phase-err').textContent = '';
  if (b.dataset.phase === 'announced' && !confirm('결과를 발표하고 전원에게 메일을 보낼까요?')) return;
  try { await post('/api/admin/phase', { phase: b.dataset.phase }); load(); } catch (e) { $('#phase-err').textContent = e.message; }
}));
$('#save-announce').onclick = async () => { try { await post('/api/admin/phase', { announceAt: $('#announce').value, closeAt: $('#close').value }); load(); } catch (e) { $('#phase-err').textContent = e.message; } };
// 신청자 목록: 엑셀식 표, 10명씩 페이지 나눔
const PAGE = 10;
let users = [], page = 0;
async function loadUsers() {
  const r = await fetch('/api/admin/users'); if (!r.ok) return;
  users = await r.json();
  renderUsers();
}
function renderUsers() {
  const pages = Math.max(1, Math.ceil(users.length / PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const start = page * PAGE, rows = users.slice(start, start + PAGE);
  $('#users').innerHTML = users.length ? `<table class="sheet">
    <thead><tr><th>#</th><th>닉네임</th><th>성별</th><th>학번</th><th>학과</th><th>이메일</th><th>생일</th><th>신고</th><th>제재</th></tr></thead>
    <tbody>${rows.map((u, i) => `<tr class="${u.blocked ? 'banned' : ''}">
      <td class="num">${start + i + 1}</td><td><b>${esc(u.handle)}</b></td><td>${u.gender === 'M' ? '남' : '여'}</td><td>${esc(u.student_no)}</td>
      <td>${esc(u.dept || '학과 미선택')}</td><td>${esc(u.email)}</td><td>${esc(u.birth)}</td>
      <td class="num"><b style="color:${u.reports ? 'var(--red)' : 'inherit'}">${u.reports}</b></td>
      <td><button class="btn ${u.blocked ? 'green' : 'ghost'}" data-ban="${u.id}" data-to="${u.blocked ? '' : '1'}">${u.blocked ? '제재 해제' : '제재'}</button></td></tr>`).join('')}</tbody></table>` : '신청자가 없어요';
  $('#users').scrollTop = 0;
  $('#users-pager').innerHTML = users.length > PAGE ? `
    <button class="btn ghost" data-go="0" ${page === 0 ? 'disabled' : ''}>«</button>
    <button class="btn ghost" data-go="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹ 이전</button>
    <span>${page + 1} / ${pages} 페이지 · 총 ${users.length}명</span>
    <button class="btn ghost" data-go="${page + 1}" ${page === pages - 1 ? 'disabled' : ''}>다음 ›</button>
    <button class="btn ghost" data-go="${pages - 1}" ${page === pages - 1 ? 'disabled' : ''}>»</button>` : (users.length ? `<span>총 ${users.length}명</span>` : '');
  $('#users-pager').querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { page = Number(b.dataset.go); renderUsers(); }));
  $('#users').querySelectorAll('[data-ban]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.to && !confirm('이 사람을 제재할까요?')) return;
    await post('/api/admin/ban', { id: b.dataset.ban, banned: !!b.dataset.to }); loadUsers();
  }));
}
$('#load-users').onclick = loadUsers;
$('#remind-btn').onclick = async () => { $('#phase-err').textContent = ''; try { await post('/api/admin/remind'); $('#phase-err').textContent = '리마인드 메일을 보내는 중이에요'; } catch (e) { $('#phase-err').textContent = e.message; } };
async function match(commit) {
  $('#match-err').textContent = '';
  try {
    const r = await post('/api/admin/match', { commit });
    $('#match-out').innerHTML = `<p>${commit ? '✅ 확정됨' : '미리보기'} · 신청 ${r.applicants}명 중 ${r.matched}명 매칭, ${r.unmatched}명 미매칭</p>
      <table><tr><th>A</th><th>B</th><th>점수</th></tr>${r.pairs.map((p) => `<tr><td>${esc(p.a)}</td><td>${esc(p.b)}</td><td>${p.score}</td></tr>`).join('')}</table>`;
    load();
  } catch (e) { $('#match-err').textContent = e.message; }
}
$('#preview').onclick = () => match(false);
$('#commit').onclick = () => confirm('매칭을 확정할까요?') && match(true);
// ---------- 보안 · IP 차단 ----------
const T = { 'rate-limit': '요청 제한', 'code-fail': '코드 틀림', 'admin-login-fail': '관리자 로그인 실패', csrf: '외부 사이트 요청' };
async function loadSec() {
  $('#sec-err').textContent = '';
  const r = await fetch('/api/admin/security'); if (!r.ok) return;
  const d = await r.json();
  const blockBtn = (ip, on) => `<button class="btn ${on ? 'green' : 'ghost'}" style="padding:6px 10px;font-size:12px;width:auto" data-ip="${esc(ip)}" data-on="${on ? '' : '1'}">${on ? '해제' : '차단'}</button>`;
  $('#sec').innerHTML = `<p>내 IP: <b>${esc(d.myIp)}</b> (이 IP는 차단되지 않아요)</p>
    <h3>차단 중 (${d.blockedIps.length})</h3><table>${d.blockedIps.map((b) => `<tr><td>${esc(b.ip)}</td><td>${esc(b.note || '')}</td><td>${esc(b.at.slice(0, 16))}</td><td>${blockBtn(b.ip, true)}</td></tr>`).join('') || '<tr><td>없음</td></tr>'}</table>
    <h3>의심 IP (24시간)</h3><table><tr><th>IP</th><th>횟수</th><th>종류</th><th>시도한 메일</th><th></th></tr>${d.topIps.map((x) => `<tr><td>${esc(x.ip)}</td><td><b>${x.count}</b></td><td>${Object.entries(x.types).map(([k, v]) => `${esc(T[k] || k)} ${v}`).join('<br>')}</td><td>${x.emails.map(esc).join('<br>')}</td><td>${x.ip === d.myIp ? '나' : blockBtn(x.ip, x.blocked)}</td></tr>`).join('') || '<tr><td colspan="5">없음</td></tr>'}</table>
    <h3>최근 기록</h3><table>${d.events.slice(0, 100).map((e) => `<tr><td>${esc(new Date(e.t).toLocaleString('ko-KR'))}</td><td>${esc(e.ip)}</td><td>${esc(T[e.type] || e.type)}</td><td>${esc(e.email || '')}</td><td>${esc(e.path)}</td></tr>`).join('') || '<tr><td>없음</td></tr>'}</table>`;
  $('#sec').querySelectorAll('[data-ip]').forEach((b) => (b.onclick = () => setBlock(b.dataset.ip, !!b.dataset.on)));
}
async function setBlock(ip, block) {
  if (block && !confirm(ip + ' 를 차단할까요?')) return;
  try { await post('/api/admin/block-ip', { ip, block, note: '관리자 차단' }); loadSec(); } catch (e) { $('#sec-err').textContent = e.message; }
}
$('#load-sec').onclick = loadSec;
$('#block-btn').onclick = () => { const ip = $('#block-ip').value.trim(); if (ip) setBlock(ip, true); };
load();
