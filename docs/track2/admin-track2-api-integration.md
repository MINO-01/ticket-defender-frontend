# 관리자 Track 2 팬 제보 실제 API 연동 (Issue #23)

관리자 Track 2 화면(`/app/fan-reports`, `/app/fan-reports/:reportId`)을 Backend 조회 API에 연결한 내용입니다.
이번 범위는 조회 전용입니다. 분석 실행, 예매 후보 대조, 수동 교정, Case 생성, 승인과 공식 PDF 발급은 연결하지 않았습니다.

## 사용하는 API

계약 원문은 Backend `docs/api/admin-fan-report-read-v1.yaml`, `docs/api/track2-listing-analysis-v1.yaml`이며 Backend main `a1eb50c` 기준입니다.

| 화면 | 요청 | 비고 |
| --- | --- | --- |
| 공연 선택 | `GET /api/v1/admin/events?page&pageSize=100` | 기존 `AdminEventGate` 재사용 |
| 제보 목록 | `GET /api/v1/admin/fan-reports?eventId&page&pageSize=20[&intakeStatus]` | 서버가 확인한 접근 가능 공연 UUID만 사용 |
| 제보 상세 | `GET /api/v1/admin/fan-reports/{fanReportId}` | 주소의 제보 ID가 UUID일 때만 호출 |
| 분석 이력 | `GET /api/v1/admin/fan-reports/{fanReportId}/evidence/{evidenceId}/listing-analyses?page&pageSize=20` | 상세 응답의 `evidence[].evidenceId`만 사용 |

- 요청에는 `tenantId`, 역할, 멤버십 값을 넣지 않습니다. 접근 범위는 Backend가 JWT subject와 저장된 공연 소속으로 판단합니다.
- 분석 실행(`POST .../listing-analyses`)은 호출하지 않습니다.

## 코드 구성

| 파일 | 역할 |
| --- | --- |
| `src/features/admin-track2/track2Api.ts` | 실제 응답 Zod 스키마, 요청 경로, 주소 값 해석, 상태 문구 |
| `src/features/admin-track2/LiveFanReportListPage.tsx` | 실제 목록, 접수 상태 필터, 서버 페이지 이동 |
| `src/features/admin-track2/LiveFanReportDetailPage.tsx` | 실제 상세, 증거 메타데이터, 증거별 분석 이력 |
| `src/features/admin-track2/Track2Routes.tsx` | 인증 세션은 실제 화면, 개발 미리보기는 합성 데모 화면으로 분기 |

합성 데모 모델(`track2Model.ts`의 데이터셋 스키마)과 `demoTrack2Data`는 실제 응답 모델로 쓰지 않습니다. 실제 화면은 `reportTypeLabels` 문구만 함께 사용합니다.

## 화면에 표시하는 서버 필드

- 목록: `fanReportId`, `reportType`, `receivedAt`, `intakeStatus`, `storedEvidenceCount / evidenceCount`, `submittedPerformanceAt`(팬 입력, 검증된 회차 아님), `totalItems`, `page`, `hasNext`
- 상세: `event.name`, `reportType`, `intakeStatus`, `receivedAt`, `retentionUntil`, 팬 입력값(`submittedPerformanceAt`, `seatArea`, `platform`, `seller`, `askingPrice`, `listingUrl`, `description`)
- 증거: `evidenceId`, `mediaType`, `byteSize`, `storageStatus`, `originalStored`, `sha256`, `createdAt`
- 분석 시도: `createdAt`, `executionStatus`, `analysisStatus`, `modelName`, `modelVersion`, `analyzedAt`, 입력 SHA-256 확인 결과, 실패 시 `errorCode`, `analyzerErrorCode`, `analyzerHttpStatus`, `candidateMatch`, 9개 `fields`

서버 응답에 없는 `reviewStatus`, `extractionId`, `comparisonId`, `reservationId`는 만들지 않습니다.
Backend가 지원하지 않는 전체 검색, 분석 상태 필터, 예매 대조 필터, 추출 완료와 일치 후보 집계는 표시하지 않습니다. `totalItems`는 선택한 공연과 접수 상태 조건의 서버 집계입니다.

## 상태 구분

| 값 | 의미 | 화면 처리 |
| --- | --- | --- |
| `intakeStatus` | 접수와 증거 저장 상태 | 목록과 상세의 "접수 상태". 분석 결과나 판정이 아님 |
| `executionStatus` | 분석 실행 단계 결과 | "실행 상태". `SUCCEEDED`, `IN_PROGRESS`, 실패 단계 4종 구분 |
| `analysisStatus` | 분석 결과 상태 | "결과 상태". `COMPLETED`, `PARTIAL`, `UNVERIFIABLE`, `FAILED`, 실행 중이면 "결과 없음" |
| `fields[].state` | 필드별 관찰 상태 | `FOUND`는 "관찰 후보", `UNKNOWN`은 사유, `AMBIGUOUS`는 해석 후보 목록만 표시 |
| `candidateMatch` | 예매 후보 대조 연결 | `NOT_LINKED`는 "예매 대조 미연결 (사유)", null은 "대조 기록 없음" |

- 실행 상태와 결과 상태는 하나의 성공 또는 실패 값으로 합치지 않습니다.
- `FOUND`는 모델이 이미지에서 읽은 후보이며 사실 확인, 예매 일치, 부정 거래 판정이 아닙니다.
- `UNKNOWN`과 `AMBIGUOUS`에는 관찰값을 채우지 않습니다. `AMBIGUOUS`의 후보는 하나로 정하지 않고 나열합니다.
- `askingPrice` 관찰값은 `{ raw, amount }` 객체이며 다른 필드는 문자열입니다. 상세의 팬 입력 `askingPrice`는 숫자입니다.
- 실패 이력(`fields: null`)은 "관찰값이 없습니다. 정상적인 빈 추출 결과가 아닙니다"로 표시하고, 이력 0건은 "아직 분석 이력이 없습니다"로 따로 표시합니다.
- `MATCH_CANDIDATE`나 `NO_MATCH`를 클라이언트에서 계산하지 않습니다. 계약 밖 `candidateMatch.status`는 계약 위반으로 처리합니다.

## 응답 계약 검증

다음 응답은 정상 데이터로 표시하지 않고 "서버 응답 형식이 계약과 다릅니다" 오류로 처리합니다.

- 요청한 공연, 페이지, 제보, 증거와 다른 응답, 필터와 다른 접수 상태 항목
- `originalStored=true`인데 저장 완료가 아니거나 `sha256`이 없는 증거, `originalStored=false`인데 `sha256`이 있는 증거
- `SUCCEEDED`인데 결과 상태가 `FAILED`이거나 9개 필드가 없는 이력, 실패 상태인데 `fields`가 있는 이력, `IN_PROGRESS`인데 결과가 있는 이력
- `UNKNOWN`이나 `AMBIGUOUS`에 값이 있거나 `FOUND`에 값이 없는 필드, 문자열로 온 가격
- 계약에 없는 enum 값, UUID가 아닌 식별자, 날짜 형식 오류

시각 형식: 접수 API는 `OffsetDateTime`(예 `2026-10-30T09:30:00Z`), 분석 이력 API는 `LocalDateTime`(오프셋 없음, 예 `2026-10-31T10:00:02`)으로 옵니다. 분석 이력 시각은 계약대로 UTC로 해석하며 브라우저 시간대로 바꾸지 않습니다.

## 미지원 기능

- 원본 다운로드: 지원하지 않습니다. 원본 이미지 미리보기는 Issue #25에서 연결했으며 [admin-evidence-content-preview.md](admin-evidence-content-preview.md)에 정리했습니다. 객체 키, 사전 서명 URL, 외부 이미지 URL을 만들지 않습니다.
- `listingUrl`: 팬 입력 문자열을 일반 텍스트로만 표시합니다. 링크, 자동 접속, 미리보기, iframe을 만들지 않습니다.
- 제보 설명과 관찰 문구는 React 텍스트로 렌더링하며 HTML로 해석하지 않습니다.
- 이미지 분석 실행, 예매 후보 대조, 관찰값 수동 교정, Case 생성 버튼은 비활성화했습니다.

## 인증과 오류 처리

- 기존 `useAdminApiClient`와 `useAdminQuery`를 재사용합니다. 유효한 토큰이 없으면 요청하지 않고, 토큰은 URL, 로그, 브라우저 저장소에 남기지 않습니다.
- 401은 세션을 정리하고 재로그인 화면으로 바꿉니다. 403, 404, 409 `TENANT_SELECTION_REQUIRED`, 503, 네트워크 오류, 계약 위반은 고정 문구로 구분하며 서버의 `detail` 등 내부 메시지는 표시하지 않습니다.
- 다른 고객사, 권한 없는 공연, 다른 제보의 증거는 서버가 같은 404로 응답하며 화면도 구분하지 않습니다.
- 실패는 빈 목록, 0건, 데모 데이터로 대체하지 않습니다. 각 오류 화면은 같은 조건으로 다시 시도할 수 있습니다.
- 공연, 페이지, 필터, 제보, 증거가 바뀌면 이전 요청을 중단하고, 늦게 도착한 응답은 요청 키가 달라 표시하지 않습니다.
- 목록의 공연(`eventId`), 페이지(`page`), 접수 상태(`intakeStatus`)는 주소에 남아 새로고침과 뒤로 가기 때 같은 서버 페이지를 다시 조회합니다. 알 수 없는 `intakeStatus`는 서버에 보내지 않습니다.
- 인증 세션에서는 `demoTrack2Data`를 쓰지 않습니다. 데모 화면과 데이터는 개발 전용 미리보기(`VITE_ADMIN_DEMO_PREVIEW`)에서만 지연 로딩되며 실제 화면 번들과 분리됩니다. 데모 제보 주소(`DEMO-REP-008` 등)는 인증 세션에서 주소 오류로 처리합니다.

## 테스트

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`src/test/admin-track2-api.test.tsx`(59건)는 Mock 인증 어댑터와 fetch로 위 동작을 검증합니다. 실제 HTTP 검증을 대체하지 않습니다.
기존 데모 화면 테스트 `src/test/admin-track2.test.tsx`는 개발 미리보기 기준으로 유지했습니다.

## 실제 HTTP E2E 결과 (2026-11-02)

격리 Keycloak(HTTPS, 테스트 CA), 격리 MySQL 8.0 컨테이너, Backend main `a1eb50c` jar, Vite 개발 서버 프록시로 실행했습니다. 기존 공유 컨테이너와 Windows MySQL80 서비스는 사용하거나 변경하지 않았습니다.

| 구분 | 결과 |
| --- | --- |
| 실제 HTTP (Keycloak 토큰, Vite 프록시, Spring, MySQL) | 19건 통과, 실패 0, Skip 0 |
| 실제 브라우저 (Chrome, Keycloak 로그인 화면) | 21건 통과 (연속 2회). 그 전 1회 실행에서 다중 고객사 상세 직접 주소 항목이 1건 실패했고 재실행에서 재현되지 않음 |

- HTTP 확인: 실제 응답이 Frontend Zod 스키마를 통과, 접근 가능 공연만 반환, 서버 페이지(25건, 20건씩)와 접수 상태 필터, 제보 없는 공연의 정상 빈 목록, 미부여 공연과 타 고객사 목록, 상세, 분석 이력 404, 다른 제보의 증거 ID 404, 다중 고객사 계정 4개 API 모두 409, 역할 없음 403, 멤버십 없음 404, 토큰 없음과 서명 변조 401, 잘못된 요청 400, 오류 본문에 고객사 정보 없음, `originalStored=false` 증거의 `sha256` null, 분석 이력 4개 결과 상태와 `NOT_LINKED`, 분석 이력 서버 페이지, DB 일시 정지 시 목록, 상세, 이력 503과 복구 후 재조회
- 브라우저 확인: 미인증 상세 주소는 API 미호출, 로그인 후 상세 주소 복원, 상세와 첫 증거 이력만 Bearer로 조회, 제보 설명의 `<script>`는 텍스트로만 표시되고 실행되지 않음, 판매 주소는 링크나 iframe이 아님, 분석 이력 상태 구분, 증거 전환 시 해당 증거 이력만 조회, 목록 페이지 이동, 새로고침 후 재로그인 시 상태 복원, 뒤로 가기, 필터, 공연 전환 시 이전 목록 제거, 미부여와 타 고객사 제보 404 안내, 데모 제보 주소 차단, DB 장애 503 안내와 복구, 저장소와 콘솔에 JWT 없음, 로그아웃 후 차단, 다중 고객사 계정 409 차단
- 개발 모드 React StrictMode가 effect를 두 번 실행해 첫 요청을 취소하므로, 브라우저 검증은 응답을 받은 요청만 실제 조회로 셌습니다.

### 분석 이력 데이터의 출처

Python 분석 서버는 외부 모델만 지원해 E2E에서 실행하지 않았습니다. 분석 이력은 Spring 조회와 직렬화 경로를 확인하기 위해 격리 DB에 넣은 합성 시드이며, `modelName`을 `synthetic-e2e-db-seed`, `modelVersion`을 `not-a-python-result`로 표시했습니다. Python 분석 결과가 아니며 분석 실행 POST 경로는 검증하지 않았습니다.

### 재현 조건

E2E 스크립트와 비밀값은 저장소에 포함하지 않았습니다.

- Keycloak: `docs/keycloak/README.md`의 realm을 HTTPS와 테스트 CA로 실행하고 E2E 전용 password grant 클라이언트를 둡니다. 합성 사용자는 분석가, 두 고객사 소속, 역할 없음, 멤버십 없음 4종입니다.
- MySQL 8.0: 격리 컨테이너에 Backend `ddl-auto=create`로 스키마를 만든 뒤 합성 고객사 2곳, 공연 4개(부여 2, 미부여 1, 타 고객사 1), 멤버십, 제보 27건, 증거 6건(저장 완료, 저장 실패, 저장 대기), 분석 이력 시드 4건을 넣습니다.
- Spring: Backend main jar를 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `TICKET_DEFENDER_SECURITY_ADMIN_ISSUER`, `TICKET_DEFENDER_SECURITY_ADMIN_AUDIENCE`, `TICKET_DEFENDER_SECURITY_ADMIN_JWK_SET_URI`와 테스트 CA truststore로 실행합니다. 증거 저장소와 분석 서버 설정은 비활성 기본값을 유지합니다.
- Frontend: `VITE_ADMIN_AUTH_*` 환경변수와 `TD_DEV_API_PROXY_TARGET`으로 Vite 개발 서버(포트 15173)를 실행합니다.
- 실제 HTTP 검증은 Frontend의 `createAdminApiClient`와 Zod 스키마를 그대로 불러와 실행했고, 브라우저 검증은 시스템 Chrome을 CDP로 구동했습니다.

## 미구현 및 후속 작업

- 원본 다운로드 (반출 정책 결정 필요). 미리보기는 Issue #25에서 연결
- 이미지 분석 실행(POST)과 진행 중 상태 갱신
- 예매 후보 대조, 관찰값 수동 교정, Case 연결
- Python 분석 서버를 포함한 분석 실행 E2E (외부 모델 전송 정책 승인 필요)
- 실제 HTTP와 브라우저 E2E 자동화 (현재 저장소 밖 수동 실행)
- 디자인: Figma 원본과 비교하지 못했습니다. 기존 저장소의 Track 2 화면 구성과 스타일을 기준으로 구현했습니다.
