# 관리자 Track 2 이미지 분석 실행 (Issue #27)

인증된 관리자가 팬 제보 상세(`/app/fan-reports/:reportId`)에서 선택한 증거 1건에 대해 Listing Context 이미지 분석을 요청하는 기능입니다.
분석 결과는 사람이 확인해야 하는 관찰 후보입니다. 사실 확인, 예매 일치, 부정 거래 판정이 아니며 예매 후보 대조, 관찰값 수동 교정, Case 생성, 공식 PDF 발급으로 이어지지 않습니다.

## 사용하는 API

계약 원문은 Backend `docs/api/track2-listing-analysis-v1.yaml`이며 Backend main `15cf228` 기준입니다.

```http
POST /api/v1/admin/fan-reports/{fanReportId}/evidence/{evidenceId}/listing-analyses
Authorization: Bearer {관리자 JWT}
Idempotency-Key: {UUID v4}
Accept: application/json, application/problem+json
```

- 요청 본문과 쿼리는 없습니다. 객체 키, 이미지 Base64, 고객사 선택값, 미확인 회차 식별자를 보내지 않습니다.
- `fanReportId`, `evidenceId`는 상세 응답에 있는 값만 사용합니다.
- 성공은 `201`만 인정합니다. 응답은 기존 분석 이력 스키마(`listingAnalysisSchema`)로 검증하고, 다음을 모두 만족해야 성공으로 표시합니다.
  - 응답의 `fanReportId`, `evidenceId`가 요청과 같음
  - `executionStatus`가 `SUCCEEDED`이고 `analysisStatus`가 `COMPLETED`, `PARTIAL`, `UNVERIFIABLE` 중 하나
  - `reviewRequired`가 `true`
  - `candidateMatch`가 `NOT_LINKED` 또는 `null`
- 실행 후 기존 `GET` 이력 조회를 다시 실행해 첫 페이지를 갱신합니다.

## 코드 구성

| 파일 | 역할 |
| --- | --- |
| `src/api/adminApiClient.ts` | `request`에 `idempotencyKey`, `successStatus` 옵션 추가. 기존 `send` 경로를 그대로 사용 |
| `src/features/admin-track2/track2Api.ts` | 기존 분석 스키마를 `listingAnalysisSchema`로 export, `listingAnalysisRunPath` 추가 |
| `src/features/admin-track2/listingAnalysisRun.ts` | 실행 가능 여부, UUID v4 키 생성, 응답을 시도 상태로 분류, 코드별 고정 문구 |
| `src/features/admin-track2/useListingAnalysisRuns.ts` | 제보 화면 단위의 증거별 시도 상태, 중복 실행 차단, 화면 종료 시 요청 취소 |
| `src/features/admin-track2/ListingAnalysisRunPanel.tsx` | 실행 버튼, 진행, 결과, 불확실, 재확인 화면 |
| `src/features/admin-track2/LiveFanReportDetailPage.tsx` | 선택한 증거 아래에 실행 영역 배치, 시도 종료 시 이력 재조회 |

새 라이브러리는 추가하지 않았습니다. 키는 브라우저 `crypto.randomUUID()`로 만듭니다.

## API 클라이언트 변경

- `idempotencyKey`는 UUID v4 형식(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 대소문자 무시)이고 `POST`일 때만 `Idempotency-Key` 헤더로 보냅니다. 그 외 값이나 메서드는 토큰을 보내기 전에 `TypeError`로 거부합니다. 임의 헤더 옵션은 만들지 않았습니다.
- `successStatus`를 지정하면 다른 2xx 응답은 `invalidResponse`입니다.
- 본문이 없으면 `Content-Type`을 붙이지 않습니다.
- 경로 검사, 토큰 처리, `credentials: omit`, `cache: no-store`, `redirect: error`, `referrerPolicy: no-referrer`, `AbortSignal`, 401 세션 정리는 기존과 같습니다. `requestImage`는 변경하지 않았습니다.

## 실행 가능 조건

상세 응답의 증거 메타데이터로 판단하며 최종 검증은 Backend가 원본 바이트로 다시 수행합니다.

| 조건 | 화면 |
| --- | --- |
| `originalStored`가 `false` | 실행 버튼 비활성, "원본 저장이 확인되지 않아 분석할 수 없습니다" |
| JPEG, PNG가 아님 | 실행 버튼 비활성, "원본 접수 실패가 아닙니다" |
| 5 MiB 초과 | 실행 버튼 비활성, "원본 접수 실패가 아닙니다" |

5 MiB를 넘는 이미지도 W02 접수 상한 안에서 정상 접수된 원본일 수 있습니다. 분석 입력 제한을 원본 접수 실패로 표시하지 않습니다.
화면에서 역할을 판단하지 않습니다. 역할 부족은 서버 `403`으로 안내합니다.

## 멱등성과 응답 불확실성

Backend는 같은 요청자, 같은 증거, 같은 키 요청에 Python을 다시 호출하지 않고 기록된 결과를 같은 상태 코드로 돌려줍니다. 이를 근거로 시도 상태를 다음과 같이 나눕니다.

| 상태 | 조건 | 키 | 다음 동작 |
| --- | --- | --- | --- |
| 시도 없음 | 아직 요청하지 않음 | 없음 | 이미지 분석 실행 |
| 전송 중 | 응답 대기 | 유지 | 버튼 비활성 |
| 성공 | 201 검증 통과 | 종료 | 새 분석 실행(새 키) |
| 실패 확정 | 계약 코드가 있는 409 `ANALYSIS_ABANDONED`, 422, 502, 503, 504 | 종료 | 새 분석 실행(새 키) |
| 요청 거부 | 400, 403, 404, 409 `TENANT_SELECTION_REQUIRED`, 503 `ANALYZER_DISABLED` | 종료 | 새 분석 실행(새 키) |
| 진행 중 | 409 `ANALYSIS_IN_PROGRESS` | 유지 | 같은 요청 재확인, 분석 이력 다시 조회 |
| 결과 불확실 | 네트워크 오류, 응답 형식 위반, 201 내용 불일치, 201이 아닌 2xx, 계약 코드가 없는 오류, 503 `DEPENDENCY_UNAVAILABLE` | 유지 | 같은 요청 재확인, 분석 이력 다시 조회 |

- 연결이 끊긴 요청도 서버가 분석을 실행했을 수 있습니다. 결과가 불확실하면 새 키를 만드는 버튼을 제공하지 않고 같은 키 재확인만 제공합니다.
- 프록시가 만든 502, 504처럼 계약 코드가 없는 응답은 Spring이 결과를 기록했는지 알 수 없으므로 실패로 확정하지 않습니다.
- `DEPENDENCY_UNAVAILABLE`은 DB 장애이며 시도 기록 이후에도 발생할 수 있어 불확실로 처리합니다.
- `GET` 이력에는 키가 없으므로, 재조회한 최신 이력 행을 이 시도의 결과로 단정하지 않습니다.
- 409 `ANALYSIS_IN_PROGRESS`가 같은 증거의 다른 시도 때문이었다면, 그 시도가 끝난 뒤 재확인할 때 같은 키로 이 시도가 실행될 수 있습니다. 화면에 이 점을 안내합니다.
- 중복 클릭은 동기 `ref`로 막아 같은 렌더링 안의 연속 클릭도 요청 1회만 보냅니다.
- 시도 상태와 키는 현재 탭 메모리에만 있습니다. 브라우저 저장소, URL, 화면, 로그에 남기지 않습니다.
- 새로고침하면 시도 정보가 사라집니다. 자동 재실행이나 자동 복구는 하지 않으며 분석 이력으로 서버 기록을 확인합니다.
- 결과가 불확실한 상태가 계속되면 새로고침 전에는 새 분석을 시작할 수 없습니다. 중복 분석을 막기 위한 선택입니다.

## 화면 상태 정리

- 응답은 요청한 증거의 상태에만 기록합니다. 증거를 바꾼 뒤 늦게 도착한 응답은 현재 증거에 표시되지 않고, 원래 증거로 돌아가면 표시됩니다.
- 제보를 바꾸거나 로그아웃, 세션 만료, 401로 화면이 사라지면 대기 중 요청을 취소하고 상태를 버립니다.
- 요청 취소는 브라우저 요청 취소일 뿐 서버 분석 취소가 아닙니다. 화면에 이를 안내합니다.
- 원본 이미지 미리보기, 증거 선택, 분석 이력 페이지 이동은 그대로 유지합니다. 분석 실행은 원본 이미지를 요청하지 않습니다.

## 오류 문구

서버 `detail`, 내부 메시지, 비밀정보, JWT, 객체 키, 이미지 바이트는 화면과 로그에 쓰지 않습니다. Problem `code`만 읽어 고정 문구를 고릅니다.

| HTTP | 코드 | 분류 | 안내 |
| --- | --- | --- | --- |
| 400 | `INVALID_IDEMPOTENCY_KEY`, `INVALID_REQUEST` | 요청 거부 | 요청 키 또는 요청 값 오류, 분석 미실행 |
| 401 | `UNAUTHENTICATED` | 세션 정리 | 재로그인 화면 |
| 403 | `FORBIDDEN` | 요청 거부 | 분석가나 검토자 역할 필요 |
| 404 | `RESOURCE_NOT_FOUND` | 요청 거부 | 없음과 범위 밖을 구분하지 않음 |
| 409 | `ANALYSIS_IN_PROGRESS` | 진행 중 | 같은 요청 재확인 |
| 409 | `ANALYSIS_ABANDONED` | 실패 확정 | 임대 만료로 종료, 새 키로 재실행 |
| 409 | `TENANT_SELECTION_REQUIRED` | 요청 거부 | 다중 고객사 미지원 |
| 422 | `SOURCE_NOT_AVAILABLE`, `RETENTION_EXPIRED`, `UNSUPPORTED_IMAGE_TYPE`, `ANALYSIS_INPUT_TOO_LARGE`, `OBJECT_MISSING`, `OBJECT_CHANGED`, `SIZE_MISMATCH`, `MEDIA_TYPE_MISMATCH`, `HASH_MISMATCH` | 실패 확정 | 원본 상태, 보존, 형식, 크기, 무결성 문제. 형식과 크기 문제는 원본 접수 실패가 아님 |
| 502 | `ANALYZER_AUTH_FAILED`, `ANALYZER_INPUT_REJECTED`, `ANALYZER_MODEL_FAILED`, `ANALYZER_INTERNAL_ERROR`, `ANALYZER_RESPONSE_INVALID`, `ANALYZER_IDENTITY_MISMATCH` | 실패 확정 | 내부 인증, 모델, 응답 계약 문제 |
| 503 | `ANALYZER_DISABLED` | 요청 거부 | 분석 기능 비활성, 이력 없음. 화면에서 켤 수 없음 |
| 503 | `STORAGE_UNAVAILABLE`, `ANALYZER_UNAVAILABLE`, `ANALYZER_CONNECTION_FAILED` | 실패 확정 | 저장소 또는 분석 서버 장애 |
| 503 | `DEPENDENCY_UNAVAILABLE` | 결과 불확실 | 같은 요청 재확인 |
| 504 | `ANALYZER_TIMEOUT`, `ANALYZER_MODEL_TIMEOUT` | 실패 확정 | Spring 대기 또는 모델 처리 시간 초과 |
| 그 외 | 계약 코드 없음, 네트워크 오류 | 결과 불확실 | 같은 요청 재확인 |

실패 확정 문구는 "분석 실패 이력으로 기록되었습니다. 정상 빈 결과가 아닙니다"를 포함합니다. 실패를 `UNKNOWN`이나 0건으로 바꾸지 않습니다.

## 단위 및 컴포넌트 테스트

- `src/test/admin-api-client.test.ts`: UUID v4 키 헤더, 본문 없음, 잘못된 키와 메서드 사전 거부, 성공 상태 불일치
- `src/test/admin-track2-analysis-run.test.tsx`: 클릭 전 미요청, 선택 증거 경로, 헤더와 보안 옵션, 중복 클릭, 실행 불가 증거, 결과 상태 3종과 이력 갱신, 실패 확정과 새 키, 응답 불일치와 같은 키 재확인, 네트워크 오류와 이력 재조회, 409 진행 중과 임대 만료, 늦은 응답, 로그아웃, 401, 코드별 문구 21종, 403과 404 비노출, 미리보기와 비활성 기능 회귀, 브라우저 저장소 미보관
- `src/test/admin-track2-api.test.tsx`, `src/test/admin-evidence-preview.test.tsx`: 분석 실행 버튼이 연결된 뒤에도 클릭 전 POST가 없고 예매 대조, 수동 교정, Case 생성이 비활성인지 확인하도록 기존 기대값 수정

Mock 테스트는 실제 Spring과 FastAPI 연동을 대체하지 않습니다.

## 실제 HTTP와 브라우저 E2E 결과 (2026-11-03)

격리 MySQL 8.0.46 컨테이너, 격리 MinIO 컨테이너, Backend main `15cf228` jar, Data main `7e11c65` 사본의 실제 FastAPI 애플리케이션, Vite 개발 서버 프록시로 실행했습니다.
공유 Windows MySQL80, 기존 Keycloak, MinIO 버킷, Docker 볼륨, Neo4j 데이터는 사용하거나 변경하지 않았습니다. 이미지는 Pillow로 만든 합성 PNG, JPEG이며 실제 팬 이미지와 개인정보는 쓰지 않았습니다.

| 구분 | 결과 |
| --- | --- |
| 실제 HTTP (합성 JWT, Spring, FastAPI, MySQL, MinIO) | 24건 통과, 실패 0, Skip 0 (초기화한 환경에서 연속 2회) |
| 실제 Chrome (headless, CDP, Vite 화면) | 26건 통과, 실패 0 |

검증 범위와 한계는 다음과 같습니다.

- 로그인은 격리 HTTPS OIDC 대역 서버가 새로 만든 RSA 키로 발급한 합성 관리자 JWT(RS256)입니다. Spring은 이 서버의 HTTPS JWKS로 issuer, audience, 만료, 서명을 실제로 검증했습니다. **실제 Keycloak 로그인 검증이 아닙니다.**
- FastAPI는 실제 `main.app`의 내부 인증, 이미지 검증, 응답 계약 코드를 그대로 쓰고 모델 제공자만 테스트 전용 FakeProvider로 바꿨습니다. 외부 모델 호출 플래그는 꺼져 있었고 외부 모델은 호출하지 않았습니다. **실제 모델 추론 성공이 아닙니다.**
- 실제 HTTP 검증은 Frontend의 `createAdminApiClient`, `listingAnalysisSchema`, `classifyRunResult`를 그대로 불러 실제 응답을 Frontend가 어떻게 분류하는지 함께 확인했습니다.

실제 HTTP 확인 항목:

- Spring이 저장 원본을 읽어 SHA-256, 크기, 형식을 확인한 뒤 FastAPI를 HTTP로 호출하고, FakeProvider가 받은 이미지의 SHA-256, 형식, 크기가 접수 기록과 같음
- `COMPLETED`, `PARTIAL`, `UNVERIFIABLE` 201 응답과 502 `ANALYZER_MODEL_FAILED` 실패 이력이 MySQL `listing_context_analyses`, 관찰값 9건, 이력 GET과 일치
- 같은 키 재요청은 성공과 실패 모두 FastAPI를 다시 부르지 않고 같은 결과 재현, 새 키는 새 이력
- 다른 키 동시 요청 409 `ANALYSIS_IN_PROGRESS`, 같은 키 동시 요청 1회 실행
- 응답 유실(클라이언트 요청 중단) 뒤 같은 키 재확인: 진행 중 409 후 201, FastAPI 1회, 이력 1건
- 422 `HASH_MISMATCH`, `MEDIA_TYPE_MISMATCH`, `ANALYSIS_INPUT_TOO_LARGE`, `RETENTION_EXPIRED`, `SOURCE_NOT_AVAILABLE`는 FastAPI를 부르지 않고 제보 접수 상태와 증거 저장 상태를 바꾸지 않음
- 503 `ANALYZER_UNAVAILABLE`, 504 `ANALYZER_MODEL_TIMEOUT`, 504 `ANALYZER_TIMEOUT`(Spring 대기 8초), FastAPI 중지 시 503 `ANALYZER_CONNECTION_FAILED`와 재기동 후 복구
- MySQL 일시 정지 시 503 `DEPENDENCY_UNAVAILABLE`이 결과 불확실로 분류되고 복구 뒤 같은 키 재확인이 이력 1건만 만듦
- 토큰 없음, 위조 서명, 만료, 다른 audience, 다른 issuer 401과 세션 정리 콜백, 역할 없음 403, 다른 고객사, 미부여 공연, 다른 제보의 증거, 없는 증거 404(이력 없음), 다중 고객사 409, 잘못된 키와 키 누락 400
- 분석 기능을 끈 Spring의 503 `ANALYZER_DISABLED`(이력 없음, 요청 거부로 분류)
- 분석 중 Spring을 중단해 남은 `IN_PROGRESS` 시도의 같은 키 재요청이 409 `ANALYSIS_ABANDONED`로 닫힘. 임대 시간(최소 3분 8초)은 DB의 `lease_expires_at`만 과거로 바꿔 앞당겼습니다

실제 Chrome 확인 항목:

- 미인증 주소는 API 미호출, 로그인 후 상세 복원, 클릭 전 분석 POST 없음
- 실행 버튼 연속 3회 클릭에 POST 1회, Bearer, UUID v4 키, 본문과 Content-Type 없음
- 관찰 완료, 일부만 관찰, 확인 불가, 모델 실패 표시와 MySQL 기록 일치, 실행 후 이력 GET 갱신, 실패 뒤 새 키 실행
- 원본 미저장 증거와 5 MiB 초과 증거 실행 버튼 비활성, 원본 미리보기 SHA-256 일치와 분석 실행 뒤 미리보기 유지
- 증거 전환 중 늦은 응답이 다른 증거에 표시되지 않음
- 응답 유실은 CDP `Fetch.failRequest`로 서버 처리 뒤 응답만 끊어 재현: 결과 불확실, 새 키 실행 차단, 이력 재조회로 확정하지 않음, 같은 키 재확인 201과 FastAPI 1회
- 409 진행 중과 같은 키 재확인, 409 임대 만료(실제 HTTP 단계에서 남긴 시도의 키를 탭의 첫 `crypto.randomUUID()` 호출에 한 번 주입)와 새 키 재실행
- 503 분석 서버 장애, 504 Spring 대기 초과, 503 `DEPENDENCY_UNAVAILABLE` 결과 불확실과 복구 뒤 같은 키 재확인
- 응답 대기 중 로그아웃 시 화면 상태 정리, 서버 분석은 계속되어 기록됨, 수명 50초 토큰 만료 시 세션 종료와 상태 정리
- 예매 후보 대조, 관찰값 수동 교정, Case 생성 비활성, 브라우저 저장소와 콘솔에 요청 키와 JWT 없음

### 실제 환경으로 확인하지 못한 항목

- 실제 Keycloak 로그인과 Keycloak이 발급한 토큰
- 운영 빌드 화면 (브라우저 E2E는 Vite 개발 서버에서 실행했습니다)
- 실제 환경에서 재현하지 않은 코드(컴포넌트 테스트로만 확인): 422 `UNSUPPORTED_IMAGE_TYPE`, `OBJECT_MISSING`, `OBJECT_CHANGED`, `SIZE_MISMATCH`, 502 `ANALYZER_AUTH_FAILED`, `ANALYZER_INPUT_REJECTED`, `ANALYZER_INTERNAL_ERROR`, `ANALYZER_RESPONSE_INVALID`, `ANALYZER_IDENTITY_MISMATCH`, 503 `STORAGE_UNAVAILABLE`
- 실제 HTTP로는 확인했지만 Chrome 화면으로는 확인하지 않은 코드(화면 문구는 컴포넌트 테스트로 확인): 401 위조와 만료 토큰, 403, 404, 다중 고객사 409, 400, 422 5종, 503 `ANALYZER_CONNECTION_FAILED`, `ANALYZER_DISABLED`, 504 `ANALYZER_MODEL_TIMEOUT`
- 실제 외부 모델 추론

### 재현 조건

E2E 스크립트, 인증서, 비밀값은 저장소에 포함하지 않았습니다.

- 비밀값: 실행마다 `openssl rand`로 새로 만들고 파일로만 전달했습니다. 이전 테스트 비밀과 JWT는 재사용하지 않았습니다.
- OIDC 대역 서버: keycloak-js가 쓰는 `auth`, `token`(PKCE S256 확인), `certs`, `logout` 경로만 구현했습니다. 테스트 CA로 서명한 localhost 인증서를 쓰고, Spring은 그 CA만 담은 truststore로, Chrome은 `--ignore-certificate-errors-spki-list`로 그 서버 공개키 하나만 신뢰했습니다.
- MySQL 8.0: Backend `ddl-auto=create`로 스키마를 만든 뒤 합성 고객사 2곳, 공연 3개, 멤버십 5개, 제보 10건, 증거 35건을 넣습니다. 분석 이력은 시드하지 않고 실제 Spring과 FastAPI로만 만들었습니다.
- MinIO: 격리 버킷에 합성 이미지를 올리고 업로드 응답 ETag를 `object_version`으로 저장합니다.
- Spring: `TRACK2_LISTING_ANALYSIS_ENABLED=true`, `TRACK2_LISTING_ANALYSIS_URL=http://127.0.0.1:18090`, `TRACK2_LISTING_ANALYSIS_READ_TIMEOUT=PT8S`, 내부 키, 관리자 JWT 설정, 원본 읽기 자격으로 실행합니다.
- FastAPI: `VLM_ENABLED=true`, `VLM_EXTERNAL_CALLS_ENABLED=false`, `VLM_PROVIDER=disabled`로 실행하고 `get_vlm_service`만 FakeProvider로 바꿉니다. FakeProvider는 이미지 SHA-256별 시나리오(정상, 부분, 확인 불가, 모델 실패, 일시 장애, 모델 시간 초과, 지연)를 따릅니다.
- Frontend: `VITE_ADMIN_AUTH_*`와 `TD_DEV_API_PROXY_TARGET`으로 Vite 개발 서버(포트 15173)를 실행합니다.

## 운영 정책 미확정 사항

- 실제 팬 이미지를 외부 모델에 보내는 처리 근거, 국외 이전, 보관 조건 (승인 전에는 외부 모델 호출 금지)
- 분석 기능 운영 활성화 시점과 분석 결과 보존 기간
- 다중 고객사 관리자 처리 정책 DEC-02
- 결과 불확실 시도의 장기 추적 방법 (현재는 탭 메모리에만 보관)

## 미구현 및 후속 작업

- 예매 후보 대조, 관찰값 수동 교정, Case 연결
- 분석 이력 GET에서 요청 키 또는 요청 시도 식별 정보 제공 (Backend 계약 변경 필요)
- 실제 HTTP와 브라우저 E2E 자동화
