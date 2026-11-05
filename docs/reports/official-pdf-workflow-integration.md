# 관리자 공식 PDF 발급 상태와 다운로드 실제 API 연동 (Issue #35)

사람의 독립 승인 결정 뒤, 서버가 현재 적격성을 다시 확인한 경우에만 공식 PDF를 발급합니다. 화면은 발급 적격성, 발급 요청, 상태, 실패 재시도, 보고서별 이력, 권한 있는 다운로드를 Backend W09 API에 연결합니다.
기준: Frontend main 03dfd4d, Backend main 17c832b. Backend는 `SYNTHETIC_ISOLATED` 모드와 합성 고객사 등록부를 모두 확인할 때만 발급합니다. 실제 고객사 대상 운영 발급은 정책 승인 전까지 차단되어 있으며 화면에서 켤 수 없습니다.
공식 PDF 발급은 부정 거래 확정이나 자동 제재가 아닙니다. 승인 결정과 공식 PDF 발급은 별도 사용자 동작입니다.

## 사용하는 API

Backend 계약은 변경하지 않았습니다. 기준 문서는 Backend `docs/api/case-w09-official-pdf-v1.yaml`, `docs/implementation/case-w09-official-pdf-contract.md`이고, 코드는 `OfficialPdfIssuanceController`, `OfficialPdfDto`, `OfficialPdfIssuanceService`, `OfficialPdfOperationGate`입니다.

| 업무 | API | 성공 | 요청 |
| --- | --- | --- | --- |
| 적격성 | `GET /api/v1/approval-decisions/{id}/official-pdf-eligibility` | 200 Eligibility | 없음 |
| 발급 요청 | `POST /api/v1/approval-decisions/{id}/official-pdf-issuances` | 202 Issuance | 본문 없음, UUID v4 `Idempotency-Key` |
| 발급 상세 | `GET /api/v1/official-pdf-issuances/{id}` | 200 Issuance | 없음 |
| 재시도 | `POST /api/v1/official-pdf-issuances/{id}/retry` | 202 Issuance | 본문 없음, UUID v4 `Idempotency-Key` |
| 보고서별 이력 | `GET /api/v1/report-versions/{id}/official-pdf-issuances` | 200 Issuance 배열 | 없음 |
| 다운로드 | `GET /api/v1/official-pdf-issuances/{id}/download` | 200 `application/pdf` | 없음 |

- 모든 W09 API는 `TENANT_ADMIN`만 허용합니다. 합성 격리 개발을 위한 잠정 역할이며 운영 발급 권한 정책이 아닙니다. 승인 담당(APPROVER)이 승인했다고 발급 권한을 얻지 않습니다.
- 적격성은 `CURRENT`, `STALE`, `BLOCKED`와 서버 코드입니다. 합성 격리 게이트가 막으면 적격성은 `BLOCKED`와 `OFFICIAL_PDF_*` 코드이고, 나머지 API는 같은 코드의 409입니다.
- 발급 POST의 202는 요청 접수입니다. 렌더링이 요청 안에서 끝나므로 응답에 이미 `GENERATED`, `FAILED`, `STALE` 등이 올 수 있고, 화면은 응답의 `status`만 실제 결과로 씁니다.
- 같은 결정에 발급 기록이 이미 있으면 서버는 새 기록을 만들지 않고 기존 기록을 돌려줍니다(결정당 기록 하나, DB UNIQUE).
- 응답에는 비공개 객체 키, presigned URL, 자격증명이 없습니다. 다운로드 응답에는 SHA-256 헤더가 없어 발급 상세의 `pdfSha256`, `pdfSize`와 대조합니다.

## 화면 구성

| 위치 | 내용 |
| --- | --- |
| `/app/report-center` (인증 세션) | 승인 결정 ID 입력 화면입니다. 결정 조회 API가 없어 실제 발급 대기열이 아님을 표시합니다. 개발 전용 미리보기에서는 기존 비활성 안내를 유지합니다. |
| `/app/report-center/decisions/{approvalDecisionId}` | 서버 적격성, 발급 상태, 동작 버튼(상태 다시 조회, 재시도, 다운로드, 발급 요청), 보고서별 이력 표 |
| 승인 요청 상세의 결정 결과 | 승인(APPROVE) 결정 직후에만 `공식 PDF 발급 화면으로 이동` 링크를 표시합니다. 발급 권한과 적격성은 이동한 화면에서 서버가 확인합니다. 반려 결정에는 링크가 없습니다. |
| 승인 요청 상세의 후속 단계, Case 상세 | 결정 ID를 다시 찾는 계약이 없어 보고서 센터 안내만 표시합니다. Case 상세의 공식 PDF 버튼은 계속 비활성입니다. |

## 동작 규칙

- 적격성 응답의 결정 ID가 요청과 다르면 신뢰하지 않습니다. 이력은 적격성 응답의 `reportVersionId`로 이어서 조회합니다.
- 이력 조회가 실패하면(예: 합성 범위 게이트 409) 발급 기록이 없다고 보지 않고 발급 요청을 막습니다.
- 기존 기록이 있으면 새 발급 요청 대신 현재 기록을 보여 줍니다.
- 발급 요청 버튼은 기록이 없고 서버 적격성이 `CURRENT`일 때만 엽니다.
- 재시도 버튼은 기록 상태가 `FAILED` 또는 `STALE`(서버 계약상 재처리 대상)이고, 적격성 응답과 기록의 현재 적격성이 모두 `CURRENT`일 때만 엽니다. `RESERVED`, `RENDERING`, `OBJECT_STORED`에는 상태 다시 조회만 제공합니다.
- 상태 다시 조회는 발급 상세 GET을 보내고 같은 결정의 기록일 때만 표시합니다. 자동 폴링과 자동 재시도는 하지 않습니다.
- 다운로드 버튼은 `GENERATED`이고 `artifactId`, `pdfSha256`, `pdfSize`가 모두 있을 때만 엽니다. 적격성이 바뀐 기존 문서의 다운로드 정책(DEC-14)은 확정되지 않아 서버 판단을 따릅니다.

## 실패 처리

| 상황 | 처리 |
| --- | --- |
| 발급, 재시도 응답 유실 (네트워크, 계약과 다른 응답, 코드 없는 5xx, 503) | 결과 미확인으로 두고 같은 `Idempotency-Key`와 같은 빈 본문으로만 재확인합니다. 그동안 새 발급과 새 재시도를 막습니다. 기존 `useCaseMutation` 규칙을 그대로 씁니다. |
| 확정 거부 (403, 404, 409, 422) | 코드별 고정 문구로 안내하고 적격성과 이력을 다시 조회합니다. `OFFICIAL_PDF_ISSUANCE_IN_PROGRESS`는 실패가 아닌 진행 중 충돌로 안내합니다. |
| 화면을 떠난 뒤 다시 열기 | 원문을 보관하지 않으므로 이력에서 기존 기록을 확인합니다. 결정당 기록이 하나이므로 기록이 없을 때 새 키로 다시 요청해도 서버가 기존 기록을 돌려줍니다. |
| 다운로드 상세가 `GENERATED`가 아님 | 다운로드 GET을 보내지 않습니다. |
| 다운로드 바이트 크기 또는 SHA-256 불일치 | 파일을 만들지 않습니다. |
| `Content-Type`이 `application/pdf`가 아님, 200이 아님, 손상된 본문 | 파일을 만들지 않습니다. `%PDF-` 시작과 마지막 1024바이트 안의 `%%EOF`는 보조 검사이며 끝의 개행과 공백은 허용합니다. |
| 다운로드 401 | 세션을 정리하고 파일을 만들지 않습니다. |

다운로드 상한은 Frontend 임시 값 20 MiB입니다. Backend 계약에 최대 크기는 없으며 이 값은 Backend가 확정한 최대 용량이 아닙니다(Backend 저장소 설정 `OFFICIAL_PDF_MAX_BYTES` 기본값은 별도로 10 MiB입니다).

## 보안

- PDF 바이트, 객체 키, URL은 브라우저 저장소와 로그에 남기지 않고 외부 PDF 뷰어로 보내지 않습니다.
- 다운로드는 기존 관리자 API 클라이언트의 Bearer, 동일 출처 경로 검사, redirect 차단, 401, 403, 404 처리를 그대로 씁니다(`requestPdf`).
- 크기와 SHA-256 대조가 끝난 뒤에만 임시 Blob URL을 만들어 다운로드를 시작하고, 시작 30초 뒤 해제합니다. 화면을 떠나면 남은 URL과 대기 요청을 정리하고, 늦게 도착한 응답으로 파일을 만들지 않습니다.
- 역할과 적격성을 추정하지 않습니다. IssuanceHold, STALE, BLOCKED, 합성 격리 게이트를 화면에서 우회하는 동작은 없습니다.
- 구형 `POST /api/v1/audits/{auditId}/report`의 409 차단은 그대로입니다.

## Backend 계약 부족과 미결정 정책

- 승인 결정 조회 API, 승인 요청 기준 결정 목록 API가 없습니다. 승인 요청 상세와 Case 상세에 `approvalDecisionId`가 없어 과거 결정을 화면에서 다시 찾을 수 없습니다. 결정 직후 링크나 전달받은 ID로만 진입합니다. 별도 Backend Issue가 필요합니다.
- 발급 응답에 시도 lease 만료 정보가 없어, 중단된 진행 상태(`RESERVED`, `RENDERING`, `OBJECT_STORED`)의 복구 재시도는 화면에서 제공하지 않습니다.
- IssuanceHold 등록, 해제 웹 API는 없습니다(운영 권한 미확정).
- DEC-09(이전 완료본 SUPERSEDED 전환, 실패 후보 객체 정리), DEC-14(발급 역할, Hold 운영, 다운로드 재검증), 한국어 PDF 레이아웃, 보존과 파기 정책은 정하지 않았습니다.

## 코드 배치

| 파일 | 내용 |
| --- | --- |
| `src/api/pdfResponse.ts` | PDF 형식 보조 검사와 Frontend 임시 상한 |
| `src/api/adminApiClient.ts` | `requestPdf` 바이너리 GET (기존 전송 경계 재사용) |
| `src/features/admin-reports/officialPdfApi.ts` | W09 Zod 스키마, 경로, 판정 함수, 코드별 고정 문구 |
| `src/features/admin-reports/useOfficialPdfDownload.ts` | 상세 재확인, 바이트 대조, 임시 Blob URL 관리 |
| `src/features/admin-reports/LiveOfficialPdfPage.tsx` | 결정별 발급 화면 |
| `src/features/admin-reports/LiveReportCenterEntryPage.tsx` | 결정 ID 진입 화면 |
| `src/features/admin-reports/ReportCenterRoutes.tsx` | 인증 세션과 미리보기 분기 |

## 테스트

- `src/test/admin-official-pdf.test.tsx`: 계약 스키마, 진입, 적격성(STALE, Hold, 합성 범위, 운영 미승인, 반려), 이력 409, 403과 404, 다른 결정 응답, 중복 클릭, 202와 상태 구분, FAILED와 STALE, 응답 유실 재확인, 확정 거부, 기존 기록 우선, 진행 상태 재조회, 재시도 조건, 진행 중 충돌, 재시도 유실 재확인, 다운로드 성공과 Blob URL 해제, 화면 이탈 정리, SHA-256과 크기 불일치, 잘못된 형식, 손상 PDF, 409, 503, 403, 404, 인증 만료, 늦은 응답
- `src/test/admin-api-client.test.ts`: `requestPdf` 보안 옵션, 형식, 상한, 오류 분류

## 격리 E2E 결과 (2026-11-05)

환경: Spring Boot jar(Backend main 17c832b 소스와 같은 빌드), 격리 MySQL 8.0.45(별도 datadir, 127.0.0.1:13306, Windows MySQL80 서비스와 데이터 미사용), HTTPS OIDC 대역 서버(Keycloak 아님, 합성 RS256 JWT), Vite 개발 서버, 시스템 Chrome headless(CDP). W09는 `enabled=true`, `SYNTHETIC_ISOLATED`, 격리 UUID로만 켰고, 격리 DB에만 합성 고객사 등록 행을 SQL로 넣었습니다. 출처는 파일 없는 Track 1 저장 군집 증거뿐입니다.

공식 PDF 저장소(S3)는 구성하지 않았습니다. 승인된 방식은 공식 MinIO 바이너리와 체크섬이었지만, 공식 배포처(dl.min.io)가 커뮤니티 배포를 중단해 410을 돌려줘 받을 수 없었습니다. 따라서 발급은 렌더링 뒤 저장 단계에서 `FAILED`(`PDF_PROCESSING_FAILED`)가 되는 경로만 실제로 확인했습니다.

- HTTP 15건 통과(3회 실행): 승인 직후 CURRENT와 빈 이력, APPROVER, REVIEWER, ANALYST 403, 다른 공연 관리자와 다른 고객사 관리자 404, 202 응답의 FAILED와 완료본 없음, 응답에 객체 키 없음, 같은 키 재생과 새 키의 기존 기록 반환(기록 1건), 상세와 이력 일치, 미생성 다운로드 409 `OFFICIAL_PDF_NOT_GENERATED`, 명시적 재시도와 같은 키 재생, 동시 재시도에서 실제 `409 OFFICIAL_PDF_ISSUANCE_IN_PROGRESS` 관찰, UUID v4가 아닌 키 400, ACTIVE IssuanceHold의 BLOCKED와 409, 등록 이전 출처의 합성 범위 BLOCKED와 이력 409, 반려 결정 `APPROVAL_NOT_CURRENT`, 구형 보고서 API 409
- Chrome 11건 통과: 결정 ID 진입, 연속 클릭 1회 발급과 202 뒤 FAILED 표시, 재시도 응답 유실 뒤 같은 키 재확인, 상태 다시 조회, 기존 기록과 이력 우선 표시, Hold 차단, 합성 범위 차단과 이력 409, 반려 결정 차단, APPROVER 403 안내, 다른 고객사 404, 모든 요청 Bearer와 저장소 무기록, 페이지 예외 없음
- 실행 중 확인: Chrome 첫 두 실행의 B04 실패는 시험 스크립트가 이전 단계 요청이 끝나기 전에 버튼을 누른 대기 조건 오류였습니다. 대기 조건을 고친 뒤 새 합성 데이터로 HTTP와 Chrome을 다시 실행했습니다.

미검증: `GENERATED` 발급, 실제 PDF 다운로드 바이트와 SHA-256 대조(Mock 테스트로만 확인), 비공개 S3 버전과 `ifNoneMatch` 저장, Object Lock과 보존 정책, 파일 증거(W06, W07) 경로, `STALE` 적격성 전환, 실제 Keycloak 로그인, 운영 발급
