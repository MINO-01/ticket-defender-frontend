# Ticket Defender Frontend

Ticket Defender의 관리자 화면과 팬 제보 화면을 위한 React 프런트엔드입니다.

## 개발 환경

Node.js 22.13 이상(22.x), 24.x 또는 26 이상과 npm을 사용합니다.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
```

관리자 화면은 `/app/overview`, 팬 제보 화면은 `/fan/guide`에서 시작합니다. 관리자 화면은 공통 레이아웃과 라우팅 미리보기이며, 팬 제보 화면은 Backend W02 팬 제보 접수와 접수 상태 조회 API에 연결됩니다. 관리자 화면은 인증된 관리자 세션에서만 열립니다. 운영 인증 제공자는 미확정이며, 캡스톤 격리 Keycloak 설정이 있을 때만 관리자 로그인이 동작합니다(아래 관리자 인증 참고). 공식 PDF 발급도 비활성화 상태입니다.

FE-02 팬 제보 화면은 브라우저 메모리에서 입력과 JPEG·PNG 첨부파일을 유지하고, 제출 전 확인까지만 지원합니다. 현재 프런트엔드에서는 첨부 없이도 확인 단계로 이동할 수 있습니다. 이는 임시 UI 정책이며 최종 접수 계약은 아닙니다. 후속 Backend 계약에서는 이미지 없는 제보의 일반 검토 접수 가능 여부를 검토하고, 이미지가 없을 때 VLM 분석을 자동 실행하지 않도록 정해야 합니다. 첨부 필수 여부와 증거 충분성 판단은 별도 정책으로 확정해야 합니다.

## 팬 제보 접수 API 연동

팬 제보 화면은 `POST /api/v1/fan-reports`(multipart)와 `POST /api/v1/fan-reports/lookup`(JSON)을 동일 출처로 호출합니다. 계약은 Backend `docs/api/fan-report-intake-v1.yaml`을 따릅니다.

- Backend의 팬 제보 접수는 기본 비활성입니다. 격리된 합성 데이터 환경에서만 활성화해 검증합니다.
- Backend에는 공개 공연 목록 API가 없습니다. 그래서 실제 접수 공연은 `VITE_FAN_REPORT_EVENT_ID`에 서버에 등록된 공연 UUID를 명시적으로 넣는 방식으로만 제공합니다. 값이 없거나 UUID 형식이 아니면 실제 제출 버튼이 비활성화되고 시연용 공연만 표시됩니다. 공연의 활성 여부와 제보 허용 여부는 Backend가 최종 검증합니다.
- 시연용 공연 `DEMO_AUTUMN_LIVE`는 실제 접수 API로 전송하지 않습니다.
- 개발 서버에서는 `TD_DEV_API_PROXY_TARGET`을 설정하면 `/api` 요청을 로컬 Backend로 전달합니다. 운영 CORS 정책은 변경하지 않습니다.
- `Idempotency-Key`(UUID v4)와 `Report-Recovery-Secret`(32바이트 난수, Base64url 43자)은 첫 제출 때 브라우저 Web Crypto로 생성해 현재 탭의 메모리에만 보관합니다. 응답 유실이나 결과 불명확 상태에서는 같은 키, 비밀, 입력, 파일 순서로 재전송합니다. 새로고침하거나 탭을 닫으면 재시도 정보가 사라져 복구할 수 없습니다.
- 복구 비밀, 조회 코드, 입력 내용은 URL, 로그, localStorage, sessionStorage에 기록하지 않습니다.

설정 예시는 `.env.example`을 참고합니다.

## 관리자 인증과 공통 API 클라이언트

Backend는 Spring Security OAuth2 Resource Server로 외부 발급자의 RS256 JWT를 검증합니다(`ticket-defender.security.admin.issuer`, `jwk-set-uri`, `audience`, HTTPS 필수). subject로 관리자를 식별하고, tenant/event 접근과 역할은 서버의 `AdminAccessService`가 판단합니다. 범위 밖 자원은 404, 역할 부족은 403입니다. Backend에는 로그인이나 JWT 발급 API가 없습니다.

### 현재 상태

- 운영 인증 제공자(OIDC 또는 기업 SSO)는 미확정입니다. 캡스톤 합성 데이터 검증에는 격리 Keycloak과 공식 `keycloak-js` SDK로 Authorization Code + PKCE(S256) 로그인을 연결했습니다(`docs/keycloak/README.md`). 이는 운영 제공자 선정이 아닙니다.
- `VITE_ADMIN_AUTH_PROVIDER=keycloak`과 올바른 HTTPS realm issuer가 있을 때만 로그인합니다. 설정이 없거나 잘못되었거나 제공자가 비어 있으면 로그인을 제공하지 않고 관리자 화면을 차단합니다. 가짜 로그인, 임의 JWT 발급, 클라이언트 측 역할 부여는 하지 않습니다.
- 다른 제공자가 확정되면 같은 `AdminAuthAdapter` 인터페이스로 어댑터를 추가합니다. 인증 SDK는 관리자 보호 라우트가 처음 열릴 때만 초기화해 팬 제보 화면에서는 인증 서버에 접속하지 않습니다.
- `/app` 아래 모든 화면은 `RequireAdminAuth`로 보호됩니다. 인증 전에는 관리자 레이아웃과 업무 화면을 렌더링하지 않습니다.
- 액세스 토큰은 현재 탭 메모리(ref)에만 보관합니다. URL, 로그, localStorage, sessionStorage에 저장하지 않으며 새로고침하면 다시 로그인해야 합니다. 만료 30초 전부터는 토큰을 사용하지 않고, 만료 시각이 지나거나 서버가 401을 반환하면 세션을 정리하고 재인증 화면을 표시합니다.
- `VITE_ADMIN_DEMO_PREVIEW=true`는 `npm run dev`에서만 기존 합성 데이터 관리자 화면을 보여 주는 미리보기입니다. 인증 세션이 아니며 관리자 API에 토큰을 보내지 않고, 운영 빌드에서는 무시됩니다. demoData는 실제 업무 데이터가 아닙니다.

### API 클라이언트 사용 계약

인증 컨텍스트 안의 화면에서는 `useAdminApiClient()`를 사용합니다.

```ts
const client = useAdminApiClient()
const result = await client.request('/api/v1/cases/{caseId}', { schema: caseSchema })
```

- 동일 출처 `/api/v1/...` 상대 경로만 허용합니다. 다른 출처, 공개 팬 제보 API(`/api/v1/fan-reports`), Track 1 반입 API(`/api/v1/audits/analyze`), `..` 경로는 요청 전에 예외로 막습니다.
- 유효한 토큰이 있을 때만 `Authorization: Bearer`를 붙입니다. 쿠키는 보내지 않고(`credentials: 'omit'`), 리다이렉트를 따라가지 않습니다.
- 결과는 `success`(zod 검증 통과), `unauthenticated`(세션 없음 또는 401, 세션 정리), `forbidden`(403), `notFound`(404, 존재하지 않음과 범위 밖을 구분하지 않음), `problem`(그 밖의 오류와 problem code), `network`, `invalidResponse`로 구분합니다. 실패를 빈 목록으로 바꾸지 않습니다.
- tenant/event 범위는 클라이언트가 확정하지 않습니다. 요청 범위를 좁히는 값만 보낼 수 있고 최종 판단은 서버가 합니다.
- 팬 제보 공개 API는 이 클라이언트를 쓰지 않고 기존 `fanReportApi`로 무인증 호출합니다.

### 백엔드 인증 연결 확인

`/app/settings`의 점검 패널은 입력한 공연 UUID로 기존 `GET /api/v1/admin/fan-reports`를 호출해 인증과 membership 권한 결과(성공 건수, 401, 403, 404)만 표시합니다. 제보 내용은 표시하지 않습니다.

### Backend 연동에 필요한 설정

- Frontend: `VITE_ADMIN_AUTH_PROVIDER`, `VITE_ADMIN_AUTH_ISSUER`, `VITE_ADMIN_AUTH_CLIENT_ID`, `VITE_ADMIN_AUTH_AUDIENCE`(공개 값만), 개발 서버 프록시 `TD_DEV_API_PROXY_TARGET`
- Backend: 같은 발급자의 `ticket-defender.security.admin.issuer`, `jwk-set-uri`, `audience`와 관리자 membership 데이터
- 운영 CORS 정책은 변경하지 않으며 동일 출처 배포 또는 개발 서버 프록시를 전제로 합니다.

스타일은 `src/styles/tokens.css`의 CSS Custom Properties와 컴포넌트별 CSS Modules로 구성합니다. 브라우저에는 공개 가능한 설정만 전달해야 합니다.
