# 관리자 승인 요청 및 독립 검토 결정 실제 API 연동 (Issue #33)

검토 담당(REVIEWER)이 Case의 최신 보고서 초안과 EvidenceSnapshot을 승인 요청으로 고정하고, 독립된 승인 담당(APPROVER)이 봉인된 검토 패키지를 확인한 뒤 일회용 영수증으로 승인 또는 반려를 기록합니다. 검토 담당은 결정 전 요청을 철회할 수 있습니다.
기준: Frontend main 9f3ba8a, Backend main 17c832b (W08a, W08b, #47 병합 포함). 공식 PDF 발급과 다운로드는 이번 범위가 아니며 계속 비활성입니다. 승인 결정은 부정 거래 확정이나 자동 제재가 아닙니다.

## 사용하는 API

Backend 계약은 변경하지 않았습니다. 기준 문서는 Backend `docs/api/case-w08a-v1.yaml`, `docs/api/case-w08b-v1.yaml`입니다. 제안 문서 `case-approval-v1-proposal.yaml`은 사용하지 않았습니다.

| 업무 | API | 역할 | 성공 | 요청 |
| --- | --- | --- | --- | --- |
| 승인 요청 | `POST /api/v1/cases/{caseId}/approval-requests` | REVIEWER | 201 View | `Idempotency-Key`, `reportVersionId, evidenceSnapshotId, expectedCaseVersion, expectedReportVersion, expectedReportContentSha256, reason` |
| 요청 상세 | `GET /api/v1/approval-requests/{id}` | TENANT_ADMIN, REVIEWER, APPROVER | 200 View | 없음 |
| 검토 패키지 | `GET /api/v1/approval-requests/{id}/review-package` | APPROVER | 200 ReviewPackage | 없음 (상태 변경 없음) |
| 영수증 발급 | `POST /api/v1/approval-requests/{id}/review-package` | APPROVER | 201 Receipt | 본문 없음, 멱등 API 아님 |
| 결정 | `POST /api/v1/approval-requests/{id}/decision` | APPROVER | 201 DecisionView | `Idempotency-Key`, `outcome, reason, evidenceSnapshotId, manifestSha256, reportContentSha256, reviewReceiptToken, reviewConfirmed=true, expectedCaseVersion, expectedRequestVersion, expectedReportVersion` |
| 철회 | `POST /api/v1/approval-requests/{id}/withdraw` | REVIEWER | 200 WithdrawView | `Idempotency-Key`, `reason, expectedCaseVersion, expectedRequestVersion, expectedReportVersion` |
| 철회 준비 | `GET /api/v1/cases/{caseId}`, `GET /api/v1/report-versions/{id}` | REVIEWER | 200 | 철회 직전 최신 Case와 보고서 버전 확인 |

- 응답의 `approvalEligibility`, `issuanceEligibility`는 계약상 항상 `BLOCKED`이며 다른 값은 계약 위반으로 처리합니다.
- 결정 본문의 `expectedCaseVersion`, `expectedReportVersion`은 검토 패키지의 `caseVersion`, `reportVersion`, `expectedRequestVersion`은 요청 상세의 `version`을 씁니다. APPROVER는 Case 상세 조회 역할이 없기 때문입니다.
- 현재 계정의 역할을 조회하는 API가 없어 화면은 역할을 추정하지 않습니다. 동작을 모두 표시하고 서버 403 뒤에만 해당 동작을 막습니다.

## 화면 구성

| 위치 | 내용 |
| --- | --- |
| Case 상세, 보고서 초안 아래 `승인 요청 제출` | 초안 목록 첫 페이지의 가장 높은 개정이 현재 증거 개정 번호의 DRAFT일 때만 대상과 digest를 표시하고 사유를 받아 요청합니다. 초안 영역의 조회 결과를 함께 써 같은 목록을 다시 요청하지 않습니다. 성공하면 요청 상세로 이동합니다. |
| `/app/approvals` (인증 세션) | 승인 요청 ID 입력 화면입니다. 승인 대기 목록 API가 없어 실제 대기열이 아님을 표시합니다. 개발 전용 미리보기에서는 기존 합성 데모 화면을 유지합니다. |
| `/app/approvals/{approvalRequestId}` | 요청 개요(상태, 고정 근거 ID, revision, digest, 요청자 멤버십 ID, 사유), 철회 영역, 독립 검토와 결정 영역, 비활성 공식 PDF 버튼 |

- 검토 패키지는 `검토 패키지 조회`를 누를 때만 불러옵니다. 패키지가 요청의 고정 근거(Case, 공연, Snapshot, 증거 개정, manifest digest, 보고서, 개정, 본문 digest, 템플릿)와 다르거나, 보고서 본문이 같은 Snapshot, manifest, 템플릿에 묶여 있지 않거나, JSON을 해석하지 못하면 신뢰할 수 없다고 표시하고 영수증 발급을 막습니다.
- 봉인된 JSON은 `JSON.parse` 결과를 React 텍스트 노드로만 그립니다. HTML 해석, `dangerouslySetInnerHTML`, 링크 생성은 하지 않습니다.
- 서버 오류 상세 메시지는 표시하지 않고 `code`별 고정 문구만 표시합니다.

## 일회용 영수증

- 영수증 원문은 발급 뒤 검토 영역의 영수증 훅(`useReviewReceipt`) `ref`에 둡니다. 결정 POST를 보낸 뒤에는 결정 요청의 멱등성 재확인용 메모리(결정 mutation의 `ref`)에도 같은 `Idempotency-Key`, 같은 결정 본문과 함께 원문이 남습니다. 전송 중이거나 결과가 불확실한 동안 같은 본문으로 재확인하기 위한 것이며, 결정이 확정되거나 서버가 확정 거부하면 함께 폐기합니다.
- 두 곳 모두 브라우저 메모리이며 React 상태, URL, localStorage, sessionStorage, 로그, 오류 문구에 넣지 않습니다. 화면에는 영수증 ID와 서버 만료 시각만 표시합니다.
- 만료는 브라우저 절대 시계 대신 단조 시계(`performance.now()`)로 계산합니다. 서버 `expiresAt - issuedAt`을 발급 요청 시작 직전 시각부터 적용해 응답 수신까지 걸린 시간을 보수적으로 빼고, 5초 일찍 폐기합니다. 응답을 받았을 때 남은 시간이 없으면 바로 폐기합니다. 타이머가 늦게 실행될 수 있으므로 결정 본문을 만들 때도 만료를 다시 확인합니다. 서버 판정을 대신하지 않습니다.
- 영수증 발급 POST는 멱등 API가 아니므로 응답을 받지 못해도 자동으로 다시 보내지 않습니다. 결과 미확인 안내 뒤 사용자가 `새 영수증 발급`을 눌러야 다시 보냅니다. 서버는 같은 승인자의 이전 미사용 영수증을 취소합니다.
- 화면 이탈, 로그아웃, 세션 만료로 화면이 사라지면 두 메모리의 원문, 타이머, 대기 요청을 정리합니다. 결과 미확인 상태로 떠난 경우에도 원문과 본문은 버리고 요청 ID만 세션 메모리에 남겨 재진입 시 서버 상태로 확인합니다.

## 결정 결과 미확인과 영수증 만료

| 상황 | 처리 |
| --- | --- |
| 결정을 보내기 전에 영수증 만료 | 원문을 폐기하고 새 영수증 발급을 안내합니다. 결정을 보내지 않습니다. |
| 결정 POST 응답 유실 (네트워크, 계약과 다른 응답, 코드 없는 5xx, 503) | 결과 미확인으로 두고 같은 `Idempotency-Key`와 같은 본문(원문 포함)으로만 재확인합니다. 영수증 만료 시각이 지나도 버리지 않습니다. Backend `decide()`는 저장된 같은 키의 결과를 먼저 재생하기 때문입니다. |
| 결과 미확인 동안 | 새 영수증 발급과 새 결정 요청을 막고, 실패나 미처리로 확정하지 않습니다. |
| 재확인이 확정 응답을 받음 | 성공이면 결과를 표시하고, 서버가 거부하면(예: 저장된 결과가 없고 영수증이 만료된 `REVIEW_RECEIPT_EXPIRED`) 그 문구를 표시하고 영수증을 폐기합니다. |
| 결과 미확인 상태로 화면 이탈 | 원문, 키, 본문은 폐기하고 요청 ID만 현재 관리자 세션 메모리에 기록합니다. 재진입하면 불확실성을 안내하고 요청 상세를 서버에서 다시 조회합니다. 서버가 요청을 닫았으면 그 상태로 해소하고, 아직 PENDING이면 결과를 확정하지 않은 채 사용자가 서버 상태를 확인했다고 명시한 뒤에만 새 검토를 엽니다. |
| 로그아웃, 세션 만료 | 관리자 화면 전체가 사라지며 재진입 기록도 함께 사라집니다. 다시 로그인한 뒤에는 요청 상세의 서버 상태로만 확인합니다. |

결정이 확정되거나 서버가 확정 거부하면 영수증을 폐기하고 요청 상세를 다시 조회합니다. 승인 요청과 철회는 기존 `useCaseMutation`의 같은 키 재확인 규칙을 그대로 씁니다.

## 실패 안내

| 코드 | 안내 |
| --- | --- |
| 403 `SELF_APPROVAL_FORBIDDEN` | 자기 승인 차단. 공통 클라이언트는 403 본문에서 이 코드만 읽고, 코드가 없거나 다른 값, 잘못된 형식이면 기존 권한 오류로 처리합니다. |
| 403 그 밖 | 해당 역할(REVIEWER 또는 APPROVER) 없음, 동작을 막습니다. |
| 404 | 존재하지 않거나 다른 고객사 또는 권한 없는 공연의 요청. 구분하지 않습니다. |
| `REVIEW_RECEIPT_EXPIRED`, `REVIEW_RECEIPT_ALREADY_USED`, `REVIEW_RECEIPT_INVALID` | 만료, 재사용, 다른 승인자나 취소된 영수증 |
| `EVIDENCE_VERSION_MISMATCH`, `SOURCE_CHANGED`, `SOURCE_NOT_AVAILABLE`, `APPROVAL_BASIS_BLOCKED`, `APPROVAL_REQUESTER_ACCESS_REVOKED` | 근거 또는 요청자 권한 변경. 서버가 영수증 발급이나 결정 시점에 이를 확인하면 요청을 무효화할 수 있다고 안내하고 요청 상태를 다시 조회합니다. |
| `APPROVAL_REVIEW_MISMATCH`, `EVIDENCE_REVIEW_MISMATCH`, `REPORT_CONTENT_MISMATCH`, `TEMPLATE_NOT_RETAINED` | 봉인 기록 불일치. 서버가 자동으로 상태를 바꾸지 않으므로 사람이 확인해야 한다고 안내합니다. |
| `REQUEST_VERSION_CONFLICT`, `REPORT_VERSION_CONFLICT`, `CASE_VERSION_CONFLICT`, `APPROVAL_REQUEST_CLOSED`, `APPROVAL_REQUEST_ALREADY_PENDING`, `REPORT_REVISION_CLOSED`, `ISSUANCE_HOLD_ACTIVE`, `IDEMPOTENCY_KEY_REUSED` | 충돌 또는 차단. 서버 상태를 다시 조회합니다. 화면은 IssuanceHold나 STALE, BLOCKED 상태를 해제하지 않습니다. |

`INVALIDATED` 요청은 상태를 표시하지만, Backend #47은 영수증 발급과 결정 시점의 재검증에만 연결되어 있습니다. 근거 변경을 실시간으로 감지하는 listener나 주기 점검은 없으므로 화면도 그렇게 안내합니다.

## Backend 계약 부족과 후속 작업

- 승인 대기 목록 API가 없습니다. APPROVER가 처리할 요청을 찾는 실제 대기열은 완성되지 않았으며, 요청 ID 기반의 제한된 흐름만 제공합니다.
- Case 상세와 활동 이력에 승인 요청 ID가 없습니다. 승인 대기 중인 Case 화면에서 요청 상세로 바로 이동할 수 없고, 요청 생성 직후 이동한 주소나 전달받은 ID가 필요합니다.
- 현재 계정의 역할 조회 API가 없어 역할별 화면 분기를 하지 않습니다.
- 멤버십 ID를 이름으로 바꾸는 API가 없어 요청자와 결정자는 ID로만 표시합니다.
- 공식 PDF 발급과 다운로드 UI는 별도 Issue입니다. 승인 결정 응답도 `issuanceEligibility=BLOCKED`이며 화면의 공식 PDF 버튼은 비활성입니다.
- 파일 증거(EVIDENCE_ASSET)의 W06 원본 무결성, W07 Object Lock 보존 근거와 MinIO 연동은 이번 E2E에서 검증하지 않았습니다.
- 실제 개인정보를 사용하는 운영은 보존, 처리 정책 승인 전까지 제한됩니다.

## 코드 구성

| 파일 | 역할 |
| --- | --- |
| `src/features/admin-approvals/approvalApi.ts` | Zod 스키마, 경로, 요청 본문 생성과 응답 확인, 안내 문구 |
| `src/features/admin-approvals/useReviewReceipt.ts` | 영수증 발급(자동 재시도 없음), 메모리 보관, 만료, 폐기 |
| `src/features/admin-approvals/approvalAttempts.tsx` | 결정 결과 미확인 요청 ID의 세션 메모리 기록 |
| `src/features/admin-approvals/LiveApprovalRequestPage.tsx` | 요청 상세, 철회, 검토 패키지, 영수증, 결정, 재진입 안내 |
| `src/features/admin-approvals/ApprovalSubmitPanel.tsx` | Case 상세의 승인 요청 제출 |
| `src/features/admin-approvals/LiveApprovalEntryPage.tsx`, `ApprovalRoutes.tsx` | 요청 ID 입력, 인증 세션과 미리보기 화면 분기 |
| `src/api/adminApiClient.ts` | 403 허용 코드(`SELF_APPROVAL_FORBIDDEN`)만 읽는 최소 확장 |
| `src/features/admin-cases/caseWorkflowApi.ts` | 작업별 403 코드 문구(`forbiddenCodes`) |

## 검증

- `src/test/admin-approval-workflow.test.tsx`: 계약 경로와 스키마, 요청 본문, 승인 요청, 철회, 검토 패키지, 악성 HTML 비실행, 영수증 비노출, 영수증 자동 재시도 없음, 승인과 반려, 403과 자기 승인, 404 범위 비노출, 영수증 만료와 재사용, 발급 응답 지연과 타이머 지연 만료, digest 불일치, 버전 충돌, 응답 유실 재확인, 만료 직전 결정, 화면 이탈 후 재진입, 로그아웃, 중복 클릭
- `src/test/admin-api-client.test.ts`: 403 코드 허용 목록과 코드 없음, 잘못된 형식의 기존 처리 유지
### 격리 E2E (합성 데이터)

환경: Spring Boot jar(Backend main 17c832b 소스와 같은 빌드), 격리 MySQL 8.0.45(별도 datadir, 127.0.0.1:13306, Windows MySQL80 서비스와 데이터 미사용), HTTPS OIDC 대역 서버(Keycloak 아님, 합성 RS256 JWT), Vite 개발 서버, 시스템 Chrome headless(CDP). 영수증 TTL은 만료 시험을 위해 `PT30S`로 줄였습니다. 출처는 파일 없는 Track 1 저장 군집 증거뿐이며 MinIO와 W06/W07 경로는 쓰지 않았습니다.

- HTTP 15건 통과: 승인 요청 생성, 같은 키 재생과 다른 본문 거부, 중복 요청 `APPROVAL_REQUEST_ALREADY_PENDING`, 역할과 범위(ANALYST 403, 다른 공연 승인자와 다른 고객사 승인자 404), 검토 패키지 역할과 조회만으로 영수증 미생성, DB에 영수증 SHA-256만 저장, digest 변경 `APPROVAL_REVIEW_MISMATCH`, 오래된 요청 버전 `REQUEST_VERSION_CONFLICT`, 다른 승인자 영수증 `REVIEW_RECEIPT_INVALID`, 자기 승인 `SELF_APPROVAL_FORBIDDEN`(영수증 발급은 허용, 결정에서 차단), 재발급으로 취소된 이전 영수증 `REVIEW_RECEIPT_ALREADY_USED`, 승인 뒤 영수증 TTL이 지나도 같은 키와 본문은 같은 결정을 재생, 사용한 영수증의 새 키 결정 `APPROVAL_REQUEST_CLOSED`, 반려, 만료 영수증 `REVIEW_RECEIPT_EXPIRED`, 철회와 재생
- Chrome 15건 통과: Case 상세 승인 요청 제출(연속 클릭 1회)과 요청 상세 이동, 철회, REVIEWER 검토 패키지 403, 요청 ID 진입, 봉인 JSON의 HTML 비실행, 영수증 원문 비노출(화면, 주소, 저장소, 콘솔), 승인, 결정 응답 유실 뒤 TTL 경과 후 같은 키 재확인, 결정 전 영수증 만료와 재발급, 영수증 발급 응답 유실 시 자동 재시도 없음, 결과 미확인 이탈 후 재진입 해소, 다른 고객사 승인자 404, 자기 승인 안내, 로그아웃 정리, 모든 요청 Bearer와 페이지 예외 없음

첫 Chrome 실행의 1건 실패는 시험 스크립트의 요청 시간 범위가 직전 단계의 의도된 조회를 포함한 문제였으며, 범위를 고친 뒤 새 합성 데이터로 HTTP와 Chrome을 모두 다시 실행했습니다. 실제 Keycloak 로그인, MinIO Object Lock, 파일 증거의 승인 경로는 검증하지 않았습니다.
