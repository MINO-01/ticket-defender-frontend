# 관리자 Case 생성 및 조사 준비 실제 API 연동 (Issue #31)

관리자가 Track 1 군집과 Track 2 팬 제보에서 Case를 만들고, Case 상세에서 담당자 지정, 상태 전이, EvidenceSnapshot 생성, ReportVersion 초안 작성을 진행합니다.
기준: Frontend main fd50580, Backend main 17c832b. 승인 요청, 승인 결정, ReviewReceipt, 공식 PDF, 티켓 제재는 이번 범위가 아니며 계속 비활성입니다.

## 사용하는 쓰기 API

Backend 계약은 변경하지 않았습니다. 모든 쓰기 요청은 UUID v4 `Idempotency-Key`를 보냅니다(담당자 PUT 포함).

| 업무 | API | 성공 | 요청 본문 |
| --- | --- | --- | --- |
| Case 생성 | `POST /api/v1/cases` | 201 `CaseDto.View` | `eventId, type, graphClusters[{analysisRequestId, clusterId}], fanReportIds[], evidenceIds[], reason, relatedCaseId=null, relationReason=null` |
| 상태 전이 | `POST /api/v1/cases/{caseId}/transitions` | 200 `CaseDto.View` | `toStatus, expectedCaseVersion, reason, classification, unassignedReason, missingEvidence, requestedAction, unavailableReason, dismissalBasis` (해당 없는 필드는 null) |
| 담당자 | `PUT /api/v1/cases/{caseId}/assignee` | 200 `CaseDto.View` | `assigneeMembershipId, expectedCaseVersion, reason` |
| Snapshot 생성 | `POST /api/v1/cases/{caseId}/evidence-snapshots` | 201 `Snapshot` | `expectedCaseVersion, reason` |
| Snapshot 목록, 상세 | `GET .../evidence-snapshots?page&pageSize=20`, `GET .../evidence-snapshots/{snapshotId}` | 200 | 목록은 `evidenceRevision` 내림차순 |
| 초안 작성 | `POST /api/v1/cases/{caseId}/report-versions` | 201 `Draft` | `expectedCaseVersion, evidenceSnapshotId, title, assessment, limitations, conclusion, reason` |
| 초안 목록 | `GET .../report-versions?page&pageSize=20` | 200 | `revision` 내림차순 |

### 역할 (Backend 기준)

| 업무 | 허용 역할 | 그 밖의 역할 |
| --- | --- | --- |
| Case 생성 | ANALYST, REVIEWER | TENANT_ADMIN, APPROVER는 403 |
| 상태 전이, 담당자, Snapshot, 초안 | REVIEWER | ANALYST, TENANT_ADMIN, APPROVER는 403 |
| 담당자 대상 | 같은 고객사 활성 멤버, 해당 공연 권한, ANALYST 또는 REVIEWER 역할 | 역할 없음 422 `ASSIGNEE_ROLE_INVALID`, 범위 밖 404 |

현재 계정의 역할을 조회하는 API가 없어 화면은 역할을 추정하지 않습니다. 동작을 표시하고, 서버가 403을 반환하면 그 Case 상세의 REVIEWER 전용 동작을 모두 막습니다.

### 서버 규칙과 화면 사전 확인

- 유형: 군집만 `GRAPH_CLUSTER`, 제보만(증거 선택 가능) `FAN_REPORT`, 둘 다 `COMBINED`. 증거만 단독 연결 불가, 출처 최대 30개, 중복 불가.
- 분석 요청 ID는 소문자 UUID 문자열만 연결됩니다. 다른 형식의 군집은 생성 버튼을 막고 사유를 표시합니다.
- 제보는 `RECEIVED`이고 보존 기한이 남은 경우만 연결됩니다. 증거는 원본 저장이 확인된 항목만 선택할 수 있습니다.
- 상태 전이: `OPEN → TRIAGED`(분류 필수, 담당자 없으면 미지정 사유 필수), `TRIAGED → IN_REVIEW`, `IN_REVIEW → NEEDS_EVIDENCE`(부족한 자료, 요청할 조치), `NEEDS_EVIDENCE → IN_REVIEW`(자료를 받지 못한 사유), `IN_REVIEW → DISMISSED`(종결 근거, 사유 10자 이상). OPEN 이외 전이는 유효한 담당자가 필요합니다. 승인 대기 이후 상태와 CLOSED 전이는 제공하지 않습니다.
- Snapshot과 초안은 `IN_REVIEW`에서만 가능합니다. 현재 `evidenceRevision`의 Snapshot이 이미 있으면 생성 버튼을 막고, 초안은 현재 `evidenceRevision`의 Snapshot만 선택할 수 있습니다.
- 입력 길이는 서버와 같은 기준(Java `trim()` 후 최소, 원문 최대)으로 확인합니다. 보고서 본문은 XML 1.0 비허용 문자를 거부합니다. 최종 판단은 항상 서버입니다.

## 코드 구성

- `src/features/admin-cases/caseWorkflowApi.ts`: 쓰기 경로, Snapshot과 초안 Zod 스키마, 요청 생성과 입력 검증, 결과 분류, 업무별 오류 문구
- `src/features/admin-cases/useCaseMutation.ts`: 쓰기 시도 상태, 멱등 키, 연속 클릭 차단, 결과 미확인 시 같은 키 재확인, 화면 이탈 시 요청 취소
- `src/features/admin-cases/CreateCasePanel.tsx`, `MutationStatus.tsx`: Case 생성 영역과 결과 안내
- `src/features/admin-cases/CaseWorkflowPanels.tsx`: 상태 변경, 담당자, EvidenceSnapshot, 보고서 초안 영역
- `src/features/admin-track2/FanReportCasePanel.tsx`: 제보 상세의 증거 선택과 선택적 군집 연결(COMBINED)
- 연결 화면: `LiveClusterDetailPage.tsx`, `LiveFanReportDetailPage.tsx`, `LiveCaseDetailPage.tsx`
- 공통 변경: `adminApiClient`가 PUT에도 검증된 `Idempotency-Key`를 붙입니다(GET은 계속 거부). `useAdminQuery`에 선택 인자 `refreshKey`를 추가해 입력을 유지한 채 목록을 다시 조회합니다.

## 멱등성, 충돌, 응답 유실

- 새 키는 관리자가 새 요청을 보낼 때만 만들고, 키와 본문은 메모리에만 둡니다(브라우저 저장소, 로그에 남기지 않음).
- 결과 분류: 성공(응답이 요청한 Case, 공연, 유형, 상태와 맞을 때만), 거부(서버 확정 오류, 새 키로 다시 요청 가능), 충돌(409 `CASE_VERSION_CONFLICT`), 결과 미확인(네트워크 오류, 계약과 다른 응답, 계약 코드 없는 5xx, 503 `DEPENDENCY_UNAVAILABLE`).
- 결과 미확인이면 새 요청과 입력 변경을 막고 같은 키와 같은 본문으로만 재확인합니다. 서버는 기록된 결과를 돌려주며 다시 처리하지 않습니다.
- 성공과 충돌 뒤에는 서버의 최신 Case, 활동 이력, Snapshot과 초안 목록을 다시 조회합니다. 재조회 중에는 직전 Case를 보이되 모든 쓰기를 막아 오래된 `caseVersion`으로 요청하지 않습니다.
- 로그아웃, 세션 만료, 화면 이탈 시 대기 요청을 취소하고 늦은 응답은 버립니다.

## 무결성과 보존 실패 구분

- 생성: 422 `SOURCE_NOT_AVAILABLE`(접수 상태, 보존 기한, 저장 상태)과 422 `SOURCE_OBJECT_MISMATCH`, `SOURCE_OBJECT_MISSING`(원본 객체 불일치, 부재)을 서로 다른 문구로 안내합니다. 409 `SOURCE_ALREADY_LINKED`, `SOURCE_CHANGED`도 구분합니다.
- Snapshot의 `sourceIntegrity`는 `METADATA_ONLY`(메타데이터 대조, 원본 바이트 재검증 아님), `NO_FILE`(파일 증거 없음)로만 표시합니다. 승인 가능 여부는 서버의 `approvalEligible` 값만 표시하며 화면에서 계산하지 않습니다.
- `manifestJson`, `contentJson`은 응답 존재만 확인하고 파싱 결과에서 제거해 화면, 상태, 로그에 남기지 않습니다.
- 초안은 `DRAFT`를 "초안 (승인 아님)"으로 표시하고 `renderable`, `approvalEligible`은 서버 값만 표시합니다.

## 테스트

- 단위와 화면(Vitest, Mock 인증과 fetch): `src/test/admin-case-workflow.test.tsx` 40건. 경로, 스키마, 유형 계약, 입력 검증, 결과 분류, Track 1과 Track 2 생성(정상, 중복 클릭, 403, 404, 409, 422, 응답 유실 재확인, 다른 공연이나 유형 응답, 로그아웃), 상태 전이, 담당자, 버전 충돌, 403 잠금, Snapshot, 초안.
- 기존 회귀: Case 조회, Track 1, Track 2, 증거 미리보기, 분석 실행 테스트에서 이전 비활성 단언을 새 동작(Case 생성 영역 제공, 자동 생성 없음, 승인과 PDF 비활성)으로 갱신했습니다. 삭제하거나 Skip한 테스트는 없습니다.
- 전체: typecheck, lint, build 통과, Vitest 19개 파일 444건 통과.

## 실제 HTTP 및 Chrome E2E 결과 (2026-11-04)

격리 환경: 저장소 밖 `D:\td-e2e-fe31`. Spring은 Backend main 17c832b(소스 210개 파일 일치 확인) jar, MySQL 8.0.45 별도 datadir(127.0.0.1:13306, Windows MySQL80 서비스 미사용), 새로 만든 비밀값과 테스트 CA. 데이터는 모두 합성입니다.

- 인증: HTTPS OIDC 대역 서버(keycloak-js 호환, RS256 JWT)이며 실제 Keycloak이 아닙니다.
- 증거 원본: S3 HEAD 대역 서버이며 MinIO가 아니고 Object Lock, 원본 바이트를 검증하지 않습니다.
- 실제 HTTP 16건 통과: 생성 3유형, 같은 키 재전송과 다른 본문 409, `SOURCE_ALREADY_LINKED`, TENANT_ADMIN과 APPROVER 403, 다른 고객사, 공연, 제보 404, `SOURCE_NOT_AVAILABLE`과 `SOURCE_OBJECT_MISMATCH` 구분, ANALYST 쓰기 403, `CASE_VERSION_CONFLICT`, 담당자 422, 404, 409와 재전송, 전이 규칙, Snapshot 생성과 재전송과 `SNAPSHOT_ALREADY_EXISTS`, 초안 DRAFT와 `REPORT_CONTENT_UNCHANGED`. Frontend 스키마와 분류 함수로 실제 응답을 검증했습니다.
- Chrome(CDP, headless) 13건 통과: 군집에서 생성(연속 클릭 POST 1회), 담당자 지정, 다른 사용자 변경 후 409 충돌과 재조회, OPEN에서 IN_REVIEW까지 전이, Snapshot 생성과 상세 재확인, 초안 저장과 표시, 승인과 PDF 비활성, 제보에서 생성 중 응답 유실 후 같은 키 재확인(Case 1건), 접수 실패 제보 차단, ANALYST 403 잠금, 대기 중 로그아웃 정리, 모든 요청 Bearer와 페이지 예외 없음.
- 미실행: 실제 Keycloak 로그인, 실제 MinIO와 Object Lock, 운영 빌드(vite preview) 화면.

## 미구현, 계약 갭, 후속 작업

- 계약 갭: 현재 계정의 역할과 멤버십 ID 조회 API 없음, 담당자 후보 목록과 이름 조회 API 없음(멤버십 UUID 직접 입력), 출처 추가 API 없음(`NEEDS_EVIDENCE → IN_REVIEW`는 미수신 사유로만 재개), 초안 단건 조회 경로 없음(목록만).
- 후속 Case(`relatedCaseId`, `relationReason`) 연결 UI는 제공하지 않습니다.
- 후속 Issue: ApprovalRequest 생성과 결정, ReviewReceipt, 공식 PDF 발급과 다운로드 화면. 이번 화면의 승인 요청, 공식 PDF 버튼은 비활성이며 관련 API를 호출하지 않습니다. 공식 PDF는 실제 개인정보에 대해 정책 결정 전까지 비활성이어야 합니다.
