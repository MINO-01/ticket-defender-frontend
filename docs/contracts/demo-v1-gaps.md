# 세 시나리오 시연의 Backend 계약 공백

기준: Backend main `a4be847`, Frontend `feat/final-demo-backend81-alignment-20261110`. 없는 API는 Frontend에서 추측해 호출하지 않습니다.

## DEMO_V1 승인 정책 (미구현)

현재 Backend는 승인 근거 적격성을 차단합니다. Case에 `LISTING_CANDIDATE_MATCH`가 있으면 `APPROVAL_BASIS_BLOCKED`, 무결성 평가의 `approvalEligibility`는 항상 `BLOCKED`입니다.

| 시나리오 | 현재 화면 | 막히는 지점 |
| --- | --- | --- |
| 1. GRAPH_CLUSTER → 승인 → PDF | 군집 상세의 Case 생성, 근거 묶음, 초안, 승인 요청 화면 연결됨 | DEMO_V1 적격성 미구현 |
| 2. FAN_REPORT → Gemini → 후보 대조 → 승인 → PDF | 제보, 이미지 분석, 후보 대조, Case 화면 연결됨 | 실제 Gemini BLOCKED, 후보 근거 `APPROVAL_BASIS_BLOCKED` |
| 3. COMBINED → LINKED → 승인 → PDF | Case 출처 연결과 `track1-candidate-links` 표시 연결됨 | COMBINED Case 적격성 미구현 |

Backend가 정해야 하는 항목입니다. Frontend는 값을 정하지 않습니다.

1. DEMO_V1 정책을 켜는 방법과 합성 격리 게이트.
2. 시나리오별 승인 근거 적격 판정과 차단 코드. 기존 `POST /api/v1/cases/{caseId}/approval-requests`, `GET /api/v1/approval-decisions/{id}/official-pdf-eligibility` 응답을 유지하는지, 새 코드가 있는지.
3. `integrity-evaluation.approvalEligibility`에 추가되는 값. Frontend는 `BLOCKED` 외의 값을 코드 그대로 표시하므로 새 값이 정해지면 문구만 추가합니다.
4. 승인 결정 전체 목록 조회. 현재 보고서 센터는 사건 업무 연결이나 승인 결정 ID로만 열립니다.

## 대량 공유 관찰

Data는 `sharedSignalObservations`를 반환합니다. 계약은 Data `docs/api/shared-signal-observations-v1.md`입니다. Backend `AnalysisRun`이 같은 필드를 반환하면 Frontend 패널이 표시하고, 그 전에는 BLOCKED로 표시합니다. 군집 목록 API에는 실행별 관찰이 없어 패널은 구매 수량 분석 결과에 있습니다.

## 기타

| 필요 | 현재 |
| --- | --- |
| 고객사 전체 감사 로그 | 공연 단위 승인 감사와 사건 단위 기록만 있음 |
| 통합 분석 작업 이력 | Track 2 실행과 수량 실행을 각각 표시 |
| 담당자 이름 조회 | 없음. 멤버십 ID 표시 |
