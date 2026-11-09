# Frontend가 요청한 Backend 조회 계약과 실제 구현 비교

최초 작성 기준: Frontend `feat/capstone-demo-ux-20261108`, Backend `origin/main` 7eb2f0b (2026-11-08)
비교 갱신 기준: Backend `feat/capstone-demo-integration-20261108` e37a1a5, 계약 문서 `docs/api/capstone-demo-integration-v1.md`

이 문서의 1~7번은 Frontend가 처음 요청한 **초안**입니다. 아래 비교 표는 Backend가 실제로 구현한 계약과 Frontend 연결 상태를 정리합니다. Frontend는 실제 DTO에 있는 필드와 enum만 사용하며, 아직 없는 API는 호출하지 않고 화면에 "Backend 계약 대기"로 표시합니다.

## 공통 원칙

- 모든 조회는 기존 관리자 인증(Bearer)과 tenant, event 범위 검사를 따릅니다. 범위 밖이면 404, 역할이 없으면 403을 반환합니다.
- 원본 예매번호, 실명, 연락처, 원본 HMAC 입력값, 객체 저장소 키, 자격 증명은 응답에 넣지 않습니다.
- 분석 실패, 확인 불가, 미실행은 서로 다른 값으로 반환합니다. 실패를 빈 목록으로 바꾸지 않습니다.

## 비교 표

| 번호 | 항목 | Backend 실제 계약 (e37a1a5) | Frontend 연결 | 상태 |
|---|---|---|---|---|
| 1 | 관리자 제보 접수번호 | 기존 제보 목록과 상세에 `receiptNumber` 추가 | `track2Api.ts` 선택 필드(null 허용), 목록과 상세에 우선 표시, 없으면 없음 안내 | 연결 완료 |
| 2 | 연결된 예매 그룹 공유 근거 | 별도 API 대신 기존 군집 상세에 `relationship` 추가 (`DEVICE_ID_HASH`, `IP_HASH` 요약만) | `track1Api.ts` 스키마, 예매 그룹 상세의 공유 근거 요약 | 연결 완료 (결제, 주소 근거는 서버 미제공) |
| 3 | 분석 작업 조회 | `GET /api/v1/admin/analysis-runs` (Track 2 이미지 정보 추출 실행만, totalItems 없음) | `operationsApi.ts`, 분석 작업 화면의 실행 이력 | 부분 연결 (통합 작업 이력은 미구현) |
| 4 | 감사 기록 조회 | `GET /api/v1/cases/{caseId}/approval-audit-events` (조사 사건별 승인 감사만) | `caseLinkApi.ts`, 조사 사건 상세와 감사 기록 화면 | 부분 연결 (고객사 전체 감사 로그는 미구현) |
| 5 | 내 역할과 설정 조회 | `GET /api/v1/admin/operations/settings?eventId` (TENANT_ADMIN, 기능 상태만) | `operationsApi.ts`, 설정 화면 운영 상태 | 부분 연결 (사용자 역할 목록 `/admin/me`, AUDITOR는 미구현) |
| 6 | 승인 요청 목록 | 미구현 | 승인 요청 ID나 조사 사건 업무 연결 링크로 엽니다 | 대기 |
| 7 | 승인 결정 조회 | 전체 목록은 미구현. `GET /api/v1/cases/{caseId}/workflow`의 `approval`에 결정 ID와 결과 포함 | `caseLinkApi.ts`, 조사 사건 업무 연결에서 승인 요청과 발급 화면으로 이동 | 사건 단위 연결 완료, 전체 목록 대기 |

### 실제 계약을 쓸 때 지키는 점

- `receiptNumber`는 업무용 번호이며 제보자 신원이 아닙니다. 조회 비밀, 복구 코드, 팬 신원정보는 요청하거나 표시하지 않습니다.
- `relationship.verifiedConnectionCount`는 신호별 비순서 구성원 쌍의 합계라 중복될 수 있습니다. 화면은 "고유한 예매 연결 수가 아님"을 함께 표시하고, `normalSharingNotice`를 항상 보여 줍니다. 신호 값, HMAC, 그래프 간선은 응답에 없으므로 그래프를 만들지 않습니다.
- `analysis-runs`의 `coverage`는 `PERSISTED_TRACK2_LISTING_CONTEXT_ANALYSES_ONLY`만 받습니다. 실행 상태와 분석 결과 상태를 나눠 표시하고 실패 실행을 숨기지 않으며, 전체 건수를 계산하지 않습니다.
- `workflow`의 `report`, `approval`, `officialPdf`는 null이면 "없음"으로 표시합니다. `nextStep`은 안내 문구로만 보여 주고 버튼 권한이나 PDF 발급 가능 여부 판단에 쓰지 않습니다. 발급 가능 여부는 기존 `official-pdf-eligibility`가 판단합니다.
- 승인 감사 이력은 조사 사건 활동 기록과 별도 영역으로 보여 주며 하나의 전역 감사 기록으로 합치지 않습니다.
- `operations/settings`는 로그인한 사용자의 역할 목록이 아닙니다. 403이면 고객사 관리자 역할이 필요하다고 안내하고 역할을 추정하지 않습니다. 설정 변경 기능은 없습니다.

### 여전히 미구현인 Backend 기능

- 승인 요청 전체 목록, 승인 결정 전체 목록
- 고객사 전체 감사 로그
- Track 1과 Track 2를 합친 통합 분석 작업 이력 (Track 1 실행 요청 저장 모델 없음)
- 로그인한 관리자의 전체 역할 조회 (`/admin/me`)
- AUDITOR 역할과 운영 권한 (정책 결정 필요)

`/api/v1/audits/**`는 레거시 분석 및 PDF 409 차단용 엔드포인트이며 감사 기록 조회 API가 아닙니다. Frontend는 이를 감사 기록으로 사용하지 않습니다.

## 실제 캡처 조사 시연 연결 현황

확인 기준: Frontend main d3d6921, Backend main 576cc9c (PR #78, #47 병합 후 2026-11-09)

| 단계 | 화면 | Backend API | 상태 |
|---|---|---|---|
| 캡처 업로드와 접수번호 확인 | `/fan/write`, `/fan/review` | 기존 팬 제보 접수 API | 연결 완료 |
| 원본 조회, 이미지 정보 추출, 실행 상태, 필드별 관찰값 | 관리자 제보 상세 | 기존 증거 원본 조회, 분석 실행, 분석 이력 API | 연결 완료 |
| 검증 회차 연결과 후보 대조 | 관리자 제보 상세 | 기존 검증 회차, 회차 연결, 후보 대조 실행과 이력 API | 연결 완료 |
| 제보, 증거, 후보 실행, 군집의 Case 출처 전달 | 관리자 제보 상세의 Case 생성 영역 | 기존 Case 생성 API | 연결 완료 |
| Track 2 후보 출처 Case의 승인 차단 안내 | 제보 상세, Case 상세 | 기존 승인과 PDF 적격성 API | 연결 완료 |
| 군집 구성원의 원장 좌석 | 군집 상세의 구성원 원장 좌석 영역 | `GET /api/v1/admin/track1/clusters/detail` + `performanceId`, `sourceVersion` | 연결 완료 |
| `LINKED`, `NO_TRACK1_LINK`, `NOT_APPLICABLE`, `LEDGER_UNAVAILABLE` 수렴 상태와 원장 좌석 | Case 상세의 Track 1 연결 비교 영역 | `GET /api/v1/cases/{caseId}/track1-candidate-links` | 연결 완료 |
| Track 1 저장 간선 그래프 | 없음 | 제공하지 않음 (`track1-ledger-seat-read-v1`) | 공유 근거 집계만 표시 |

- 군집 구성원 응답은 `auditId`와 `ledgerSeat`만 사용합니다. 계정 식별자와 예매참조는 응답에도 화면에도 없습니다.
- 수렴 조회는 Case 생성 이후의 현재 조회이며 Case 생성 전 연결 여부로 표시하지 않습니다. 군집 상세의 원장 좌석 조회는 `LINKED` 판정을 만들지 않습니다.
- 저장된 간선 API가 없으므로 Cytoscape 그래프를 실제 데이터에 연결하지 않고, 공유 근거나 Risk Score로 간선을 추정하지 않습니다.
- 팬 작성 화면의 공연명은 공개 공연 목록 API가 없어 `VITE_FAN_REPORT_EVENT_LABEL` 설정값을 표시합니다. 관리자 화면의 공연명은 서버 응답을 사용합니다.
- 이미지 정보 추출과 후보 대조는 제보별로 관리자가 직접 눌러야 실행되며 자동 재시도, 일괄 실행 기능은 없습니다.

## 2026-11-09 Live API 통합 현황

기준: Backend main 576cc9c, Backend Issue #79 eed2106 (미병합). 아래 항목은 Mock fetch 테스트 기준이며 실제 Backend 연동 결과는 통합 보고서를 따릅니다.

| 영역 | 상태 | 내용 |
|---|---|---|
| 증거 무결성 검증과 평가 | 연결 완료 | `evidence-verifications`, `integrity-evaluation`. 기술 무결성과 승인 근거 적격성을 분리해 표시 |
| 전체 현황 미처리와 실패 | 연결 완료 | 기존 팬 제보 목록의 `intakeStatus` 필터 건수, 분석 실행 첫 페이지 요약 |
| 구매 한도 정책 조회 | 부분 연결 | #79 목록 API만 조회. 등록, 수정, 철회는 #79 완료 후 연결. API가 없는 서버는 404 안내 |
| Track 1 v2 한도 평가 결과 | BLOCKED | Spring v2 소비자와 조회 API 없음 |
| Track 1 분석 실행 | BLOCKED | 관리자 실행 API 없음. `/api/v1/audits/analyze`는 레거시로 공통 클라이언트가 차단 |
| Track 1 관계 그래프 | BLOCKED | 저장 간선 API 없음. 공유 근거 집계만 표시 |
| 내 역할, 고객사 표시 | BLOCKED | `/admin/me` 없음. 접근 가능 공연만 서버 값으로 표시 |
| 승인 요청 목록, 승인 대기 건수, 보고서 상태 집계 | BLOCKED | 목록 및 집계 API 없음 |
| Track 2 후보 현황 집계 | BLOCKED | 공연 단위 후보 집계 API 없음 |
| 예매 반입 이력과 배치 조회 | BLOCKED | 반입 POST 응답만 존재, 조회 API 없음 |
| 고객사 전체 감사 로그, 통합 분석 작업 이력 | BLOCKED | 조회 API 없음 |

## Backend PR #80 (Issue #79, 82c5899) 연동 현황

PR #80이 병합되지 않은 서버에서는 정책 API가 403을 돌려주며, 화면은 이를 빈 정책으로 바꾸지 않습니다.

| 영역 | 상태 | 내용 |
|---|---|---|
| 정책 조회, 등록, 수정, 철회 | 연결 완료 | `PATCH`와 `expectedRevision` 사용. 멱등 키가 없어 결과 불확실 시 재전송하지 않고 목록을 다시 확인 |
| 회차별 정책 현황과 분석 준비 안내 | 연결 완료 | 정책 값으로 계산한 안내이며 서버 평가 결과가 아님 |
| `seats[]`, `linkBasis` | 연결 완료 | 이전 서버 응답도 허용. 연결 근거는 예매 참조 일치일 뿐 티켓 단위 동일성이 아님 |
| `purchaseLimitEvaluations`, `accountLimitFindings` 표시 | BLOCKED | Spring 내부 서비스만 있고 조회 API와 저장 모델 없음 (`TRACK1_V2_ENABLED` 기본 꺼짐) |
| 정책 변경 감사 이력 조회 | BLOCKED | 저장은 하지만 조회 API 없음 |
| 다좌석 반입의 `ticketReference` 입력 | OPEN | 서버 필드는 있으나 반입 화면 입력 형식은 미반영 |

필요한 조회 계약 예시: `GET /api/v1/admin/events/{eventId}/purchase-limit-evaluations?performanceId&page&pageSize`. 응답은 분석 요청 ID, 회차, `status`, `policyVersion`, 계정별 수량과 finding을 담고, 평가하지 못한 회차를 빈 목록으로 합치지 않아야 합니다.

## 최초 요청 초안 (참고)

아래 1~7은 실제 구현 전에 Frontend가 제안한 형태입니다. 실제 경로와 필드는 위 비교 표와 Backend 계약 문서를 따릅니다.

## 1. 관리자 제보 접수번호

기존 `GET /api/v1/admin/fan-reports`와 `GET /api/v1/admin/fan-reports/{fanReportId}` 응답에 필드 하나를 추가합니다.

```json
{ "fanReportId": "uuid", "receiptNumber": "TD-20261108-000123", "...": "기존 필드 유지" }
```

- `receiptNumber`: 팬 접수 응답(`FanReportReceipt.receiptNumber`)과 같은 값, 최대 40자. 조회 코드(`lookupCode`)는 절대 넣지 않습니다.
- 선택 사항: 목록에 `receiptNumber` 정확 일치 검색 파라미터.
- Frontend 현황: `track2Api.ts` 스키마에 선택 필드로 이미 받도록 했습니다. 값이 없으면 "접수번호 미제공"과 제보 ID 앞부분을 표시하며 번호를 만들지 않습니다.

## 2. 연결된 예매 그룹 공유 근거

```
GET /api/v1/admin/track1/clusters/detail/shared-evidence?eventId={uuid}&analysisRequestId={id}&clusterId={id}
```

```json
{
  "event": { "id": "uuid" },
  "analysisRequestId": "id",
  "clusterId": "id",
  "coverage": "STORED_EVIDENCE_ONLY",
  "signals": [
    { "signalType": "PAYMENT_TOKEN | DEVICE_TOKEN | CONTACT_TOKEN | ADDRESS_TOKEN | ...", "memberAuditIds": [101, 102], "tokenScope": "TENANT_SIGNAL_SCOPED" }
  ],
  "edges": [
    { "fromAuditId": 101, "toAuditId": 102, "signalTypes": ["PAYMENT_TOKEN"] }
  ]
}
```

- 공유한 값 자체(토큰 원문 포함)는 반환하지 않고 신호 유형과 구성원 관계만 반환합니다.
- 저장되지 않은 관계는 반환하지 않으며, 화면도 간선을 추론하지 않습니다.

## 3. 분석 작업 조회

```
GET /api/v1/admin/analysis-jobs?eventId={uuid}&type={type}&status={status}&page=0&pageSize=20
```

```json
{
  "event": { "id": "uuid", "name": "..." },
  "items": [
    {
      "jobId": "uuid",
      "type": "LISTING_ANALYSIS | CANDIDATE_MATCH | TRACK1_ANALYSIS",
      "executionStatus": "기존 실행 상태 enum 그대로",
      "resultStatus": "기존 결과 상태 enum 또는 null",
      "fanReportId": "uuid 또는 null",
      "evidenceId": "uuid 또는 null",
      "analysisRequestId": "id 또는 null",
      "createdAt": "offset date-time",
      "finishedAt": "offset date-time 또는 null",
      "errorCode": "코드 또는 null"
    }
  ],
  "page": 0, "pageSize": 20, "totalItems": 0, "hasNext": false
}
```

- 역할: ANALYST, REVIEWER (기존 제보 목록과 같게).
- 현재 화면은 접수 상태(`ANALYSIS_FAILED`, `ANALYSIS_PENDING`, `STORAGE_FAILED`) 건수만 기존 목록 API로 보여 줍니다.

## 4. 감사 기록 조회

```
GET /api/v1/admin/audit-events?eventId={uuid?}&action={action?}&from={date-time?}&to={date-time?}&page=0&pageSize=50
```

```json
{
  "items": [
    {
      "auditEventId": "uuid",
      "occurredAt": "offset date-time",
      "actorMembershipId": "uuid",
      "actorRole": "TENANT_ADMIN | ANALYST | REVIEWER | APPROVER",
      "action": "EVIDENCE_VIEWED | CASE_TRANSITIONED | APPROVAL_DECIDED | OFFICIAL_PDF_DOWNLOADED | ...",
      "targetType": "FAN_REPORT | EVIDENCE | CASE | APPROVAL_REQUEST | OFFICIAL_PDF_ISSUANCE",
      "targetId": "uuid",
      "eventId": "uuid 또는 null",
      "outcome": "SUCCEEDED | DENIED | FAILED"
    }
  ],
  "page": 0, "pageSize": 50, "hasNext": false
}
```

- 역할: TENANT_ADMIN. 개인정보와 요청 본문은 넣지 않습니다.
- 현재 화면은 기존 `GET /api/v1/cases/{caseId}/activities`로 조사 사건별 기록만 보여 줍니다.

## 5. 내 역할과 설정 조회

```
GET /api/v1/admin/me
```

```json
{
  "membershipId": "uuid",
  "tenantName": "합성 고객사",
  "roles": ["REVIEWER"],
  "dataMode": "SYNTHETIC_ISOLATED | PRODUCTION",
  "officialPdfIssuance": "ENABLED_SYNTHETIC_ONLY | DISABLED_BY_POLICY"
}
```

- 화면 안내용입니다. 권한 판단은 계속 서버가 요청마다 합니다. 화면은 이 값으로 버튼을 숨길 수는 있어도 허용을 추정하지 않습니다.
- 설정 변경 API는 이번 범위에 포함하지 않습니다.

## 6. 승인 요청 목록

```
GET /api/v1/approval-requests?eventId={uuid}&status=PENDING&page=0&pageSize=20
```

- 항목은 기존 `GET /api/v1/approval-requests/{id}` 응답의 요약(요청 ID, caseId, status, requestedAt, requestedBy, reportRevision)입니다.
- 역할: REVIEWER(자기 요청), APPROVER(결정 대상). 자기 승인 금지는 결정 시점에 서버가 계속 검사합니다.

## 7. 승인 결정 조회

기존 승인 요청 상세에 결정 요약을 추가하거나 별도 조회를 제공합니다.

```json
{ "decision": { "approvalDecisionId": "uuid", "outcome": "APPROVE | REJECT", "decidedAt": "offset date-time" } }
```

- 결정이 없으면 `decision: null`.
- 이 값이 있으면 조사 사건과 승인 요청 화면에서 보고서 발급 화면으로 바로 연결할 수 있습니다. 발급 가능 여부는 기존 `official-pdf-eligibility`가 계속 판단합니다.
