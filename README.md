# 🎅 산타가 이어줄게

경희대 학생만 참여하는 크리스마스 시즌 블라인드 매칭 웹사이트.
Vercel(서버리스 함수 + 정적 파일) + Upstash Redis(저장소) + Gmail(메일 발송)로 돌아가요.

- 신청 마감: 2026-11-17 23:59 (KST)
- 결과 발표: 2026-11-20 20:00 (KST)
- 답변 마감: 발표 후 48시간, 마감 24시간 전에 리마인드 메일

## 폴더 구조

```
api/index.js            모든 /api/* 요청을 받는 Vercel 함수 (vercel.json rewrite)
api/cron/reminders.js   매일 20:00 KST 실행되는 리마인드 메일 크론
lib/                    핵심 로직 (라우터, 매칭, 궁합, 세션, 저장소, 메일)
public/                 화면 (index.html, admin.html, privacy.html, app.js, style.css)
local/                  로컬 개발 서버 + 가짜 신청자 데이터
test/                   흐름 테스트 (메모리 저장소 / 가짜 Redis 둘 다)
```

## 로컬에서 보기

```bash
npm install
npm run dev        # http://localhost:3000 , 관리자 /admin.html (비번 admin)
npm test
```

로컬에서는 메일 대신 터미널에 인증 코드가 찍혀요. 가짜 신청자 30명이 자동으로 들어가요(`SEED=0`이면 없음).

## 배포 (Vercel)

1. **Gmail 앱 비밀번호 만들기**
   - https://myaccount.google.com/security 에서 2단계 인증 켜기
   - https://myaccount.google.com/apppasswords 에서 앱 이름 `santa`로 만들기 → 16자리 비밀번호 복사
2. **Vercel에 가져오기**: https://vercel.com/new → 이 GitHub 레포 Import → Framework Preset은 `Other`, 나머지는 기본값
   - 프로젝트 이름이 주소가 돼요. 예: `santa-khu` → `https://santa-khu.vercel.app`
3. **Redis 붙이기**: 프로젝트 → Storage → Marketplace에서 **Upstash (Redis)** → Create → 지역은 `ap-northeast-1 (Tokyo)` → 프로젝트에 Connect
   - `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경변수가 자동으로 들어가요
4. **환경변수 넣기**: 프로젝트 → Settings → Environment Variables

   | 이름 | 값 |
   |---|---|
   | `SESSION_SECRET` | 아무 긴 랜덤 문자열 (40자 이상) |
   | `ADMIN_PASSWORD` | 관리자 페이지 비밀번호 |
   | `GMAIL_USER` | 보내는 Gmail 주소 |
   | `GMAIL_APP_PASSWORD` | 1번에서 만든 16자리 |
   | `CRON_SECRET` | 아무 랜덤 문자열 (Vercel 크론이 자동으로 씀) |
   | `UMAMI_WEBSITE_ID` (선택) | Umami 방문자 통계 Website ID |
   | `UMAMI_SCRIPT_URL` (선택) | 직접 설치한 Umami면 `https://내umami주소/script.js`, Umami Cloud면 비움 |
   | `SITE_URL` (선택) | 메일에 들어갈 주소, 비우면 vercel.app 주소 사용 |

   랜덤 문자열은 터미널에서 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. **Redeploy**: 환경변수를 넣은 뒤 Deployments → 최신 배포 → Redeploy
6. **확인**: 사이트에서 본인 @khu.ac.kr 메일로 인증 코드가 오는지, `/admin.html` 로그인이 되는지

## 운영 순서 (관리자 페이지)

① 신청 받기 → ② 신청 마감(11/17 밤) → ③ 미리보기 → 매칭 확정 → ④ 결과 발표(11/20 20:00, 전원에게 메일)

발표하면 단계가 잠겨요. 리마인드 메일은 크론이 자동으로 보내고, 관리자 페이지에서 수동으로도 보낼 수 있어요.

## 알아둘 점

- Gmail 개인 계정은 **하루 약 500명**까지 보낼 수 있어요. 단체 메일은 50명씩 숨은참조(BCC)로 묶어서 보내요. 신청자가 500명을 넘으면 발표 메일이 이틀에 나눠 나갈 수 있으니 그때는 다른 메일 서비스로 바꾸는 게 좋아요.
- Vercel Hobby 플랜 크론은 하루 한 번이라 리마인드는 매일 20:00 KST에 확인해요(발표가 목요일 20시라 금요일 20시 = 마감 24시간 전에 정확히 나가요).
- `SESSION_SECRET`은 한번 정하면 시즌 중에 바꾸지 마세요. 사용자 ID가 이 값으로 만들어져서, 바꾸면 기존 신청자가 전부 새 사람으로 인식돼요.
- 커스텀 Umami를 쓰면 `vercel.json`의 Content-Security-Policy에 그 주소를 추가해야 해요.
- 비밀번호·키는 절대 코드에 넣지 말고 Vercel 환경변수에만 넣으세요.
- 모든 정보는 2026-11-23에 일괄 삭제 (Upstash 콘솔에서 데이터베이스 삭제).
