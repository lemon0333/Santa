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
async function loadUsers() {
  const r = await fetch('/api/admin/users'); if (!r.ok) return;
  const users = await r.json();
  $('#users').innerHTML = users.map((u) => `<div style="border:1px solid var(--line);border-radius:12px;padding:8px;font-size:12px;background:${u.blocked ? '#fde8e8' : '#fff'}">
    <b>@${esc(u.instagram)}</b> ${u.gender === 'M' ? '남' : '여'} · ${esc(u.student_no)}학번<br>${esc(u.dept || '학과 미선택')}<br>${esc(u.email)}<br>생일 ${esc(u.birth)}<br>
    신고 <b style="color:${u.reports ? 'var(--red)' : 'inherit'}">${u.reports}</b>
    <button class="btn ${u.blocked ? 'green' : 'ghost'}" style="padding:8px;margin-top:6px;font-size:13px" data-ban="${u.id}" data-to="${u.blocked ? '' : '1'}">${u.blocked ? '제재 해제' : '제재'}</button></div>`).join('') || '신청자가 없어요';
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
load();
