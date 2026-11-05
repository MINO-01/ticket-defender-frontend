# 관리자 Track 2 검증 회차, 제보 회차 연결, 예매 후보 대조 실제 API 연동 (Issue #37)

관리자가 검증된 회차를 등록하고 팬 제보에 회차를 명시적으로 연결한 뒤, 실행 완료된 이미지 분석별로 예매 후보 대조를 직접 실행하고 실행 이력과 적용 여부를 확인합니다.
기준: Frontend main c9e7b19, Backend main 391e285 (#68, PR #69 병합). 후보 결과는 사람이 조사할 후보이며 부정 거래 확정, Case 생성, 제재, PDF 발급이 아닙니다.

## 사용하는 API

Backend 계약은 변경하지 않았습니다. 기준 문서는 Backend `docs/api/track2-candidate-pipeline-v1.yaml`이고 코드는 `CandidatePipelineDto`, `VerifiedPerformanceController`, `PerformanceLinkController`, `ListingCandidateMatchController`입니다.

| 업무 | API | 역할 | 성공 | 요청 |
| --- | --- | --- | --- | --- |
| 회차 목록 | `GET /api/v1/admin/events/{eventId}/verified-performances` | REVIEWER, TENANT_ADMIN | 200 배열 | 없음 |
| 회차 등록 | `POST .../verified-performances` | REVIEWER, TENANT_ADMIN | 201 | `performanceRef, verificationBasis, sourceVersion`, 키 없음 |
| 회차 수정 | `PATCH .../verified-performances/{id}` | REVIEWER, TENANT_ADMIN | 200 | `verificationBasis, sourceVersion, expectedRevision`, 키 없음 |
| 회차 철회 | `POST .../verified-performances/{id}/withdrawals` | REVIEWER, TENANT_ADMIN | 200 | `reason, expectedRevision`, 키 없음 |
| 연결 이력 | `GET /api/v1/admin/fan-reports/{id}/performance-link` | REVIEWER, TENANT_ADMIN | 200 `{items}` | 없음 |
| 회차 연결, 교체 | `PUT .../performance-link` | REVIEWER, TENANT_ADMIN | 201 | `Idempotency-Key`, `performanceId, expectedLinkRevision, reason` |
| 연결 철회 | `POST .../performance-link/withdrawals` | REVIEWER, TENANT_ADMIN | 200 | `Idempotency-Key`, `expectedLinkRevision, reason` |
| 후보 대조 실행 | `POST .../evidence/{evidenceId}/listing-analyses/{analysisId}/candidate-matches` | ANALYST, REVIEWER | 201 | `Idempotency-Key`, 본문 없음 |
| 후보 실행 이력 | `GET .../candidate-matches?page&pageSize=20` | ANALYST, REVIEWER | 200 페이지 | 없음 |

- 시각은 오프셋 없는 LocalDateTime이며 서버가 UTC로 만듭니다(격리 E2E에서 확인). 화면은 기존 `utcDateTime` 스키마로 UTC로만 해석합니다.
- 합성 예매 적재(`reservation-imports`) 화면은 만들지 않았습니다. 서버 기본 차단 상태를 그대로 둡니다.

## 화면 구성

| 위치 | 내용 |
| --- | --- |
| 제보 상세, `검증 회차` | 제보 공연의 회차 목록(ACTIVE/WITHDRAWN, revision, sourceVersion, 검증, 철회 시각), 등록, 근거 수정, 철회 |
| 제보 상세, `제보 회차 연결` | 현재 연결, ACTIVE 회차 선택 연결과 교체, 연결 철회, 연결 이력. 사람이 확인한 연결이며 이미지 분석의 공연 관찰값과 다른 기록이라고 표시합니다. |
| 분석 이력의 각 시도, `예매 후보 대조` | 실행 완료(SUCCEEDED) 분석만 실행 버튼, 모든 분석은 이력 보기. 실행 결과와 후보 실행 이력(상태, 사유, 적용 여부, 후보 개수, 내부 후보 참조, revision, 출처 버전, SHA-256) |

- 이미지 분석 응답의 `candidateMatch=NOT_LINKED`는 `분석 응답의 기존 대조 표시 (후보 실행과 별개)`로 이름을 바꾸어 후보 실행 이력과 분리했습니다.
- 회차는 팬 입력 공연 일시나 VLM 공연 일시 관찰값으로 자동 선택하지 않습니다. 선택 상자의 기본값은 비어 있습니다.
- `관찰값 수동 교정` 버튼은 계속 비활성입니다. 관찰값을 고치는 API가 없습니다.
- 7개 상태, 14개 사유, 7개 적용 여부에 각각 다른 문구를 씁니다. MATCH_CANDIDATE는 단일 조사 후보, NO_MATCH는 완전한 스냅샷 조회 성공 뒤 후보 없음, AMBIGUOUS, UNVERIFIABLE, LOOKUP_FAILED, ANALYSIS_FAILED는 후보 없음이 아님을 안내합니다. CURRENT가 아닌 실행은 현재 판단 근거로 쓰지 않는다고 표시하고 과거 기록은 바꾸지 않습니다.
- `candidateId`는 서버 내부의 불투명한 참조로만 표시하고 예매번호가 아니라고 안내합니다.

## 실패 처리

| 상황 | 처리 |
| --- | --- |
| 회차 쓰기 응답 유실 (네트워크, 계약과 다른 응답, 5xx) | 키가 없는 API라 같은 요청 재확인을 제공하지 않고 자동으로 다시 보내지 않습니다. 서버 목록을 다시 불러오지만 목록 상태로 이 요청의 성공을 확정하지 않습니다. 관리자가 `목록을 확인했고 새 요청을 보낼 수 있게 합니다`를 누를 때까지 새 요청을 막습니다. |
| 회차 쓰기 확정 거부 | `PERFORMANCE_REF_CONFLICT`, `PERFORMANCE_REVISION_CONFLICT`, `PERFORMANCE_WITHDRAWN`, 422, 403, 404를 고정 문구로 안내하고 목록을 다시 불러옵니다. |
| 회차 연결 `PERFORMANCE_LINK_CONCURRENT_UPDATE` (409) | `uncertainCodes`로 결과 미확인 처리합니다. 같은 키와 같은 본문으로만 재확인합니다. |
| 회차 연결 `PERFORMANCE_LINK_REVISION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `PERFORMANCE_LINK_ALREADY_CURRENT` | 확정 거부로 안내하고 이력을 다시 불러옵니다. 이전 요청이 반영되었는지는 추정하지 않습니다. |
| 후보 대조 응답 유실, 계약과 다른 응답, 다른 분석의 응답 | 결과 미확인으로 두고 같은 키로만 재확인합니다. 그동안 새 대조를 막습니다. |
| 후보 대조 `409 CANDIDATE_LOOKUP_IN_PROGRESS` | 진행 중으로 표시하고 같은 키로 재확인합니다. |
| 후보 대조 `503 CANDIDATE_LOOKUP_FAILED_UNRECORDED` | 실패 기록을 남겼는지 보장할 수 없다는 뜻이므로 결과 미확인으로 두고 같은 키로 수동 재확인만 허용합니다. 0건이나 실패로 확정하지 않고 새 키를 자동으로 만들지 않습니다. |
| 후보 대조 403, 404, 400 | 확정 거부로 안내합니다. 새 대조는 새 키로만 보냅니다. |
| 역할별 403 | 회차 영역의 403(예: ANALYST)과 후보 영역의 403(예: TENANT_ADMIN)은 각 영역에만 안내하고 다른 영역을 막지 않습니다. |

쓰기 뒤 목록과 이력을 다시 조회하는 동안에는 직전 목록을 계속 보여 주어 쓰기 결과 안내와 결과 미확인 차단 상태가 사라지지 않게 했습니다.

## 공통 변경 (승인 범위)

- `adminApiClient`: `method`에 `PATCH`를 추가했습니다. 기존 Bearer, 경로 검사, redirect 차단, credentials, cache, 401 처리는 그대로이고 키를 지정하지 않으면 `Idempotency-Key`를 붙이지 않습니다.
- `classifyMutation`: `OperationMessages.uncertainCodes`를 추가했습니다. 지정한 409 코드만 결과 미확인으로 분류하며 Case, 승인, PDF의 기존 메시지에는 지정하지 않아 동작이 같습니다.

## 계약 부족과 후속 연동

- TENANT_ADMIN은 Backend 391e285에서 팬 제보 상세 GET이 403입니다. 회차 API는 쓸 수 있지만 현재 회차 관리 화면은 제보 상세 안에 있어 TENANT_ADMIN의 화면 진입점이 없습니다(격리 Chrome E2E에서 확인). 공연 단위 회차 화면이나 상세 조회 역할은 별도 결정이 필요합니다.
- 회차 조회 응답에 검증 근거가 없어 수정할 때 다시 입력해야 합니다.
- 관찰값 수동 교정 API가 없어 수동 교정은 제공하지 않습니다.
- 후보 실행을 Case 출처로 연결하는 기능(Backend #70, 미병합)은 연결하지 않았습니다. Case 생성 화면은 기존 그대로입니다.
- 승인된 고객사 원본 예매 조회(candidateId 기반)는 계약상 후속 단계이며 제공하지 않습니다.

## 코드 배치

| 파일 | 내용 |
| --- | --- |
| `src/features/admin-track2/candidatePipelineApi.ts` | 스키마, 경로, 요청 본문, 상태와 사유, 적용 여부 문구, 쓰기 메시지 |
| `src/features/admin-track2/usePerformanceWrite.ts` | 키 없는 회차 쓰기 시도 관리 |
| `src/features/admin-track2/PerformancePanels.tsx` | 검증 회차, 제보 회차 연결 영역 |
| `src/features/admin-track2/candidateMatchRun.ts`, `useCandidateMatchRuns.ts` | 후보 대조 시도 분류와 분석별 시도 관리 |
| `src/features/admin-track2/CandidateMatchSection.tsx` | 분석별 후보 대조 실행과 이력 |

## 테스트

- `src/test/admin-track2-candidate.test.tsx`: 스키마와 UTC 해석, 문구 고유성, 회차 등록과 유실, 확정 거부, 수정 PATCH, 철회, 403과 404 영역 분리, 연결과 교체, 동시 변경 재확인 뒤 revision 충돌, 연결 철회와 키 재사용, 연결 이후 회차 변경 안내, 후보 실행과 중복 클릭, NOT_LINKED 분리, 모든 상태, 사유, 적용 여부, 응답 유실과 진행 중, 503 미기록, 403과 404, 다른 분석 응답, 실패 분석, 이력 페이지와 빈 이력, 이력 오류, 수동 교정 비활성
- `src/test/admin-api-client.test.ts`: PATCH와 메서드별 보안 옵션, `src/test/admin-case-workflow.test.tsx`: `uncertainCodes` 분류

## 격리 E2E 결과 (2026-11-05)

환경: Backend main 391e285를 `git archive`로 별도 디렉터리에 내보내 별도 Gradle 캐시로 빌드한 jar, 격리 MySQL 8.0.45(별도 datadir, 127.0.0.1:13306, Windows MySQL80 서비스와 데이터 미사용), HTTPS OIDC 대역 서버(Keycloak 아님), Vite 개발 서버, 시스템 Chrome headless. 합성 예매 적재 게이트는 SYNTHETIC_ISOLATED, 격리 UUID, 합성 HMAC 키로만 켰고 격리 DB에만 합성 등록 행을 넣었습니다.

팬 제보, 증거 메타데이터, 실행 완료 이미지 분석 행은 SQL로 만든 합성 행입니다. 따라서 이 결과는 후보 대조 파이프라인 E2E이며, 팬 제보 업로드, 원본 저장과 SHA-256 검증, 실제 Python 분석 전체 흐름은 검증하지 않았습니다. 합성 예매 적재는 실제 API로 실행했습니다.

- HTTP 13건 통과(2회 실행): 역할과 범위(ANALYST 회차 403, 다른 고객사 404, TENANT_ADMIN 후보 실행과 이력 403), 회차 등록과 `PERFORMANCE_REF_CONFLICT`, PATCH revision 충돌과 수정, 연결과 같은 키 재생, `IDEMPOTENCY_KEY_REUSED`, `PERFORMANCE_LINK_REVISION_CONFLICT`, `PERFORMANCE_LINK_ALREADY_CURRENT`, 합성 적재 ACCEPTED와 응답의 예매번호 원문 부재, 연결 없음 UNVERIFIABLE, 단일 후보, 복수 후보, 후보 없음, 좌석 미확인, 분석 실패, 같은 키 재생, 이력 페이지와 pageSize 상한 400, 응답에 예매번호와 HMAC 없음, 새 스냅샷 뒤 `RESERVATION_SOURCE_SUPERSEDED`와 새 NO_MATCH 분리, revision 변경 `PERFORMANCE_REVISION_CHANGED`, 철회 `PERFORMANCE_WITHDRAWN`과 이후 실행 UNVERIFIABLE, 철회 회차 연결 409, 연결 교체 `PERFORMANCE_LINK_REPLACED_OR_WITHDRAWN`
- Chrome 9건 통과: 회차와 현재 연결 표시와 자동 쓰기 없음, 연속 클릭 1회 후보 대조와 단일 조사 후보 표시, 응답 유실 뒤 같은 키 재확인, 자동 선택 없는 화면 회차 연결과 후보 없음 안내, 출처 교체 실행 표시, ANALYST 영역 분리, TENANT_ADMIN 상세 403, 다른 고객사 404, 모든 요청 Bearer와 저장소 무기록
- 실행 중 확인: Chrome 첫 실행의 B07은 TENANT_ADMIN이 제보 상세를 열 수 있다고 가정한 시험 오류였습니다. 실제 계약(상세 403)을 위 계약 부족으로 기록하고 새 합성 데이터로 HTTP와 Chrome을 다시 실행했습니다.

미검증: `CANDIDATE_LOOKUP_IN_PROGRESS`, `PERFORMANCE_LINK_CONCURRENT_UPDATE`, `CANDIDATE_LOOKUP_FAILED_UNRECORDED`의 실제 서버 발생(Mock 테스트로만 확인), 팬 제보 업로드와 원본 저장, 실제 Python 분석, 실제 Keycloak 로그인, 운영 환경
