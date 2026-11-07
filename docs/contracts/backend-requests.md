# Frontend가 요청하는 Backend 조회 계약 초안

작성 기준: Frontend `feat/capstone-demo-ux-20261108`, Backend `origin/main` 7eb2f0b (2026-11-08)

이 문서는 관리자 업무 화면을 완성하는 데 필요한 조회 계약의 **요청 초안**입니다. 확정 계약이 아닙니다. Backend 담당자가 실제 계약을 제공하면 아래 비교 표를 갱신하고, 서비스별 기존 API 모듈(`track2Api.ts`, `track1Api.ts`, `caseApi.ts`, `approvalApi.ts`, `officialPdfApi.ts`)에 연결합니다.

계약이 확정되기 전에는 Frontend가 이 경로를 호출하지 않습니다. 해당 화면에는 "Backend 계약 대기"로 표시하고 완료 기능으로 취급하지 않습니다.

## 공통 원칙

- 모든 조회는 기존 관리자 인증(Bearer)과 tenant, event 범위 검사를 따릅니다. 범위 밖이면 404, 역할이 없으면 403을 반환합니다.
- 목록은 `page`, `pageSize`(1~100), `hasNext`를 반환합니다. 화면이 건수를 표시해야 하는 목록은 `totalItems`도 반환합니다.
- 원본 예매번호, 실명, 연락처, 원본 HMAC 입력값, 객체 저장소 키, 자격 증명은 응답에 넣지 않습니다.
- 분석 실패, 확인 불가, 미실행은 서로 다른 값으로 반환합니다. 실패를 빈 목록으로 바꾸지 않습니다.

## 비교 표

| 번호 | 항목 | 화면 | Frontend 요청 | Backend 실제 계약 | 상태 |
|---|---|---|---|---|---|
| 1 | 관리자 제보 접수번호 | 팬 제보 목록, 상세 | 아래 1 | 미제공 (원격 브랜치 없음) | 대기, 화면은 선택 필드로 준비 완료 |
| 2 | 연결된 예매 그룹 공유 근거 | 예매 관계 분석 상세 | 아래 2 | 미제공 | 대기 |
| 3 | 분석 작업 조회 | 분석 작업 | 아래 3 | 미제공 | 대기 |
| 4 | 감사 기록 조회 | 감사 기록 | 아래 4 | 미제공 (Case별 활동 기록만 있음) | 대기 |
| 5 | 내 역할과 설정 조회 | 설정, 각 화면 역할 안내 | 아래 5 | 미제공 | 대기 |
| 6 | 승인 요청 목록 | 보고서 승인 요청 | 아래 6 | 미제공 (ID로만 열 수 있음) | 대기 |
| 7 | 승인 결정 조회 | 조사 사건, 승인 요청, 보고서 발급 | 아래 7 | 미제공 (결정 직후 응답에만 결정 ID 있음) | 대기 |

`/api/v1/audits/**`는 레거시 분석 및 PDF 409 차단용 엔드포인트이며 감사 기록 조회 API가 아닙니다. Frontend는 이를 감사 기록으로 사용하지 않습니다.

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
