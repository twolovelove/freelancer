# freelancer

키링 등 핸드메이드 작업을 하는 프리랜서를 위한 **작업 시간 기록 & 분석** 웹앱이에요. 모바일·PC에서 모두 쓸 수 있어요.

## 기능

- **시작 / 완료**: 분류를 고르고 시작하면 타이머가 돌아가요. 여러 작업을 **동시에** 진행할 수 있어요.
- **일시정지**: 쉬는 시간은 작업 시간에서 빠져요.
- **메모**: 진행 중에도, 완료 후에도 메모를 남길 수 있어요.
- **직접 추가 / 수정**: 깜빡하고 안 켠 작업도 나중에 넣거나 시간을 고칠 수 있어요.
- **통계 (일 / 주 / 월)**
  - 실제 작업 시간(동시 작업은 한 번만) vs 작업별 누적 시간
  - 시간대별·일별 추이 차트 (분류별 색상)
  - 분류별 시간과 **주간 목표 대비 남은 시간**
  - 지난 기간 대비 변화, 핵심 작업(제작) 비중, 집중 시간대 등 자동 분석
- **백업**: JSON 백업/복원, 엑셀용 CSV 내보내기

## 실행

빌드가 필요 없는 정적 사이트예요. `index.html`을 브라우저로 열거나 아래처럼 로컬 서버를 띄우면 돼요.

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## 데이터 저장 & 동기화

기록은 항상 이 기기의 브라우저(`localStorage`)에 먼저 저장돼요. Supabase를 연결하고 Google로 로그인하면 맥북·휴대폰 기록이 자동으로 합쳐져요. (앱을 열 때, 기록을 바꿀 때, 1분마다)

### Supabase + Google 로그인 설정 (처음 한 번)

1. **테이블 만들기**: Supabase 대시보드 → SQL Editor → [`supabase/schema.sql`](supabase/schema.sql) 붙여넣고 Run
2. **Google OAuth 클라이언트 만들기**: [Google Cloud Console](https://console.cloud.google.com/)
   - 새 프로젝트 → *API 및 서비스 → OAuth 동의 화면*: External, 앱 이름·이메일 입력, 테스트 사용자에 내 Gmail 추가
   - *사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID* → 유형 **웹 애플리케이션**
   - **승인된 리디렉션 URI**: `https://<프로젝트ID>.supabase.co/auth/v1/callback`
   - 만들어진 **클라이언트 ID / 보안 비밀** 복사
3. **Supabase에 Google 연결**: Authentication → Sign In / Providers → Google → 켜고 클라이언트 ID·보안 비밀 붙여넣기 → Save
4. **돌아올 주소 허용**: Authentication → URL Configuration
   - Site URL: `http://localhost:8000` (배포 후 Netlify 주소로 변경)
   - Redirect URLs: `http://localhost:8000/**`, 휴대폰 테스트용 `http://<맥 IP>:8000/**`, 배포 후 `https://<사이트>.netlify.app/**`
5. **[`config.js`](config.js)** 에 Project URL과 anon(public) 키 입력 (Project Settings → API). `service_role` 키는 절대 넣지 마세요.
6. 맥북·휴대폰에서 각각 **설정 → Google로 로그인**
7. 다 로그인했으면 Authentication → Sign In / Providers에서 **Allow new users to sign up** 끄기 (다른 사람이 계정을 못 만들게)

데이터는 행 단위 보안(RLS)으로 로그인한 본인만 읽고 쓸 수 있어요.

## 배포 (Netlify)

저장소를 Netlify에 연결하면 `netlify.toml` 설정대로 루트 폴더가 그대로 배포돼요. 빌드 명령은 필요 없어요.
배포 후 휴대폰에서 **홈 화면에 추가**하면 앱처럼 쓸 수 있어요.
