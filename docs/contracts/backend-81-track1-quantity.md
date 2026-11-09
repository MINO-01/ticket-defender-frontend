# Backend Issue #81 연동 계약 (PROPOSED)

상태: **대체됨.** 실제 계약은 Backend `docs/api/track1-quantity-v1.md`와 `.yaml`(main a4be847)이며 Frontend `quantityAnalysisApi.ts`는 그 계약에 맞췄습니다. 아래는 제안 당시 기록이고 `QUEUED`는 실제로 없습니다. 시연 공백은 `docs/contracts/demo-v1-gaps.md`를 봅니다.

공통: 관리자 JWT, 서버 권한 판단, 범위 밖은 404, 역할 없음은 403, 오류는 `application/problem+json`의 `code`. 시각은 오프셋 포함 UTC. 원문 계정과 예매 참조는 응답에 넣지 않습니다.

## 1. 수량 원장 반입

`POST /api/v1/admin/events/{eventId}/track1-quantity/ledger-imports`, `Idempotency-Key` 필수, 합성 격리 환경 게이트 적용

```json
{
  "performanceId": "uuid", "inputType": "INDIVIDUAL_TICKET", "sourceVersion": "string", "sourceAsOf": "2026-11-08T10:00:00Z", "quantityBasis": "string",
  "rows": [{ "accountReference": "string", "reservationReference": "string", "ticketReference": "string", "purchasedAt": "2026-11-02T10:00:00Z", "quantity": 1, "quantityUnit": "TICKET | ORDER_LINE", "ticketStatus": "ACTIVE | CANCELLED | REFUNDED | UNKNOWN" }]
}
```

`201` 응답(`LedgerBatch`): `batchId`, `eventId`, `performanceId`, `sourceVersion`, `sourceAsOf`, `ledgerVersion`, `status: ACCEPTED | REJECTED`, `inputRowCount`, `acceptedRowCount`, `rejectedRowCount`, `errors[{ rowIndex | null, code }]`, `completedAt`.

## 2. 반입 이력

`GET /api/v1/admin/events/{eventId}/track1-quantity/ledger-imports?page&pageSize` → `{ items: LedgerBatch[], page, pageSize, hasNext }`

## 3. 분석 실행

`POST /api/v1/admin/events/{eventId}/track1-quantity/analysis-runs`, `Idempotency-Key` 필수, `{ "performanceId": "uuid", "ledgerBatchId": "uuid" }` → `202 AnalysisRun`

## 4. 실행 목록과 결과

`GET /api/v1/admin/events/{eventId}/track1-quantity/analysis-runs?page&pageSize` → `{ items: AnalysisRun[], page, pageSize, hasNext }`

`AnalysisRun`: `runId`, `eventId`, `performanceId`, `ledgerBatchId`, `sourceVersion`, `executionStatus: QUEUED | RUNNING | SUCCEEDED | FAILED`, `failureCode`, `retryable`, `policyId`, `policyVersion`, `algorithmVersion`, `analysisRequestId`, `clusterCount`, `requestedAt`, `completedAt`, `evaluation`.

`evaluation`: `status: EVALUATED | POLICY_NOT_CONFIRMED | QUANTITY_DATA_INCOMPLETE | POLICY_TIME_NOT_APPLICABLE`, `policyVersion`, `findings[{ accountToken, effectiveTicketQuantity, maxTicketsPerAccount, policyVersion, reservationQuantities[{ reservationToken, effectiveTicketQuantity }] }]`.

규칙: `SUCCEEDED`는 `evaluation`과 `clusterCount`가 있어야 합니다. `FAILED`는 `failureCode`가 있고 `evaluation`은 `null`입니다. `EVALUATED` 외 상태의 `findings`는 비어 있습니다. `accountToken`과 `reservationToken`은 tenant와 신호 범위의 가명 토큰입니다.

## 5. 관계 그래프 (선택)

기존 `GET /api/v1/admin/track1/clusters/detail` 응답에 `graph`를 추가합니다. 저장된 Louvain 근거에서 만든 값만 허용합니다.

```json
{ "graph": { "nodes": [{ "id": "opaque", "kind": "account | signal | reservation", "label": "표시용 가명" }], "edges": [{ "id": "opaque", "source": "node id", "target": "node id", "signalKind": "PAYMENT | DEVICE | ADDRESS | IP | null" }] } }
```

필드가 없으면 Frontend는 기존 공유 근거 요약만 표시합니다.

## 6. 기타 공백

| 필요 | 현재 |
| --- | --- |
| `GET /api/v1/admin/me` (역할, 고객사) | 없음. 역할은 403으로만 확인 |
| 승인 요청 목록, 승인 대기 집계 | 없음. 사건 단위 연결로 이동 |
| 고객사 전체 감사 로그 | 없음. 사건 단위 감사만 표시 |
| 합성 예매 반입 이력 조회 | 없음 |
