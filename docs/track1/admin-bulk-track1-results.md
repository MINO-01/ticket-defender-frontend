# 관리자 대용량 Track 1 결과 조회 (BL-07)

`/app/ledger-imports`의 공개 원장 회차에는 기존 `analysis-runs`(BL-06)와 별도로 BL-07 대용량 결과 영역이 표시된다. 실제 관리자 세션에서만 조회하며 preview는 합성 결과를 대신 표시하지 않는다.

조회 경로는 모두 다음 범위에서 만든다.

`/api/v1/admin/events/{eventId}/ledger-track1/performances/{performanceId}/bulk-analysis-jobs`

이후 선택한 Job에 대해 clusters, cluster members, shared-signal-observations, purchase-limit-evaluations, purchase-limit-findings를 각각 페이지 단위로 조회한다. Job 목록만 배열이고 나머지 결과 페이지는 `job`, `items`, `page`, `pageSize`, `hasNext` 계약을 사용한다. 총 건수는 서버가 주지 않으므로 화면에서 추정하지 않는다.

응답은 Zod로 UUID, enum, 시간, 수량, 페이지와 범위를 확인한다. Java `long` 수량이 JavaScript 안전 정수를 넘거나 Job 범위가 다르면 빈 목록으로 바꾸지 않고 계약 오류로 표시한다. cluster ID는 안전한 단일 경로 세그먼트일 때만 구성원 상세 경로에 사용한다.

공유 IP/주소와 Louvain Risk Score는 조사 신호이며 부정 구매 확정 근거가 아니다. `UNAVAILABLE` 수량은 확인된 수량처럼 표시하지 않는다. `EVALUATED`와 `findingsCollectionStatus=COMPLETED`인 경우에만 빈 findings를 정상 평가 0건으로 표시한다. 정책 미확정, 수량 불완전, 수집 중, FAILED 또는 BLOCKED는 모두 정상 0건과 구분한다. account/reservation/member ID는 Job 범위 opaque 식별자이며 원본 HMAC 또는 다른 Job 연결 키로 취급하지 않는다.
