# 관리자 Track 2 원본 이미지 미리보기 (Issue #25)

인증된 관리자가 팬 제보 상세(`/app/fan-reports/:reportId`)의 증거 영역에서 팬이 제출한 비공개 원본 이미지를 미리보는 기능입니다.
미리보기 전용입니다. 원본 다운로드, 이미지 분석 실행, 예매 후보 대조, Case 생성은 연결하지 않았습니다.

## 사용하는 API

계약 원문은 Backend `docs/api/admin-evidence-content-v1.yaml`, `docs/api/admin-evidence-content-v1.md`이며 Backend main `15cf228`(PR #65) 기준입니다.

```http
GET /api/v1/admin/fan-reports/{fanReportId}/evidence/{evidenceId}/content
Authorization: Bearer {관리자 JWT}
Accept: image/png, image/jpeg, application/problem+json
```

- 성공 응답은 `200`, `Content-Type: image/png` 또는 `image/jpeg` 바이너리입니다.
- 인증, 고객사와 공연 범위, 증거 소속, 보존 기한, 객체 버전, 크기, 형식, SHA-256 검증과 열람 감사는 Backend가 수행합니다. Frontend는 이 검증을 대신하거나 우회하지 않습니다.
- `fanReportId`, `evidenceId`는 상세 응답에 있는 값만 사용합니다. 저장소 주소, 버킷, 객체 키, 객체 버전, 사전 서명 URL은 사용하지 않습니다.
- `img src`에 API 주소를 직접 넣지 않습니다. 이 경우 Bearer 인증을 붙일 수 없기 때문입니다.

## 코드 구성

| 파일 | 역할 |
| --- | --- |
| `src/api/adminApiClient.ts` | 기존 클라이언트에 `requestImage` 추가. `request`와 같은 내부 전송 함수를 공유 |
| `src/api/imageResponse.ts` | 20 MiB 제한 스트림 읽기, Content-Type 해석, PNG와 JPEG 바이트 서명 검사 |
| `src/features/admin-track2/EvidenceContentPreview.tsx` | 미리보기 상태, Blob URL 생성과 해제, 오류 코드별 고정 문구 |
| `src/features/admin-track2/LiveFanReportDetailPage.tsx` | 선택한 증거마다 미리보기 영역 배치 (`key`로 증거별 분리) |
| `src/features/admin-track2/track2Api.ts` | `evidenceContentPath` 경로 함수 |

새 라이브러리는 추가하지 않았습니다.

## 기존 JSON 요청과 이미지 요청의 차이

두 요청은 같은 내부 전송 함수를 사용하므로 다음 동작이 같습니다.

- `isAllowedAdminApiPath` 검사를 통과한 동일 출처 관리자 경로만 요청하고, 통과하지 못하면 토큰을 보내기 전에 거부합니다.
- 현재 유효한 관리자 토큰이 없으면 요청하지 않고 미인증으로 반환합니다.
- `credentials: omit`, `cache: no-store`, `redirect: error`, `referrerPolicy: no-referrer`, `AbortSignal`을 적용합니다.
- `401`은 기존 세션 정리(`handleUnauthorized`)를 호출하고, `403`, `404`, 그 밖의 오류는 기존 `AdminApiResult` 분류와 Problem `code`를 그대로 씁니다.

차이는 성공 응답 처리입니다.

| 항목 | `request` (JSON) | `requestImage` (이미지) |
| --- | --- | --- |
| 성공 상태 | 2xx | `200`만 |
| 본문 해석 | `response.json()`과 Zod 스키마 | JSON으로 읽지 않음. 바이트를 직접 읽음 |
| 형식 확인 | 스키마 | Content-Type이 `image/png` 또는 `image/jpeg`이고 실제 바이트 서명이 같은 형식 |
| 크기 제한 | 없음 | `Content-Length`와 실제 수신 바이트 모두 20 MiB 이하 |

다음 응답은 모두 `invalidResponse`로 처리하고 이미지로 표시하지 않습니다.

- `200`이지만 HTML 로그인 화면이나 JSON 오류 본문인 응답
- Content-Type이 없거나 PNG, JPEG가 아닌 응답
- 선언한 형식과 실제 바이트 서명이 다른 응답 (PNG라고 했지만 JPEG 바이트 등)
- 빈 본문, 서명만 있는 잘린 PNG
- `Content-Length`가 숫자가 아니거나 20 MiB를 넘거나 실제 수신 크기와 다른 응답
- `200`이 아닌 2xx 응답

크기 제한은 `response.blob()`으로 끝까지 읽은 뒤 확인하지 않습니다. `ReadableStream`에서 조각을 받을 때마다 누적 크기를 확인하고 20 MiB를 넘으면 즉시 스트림을 취소합니다.
`Content-Length`가 상한을 넘으면 본문을 읽지 않고 취소합니다.

바이트 서명 검사는 PNG(서명과 첫 IHDR 청크), JPEG(SOI 뒤 마커) 형식 확인일 뿐이며 이미지 전체가 정상 디코딩된다는 뜻이 아닙니다. 그래서 화면의 `img` 디코딩 실패(`onError`)도 따로 "이미지를 표시하지 못했습니다"로 처리합니다.
또한 응답 형식이 상세 응답의 증거 `mediaType`과 다르면 다른 원본일 수 있으므로 표시하지 않습니다.

## 화면 동작

- 상세를 열어도 이미지를 요청하지 않습니다. 관리자가 "원본 미리보기"를 누른 증거 하나만 요청합니다. 증거 목록 전체를 자동으로 가져오지 않습니다.
- `originalStored=true`이고 `storageStatus=STORED`이며 형식이 PNG, JPEG인 증거만 버튼을 활성화합니다. 그 외에는 버튼을 비활성화하고 사유를 표시하며 요청하지 않습니다.
- 상태: 닫힘, 불러오는 중, 디코딩 중, 표시됨, 응답 실패, 표시 실패. 각 상태는 영역의 `data-preview-state`로도 확인할 수 있습니다.
- 표시 중에는 "다시 불러오기"와 "미리보기 닫기"를, 실패 시에는 일시적 오류에만 "다시 시도"를 제공합니다.
- 이미지는 실제 비율을 유지하고 화면 너비와 높이 70vh 안에 맞춥니다.
- "팬이 제출한 원본 자료이며 사실 확인이나 부정 거래 판정을 거친 자료가 아님"을 항상 표시하고, 증거 ID와 기존 원본 메타데이터, 분석 이력은 그대로 둡니다.

## Blob URL과 요청 경쟁 처리

- 검증을 통과한 바이트로 메모리 Blob을 만들고 `URL.createObjectURL`로 표시합니다.
- 요청은 `(시도 번호, 제보 ID, 증거 ID)`로 만든 키를 가진 effect 한 번에 묶입니다. effect 정리 함수가 `AbortController.abort()`와 `URL.revokeObjectURL`을 함께 수행합니다.
- 응답이 도착했을 때 그 effect가 이미 정리되었으면(취소됨) Blob URL을 만들지 않고 결과도 버립니다. 요청 취소를 무시하고 늦게 끝난 응답도 같은 이유로 표시되지 않습니다. 화면은 현재 키와 일치하는 결과만 그립니다.
- 다음 경우 effect가 정리되어 Blob URL이 해제됩니다: 증거 변경(증거별 `key`로 다시 만듦), 미리보기 닫기, 다시 불러오기(새 이미지로 교체), 제보 주소 변경(상세가 제보 ID `key`로 다시 만들어짐), 언마운트, 로그아웃과 세션 만료(인증 상태가 바뀌면 보호 라우트가 화면을 내리고, 미리보기도 인증 상태가 아니면 요청 키를 비움), 이미지 요청의 401.
- 디코딩에 실패한 이미지는 그 즉시 해제합니다.
- 미리보기를 다시 열면 시도 번호가 올라가므로 이전 결과를 재사용하지 않고 다시 요청합니다.
- React 개발 모드(StrictMode)의 effect 재실행에서도 Blob URL이 하나만 유지되는지 테스트로 확인했습니다.
- 이미지 바이트, Blob URL, JWT는 `localStorage`, `sessionStorage`, IndexedDB에 저장하지 않고 로그에 출력하지 않습니다.

Blob URL 해제는 이 화면의 메모리 정리입니다. 이미 브라우저에 표시된 이미지의 화면 캡처, 복사, 저장을 막는 보안 장치가 아니며 서버의 열람 감사와도 별개입니다.

## 오류 코드별 화면 처리

서버의 `detail`, 예외 내용, 객체 키, 버킷, 내부 경로, 토큰은 표시하지 않습니다. Problem `code`는 형식(`^[A-Z][A-Z0-9_]{0,63}$`)이 맞을 때만 분류 코드로 씁니다.

| 상태와 코드 | 제목 | 다시 시도 |
| --- | --- | --- |
| 401 | 관리자 세션이 만료되었습니다 (세션 정리 후 재로그인 화면) | 없음 |
| 403 | 이 원본을 볼 수 있는 역할이 없습니다 | 없음 |
| 404 | 원본을 찾을 수 없거나 접근 범위 밖입니다 (없음과 범위 밖을 구분하지 않음) | 없음 |
| 400 | 요청 값이 올바르지 않습니다 | 없음 |
| 409 `TENANT_SELECTION_REQUIRED` | 여러 고객사 소속 계정은 아직 지원하지 않습니다 | 없음 |
| 409 `SOURCE_CHANGED` | 원본 정보가 확인 중 바뀌었습니다 | 있음 |
| 422 `SOURCE_NOT_AVAILABLE` | 원본을 제공할 수 없는 상태입니다 | 없음 |
| 422 `RETENTION_EXPIRED` | 보존 기한이 지나 원본을 표시하지 않습니다 | 없음 |
| 422 `OBJECT_CHANGED`, `OBJECT_MISSING`, `SIZE_MISMATCH`, `MEDIA_TYPE_MISMATCH`, `HASH_MISMATCH` | 원본 무결성을 확인하지 못했습니다 (분류 코드 표시) | 없음 |
| 422 `UNSUPPORTED_IMAGE_TYPE`, `EVIDENCE_CONTENT_TOO_LARGE` | 미리보기를 지원하지 않는 원본입니다 | 없음 |
| 503 `STORAGE_UNAVAILABLE` | 원본 저장소에 연결하지 못했습니다 | 있음 |
| 503 `EVIDENCE_CONTENT_BUSY` | 원본 열람 요청이 많습니다 | 있음 |
| 503 `AUDIT_UNAVAILABLE` | 열람 기록을 저장하지 못해 원본을 표시하지 않았습니다 | 있음 |
| 503 `DEPENDENCY_UNAVAILABLE` 등 | 서버가 일시적으로 응답할 수 없습니다 | 있음 |
| 네트워크 오류 | 서버에 연결하지 못했습니다 | 있음 |
| 계약과 다른 응답 | 이미지 응답을 확인하지 못했습니다 | 있음 |
| 디코딩 실패 | 이미지를 표시하지 못했습니다 | 있음 |

- 403은 Backend가 제보 고객사의 활성 멤버십과 공연 권한을 확인한 뒤에만 반환하므로 다른 고객사 제보의 존재를 알려주지 않습니다. 다른 고객사, 권한 없는 공연, 다른 제보의 증거는 모두 같은 404 문구입니다.
- 모든 실패는 빈 이미지, 분석 0건, 합성 데모 이미지로 바꾸지 않습니다. 이미지 실패는 증거 메타데이터와 분석 이력 표시에 영향을 주지 않습니다.
- 합성 데모 화면(`EvidenceViewer`, `demoTrack2Data`)은 개발 전용 미리보기에서만 쓰며 실제 인증 화면과 섞지 않습니다.

## 테스트

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

| 파일 | 건수 | 내용 |
| --- | --- | --- |
| `src/test/admin-image-client.test.ts` | 22 | 요청 옵션, 경로 차단, 401 세션 정리, 오류 분류, HTML, JSON, MIME 불일치, 잘린 바이트, Content-Length, 20 MiB 스트림 중단, 취소 |
| `src/test/admin-evidence-preview.test.tsx` | 35 | 클릭 시에만 요청, 미저장 증거, PNG와 JPEG, 증거 전환의 늦은 응답, 닫기, 제보 이동, 로그아웃, 다른 조회의 401, StrictMode, 디코딩 실패, 오류 코드 18종, 재시도, 교체, 다운로드 미연결 |
| `src/test/admin-track2-api.test.tsx` | 59 | 기존 목록, 상세, 분석 이력 회귀 (미리보기 버튼 상태 확인 추가) |

Mock 테스트는 실제 Backend 연동을 대체하지 않습니다. 아래 실제 HTTP와 브라우저 E2E를 따로 수행했습니다.

## 실제 HTTP와 브라우저 E2E 결과 (2026-11-03)

격리 Keycloak 26(HTTPS, 테스트 CA), 격리 MySQL 8.0 컨테이너, 격리 MinIO 컨테이너, Backend main `15cf228` jar, Vite 개발 서버 프록시로 실행했습니다.
공유 Windows MySQL80, 기존 Keycloak, MinIO 버킷, Docker 볼륨, Neo4j 데이터는 사용하거나 변경하지 않았습니다. 이미지는 Java ImageIO로 만든 합성 PNG(480x300), JPEG(360x520)입니다.

| 구분 | 결과 |
| --- | --- |
| 실제 HTTP (Keycloak 토큰, Vite 프록시, Spring, MySQL, MinIO) | 19건 통과, 실패 0, Skip 0 (연속 2회). 그 전 2회 실행은 E2E 스크립트 결함(정규식, 실행 간 객체 복원 누락)으로 실패했고 스크립트만 고쳤습니다 |
| 실제 브라우저 (Chrome headless, CDP, Keycloak 로그인 화면) | 30건 통과, 실패 0 (연속 2회) |

- HTTP 확인: Frontend `requestImage`로 받은 PNG와 JPEG 바이트가 합성 원본과 동일, 성공 감사 1건 증가와 tenant, event, 제보, 관리자 멤버십 값, 응답 헤더(`no-store`, `nosniff`, `inline`, 저장소 정보 없음), 다른 고객사, 미부여 공연, 다른 제보의 증거, 없는 증거 404(범위 밖 요청은 감사 없음, 해당 고객사 관리자는 같은 증거를 정상 조회), 다중 고객사 409, 역할 없음 403, 토큰 없음과 위조 토큰 401, 잘못된 UUID 400, 저장 실패, 저장 대기 `SOURCE_NOT_AVAILABLE`, `RETENTION_EXPIRED`, `HASH_MISMATCH`, `OBJECT_CHANGED`, `OBJECT_MISSING`, `SIZE_MISMATCH`, `MEDIA_TYPE_MISMATCH`(실패 감사 기록, 응답에 객체 키와 버전 없음), 표시 후 저장소 객체 교체 시 `OBJECT_CHANGED`, MinIO 중지 시 503 `STORAGE_UNAVAILABLE`과 재기동 후 복구
- 브라우저 확인: 미인증 주소는 API 미호출, 로그인 후 상세 복원과 이미지 미요청, 기존 분석 이력 표시, 클릭한 증거만 Bearer로 1회 요청, 응답 200 `image/png`, `blob:` 이미지 실제 크기 480x300과 비율 유지, 네트워크 응답 바이트와 표시 중인 Blob의 SHA-256이 원본과 동일, 감사 1건, 다운로드 링크 없음, 증거 전환 시 이전 Blob 해제와 자동 요청 없음, JPEG 360x520 표시, 닫기 해제, 미저장 증거 비활성, CDP로 증거 1 응답을 붙잡아 둔 채 증거 2로 전환(증거 1 요청 취소, 증거 2만 표시), 로그아웃과 실제 토큰 만료 시 앱이 Blob URL 해제, 브라우저 저장소에 JWT, Blob URL 없음, 보존 만료와 무결성 오류 4종 문구, MinIO 중지 503 후 재시도 복구, 네트워크 차단 후 재시도 복구, 다른 고객사와 미부여 공연 404, 다중 고객사 409, 앱이 만든 Blob URL 6개 모두 앱에서 해제, 콘솔에 토큰과 Blob URL 출력 없음
- 실제 토큰 만료는 격리 Keycloak 웹 클라이언트의 토큰 수명을 75초로 줄여 확인했습니다(만료 30초 전 세션 종료).
- Blob URL 생성과 해제는 CDP 바인딩으로 앱의 `URL.createObjectURL`, `URL.revokeObjectURL` 호출을 기록해 확인했습니다. 페이지 이동으로 문서가 사라져 해제된 경우와 구분하기 위해서입니다.

### 실제 Backend로 확인하지 못한 항목

- 503 `EVIDENCE_CONTENT_BUSY`, `AUDIT_UNAVAILABLE`, `DEPENDENCY_UNAVAILABLE`, 409 `SOURCE_CHANGED`, 422 `UNSUPPORTED_IMAGE_TYPE`, `EVIDENCE_CONTENT_TOO_LARGE`: 격리 환경에서 재현 조건을 만들지 않았고 화면 문구는 컴포넌트 테스트로만 확인했습니다.
- 역할 없음 403은 실제 HTTP로만 확인했습니다. 브라우저에서는 상세 조회 단계의 응답이 먼저 표시됩니다.
- 브라우저의 늦은 응답 확인에서 Chrome은 앱이 취소한 요청을 실제로 중단했습니다. "취소를 무시하고 늦게 완료된 응답"은 Mock 컴포넌트 테스트로 확인했습니다.

### 재현 조건

E2E 스크립트와 비밀값은 저장소에 포함하지 않았습니다.

- Keycloak: `docs/keycloak/README.md`의 realm을 HTTPS와 테스트 CA로 실행하고 HTTP 검증 전용 direct grant 클라이언트를 둡니다. 합성 사용자는 고객사 A 분석가, 두 고객사 소속, 역할 없음, 고객사 B 분석가 4종입니다.
- MySQL 8.0: Backend `ddl-auto=create`로 스키마를 만든 뒤 합성 고객사 2곳, 공연 3개(부여, 미부여, 타 고객사), 멤버십, 제보 11건, 증거 13건, 분석 이력 시드 2건을 넣습니다. 분석 이력은 Spring 조회 회귀 확인용 DB 시드이며 Python 분석 결과가 아닙니다(`synthetic-e2e-db-seed`).
- MinIO: 버전 관리 없는 격리 버킷에 합성 이미지를 올리고 업로드 응답 ETag를 `object_version`으로 저장합니다. 무결성 오류 사례는 DB의 SHA-256, 크기, 형식, ETag를 실제 객체와 다르게 두거나 객체를 올리지 않아 만듭니다.
- Spring: `FAN_REPORT_ENABLED=false`(공개 접수 비활성)에 `FAN_REPORT_S3_ENDPOINT`, `FAN_REPORT_S3_BUCKET`, `FAN_REPORT_S3_HEAD_ACCESS_KEY`, `FAN_REPORT_S3_HEAD_SECRET_KEY`(읽기 자격)와 관리자 JWT 설정, 테스트 CA truststore로 실행합니다.
- Frontend: `VITE_ADMIN_AUTH_*`와 `TD_DEV_API_PROXY_TARGET`으로 Vite 개발 서버(포트 15173)를 실행합니다. 실제 HTTP 검증은 Frontend의 `createAdminApiClient`, `track2Api`를 그대로 불러와 실행했습니다.

## 운영 정책 미확정 사항

- 원본 다운로드(`attachment`) 허용 여부, 조건, 워터마크, 다운로드 사유 입력
- 우클릭 방지 등 별도 반출 제한 정책 (이번 작업에서 임의로 정하지 않음). 브라우저 이미지 표시는 완전한 복사 방지를 보장하지 않습니다.
- 동시 읽기 수와 최대 크기의 운영값 (Frontend 상한 20 MiB는 Backend 계약 상한과 같음)
- 원본 보존 기한과 개인정보 처리 적법성, 실제 팬 이미지 처리 승인
- 다중 고객사 관리자 처리 정책 DEC-02
- 열람 감사 기록의 보관 기간과 조회 화면

## 미구현 및 후속 작업

- 원본 다운로드
- 이미지 분석 실행, 예매 후보 대조, 관찰값 수동 교정, Case 연결
- 실제 HTTP와 브라우저 E2E 자동화 (현재 저장소 밖 수동 실행)
- 디자인: Figma 원본과 비교하지 못했습니다. 기존 Track 2 화면 스타일을 기준으로 구현했습니다.
