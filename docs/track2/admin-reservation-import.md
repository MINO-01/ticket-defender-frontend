# 관리자 합성 격리 예매 스냅샷 반입 화면 (Issue #42)

`/app/imports`(관리 메뉴 `데이터 반입`)는 합성 격리(A3 SYNTHETIC_ISOLATED) 시험 환경에서 검증 회차에 합성 예매 스냅샷을 반입하는 **테스트 전용** 화면입니다. 실제 고객사 예매 데이터 반입 기능이 아니며, 반입 결과는 예매 후보 대조의 기준 자료일 뿐 부정 거래 판정이 아닙니다.

## 계약

기준: Backend main `2027c15`의 `docs/api/track2-candidate-pipeline-v1.yaml`(`importSyntheticReservationSnapshot`), `ReservationImportController`, `CandidatePipelineDto`.

| 항목 | 내용 |
| --- | --- |
| 요청 | `POST /api/v1/admin/events/{eventId}/reservation-imports`, Bearer 관리자 토큰, `Idempotency-Key`(UUIDv4) |
| 역할 | TENANT_ADMIN만. 회차 목록 조회는 REVIEWER, TENANT_ADMIN |
| 본문 | `performanceId`, `sourceVersion`(앞뒤 공백 제거 후 1~128자), `completeSnapshot`, `rows` 1~1000개(`reservationReference`, `zone`, `row`, `seat`, 각 앞뒤 공백 제거 후 1~128자). 그 밖의 필드는 보내지 않습니다. |
| 성공 | 201만 인정. `ACCEPTED` 또는 `REJECTED` 배치, `batchId`, 행 수, `errors[{rowIndex, code}]` |
| 오류 | 401, 403, 404(범위 밖과 미존재 구분 없음), 409(`RESERVATION_IMPORT_DISABLED`, `..._OPERATION_NOT_APPROVED`, `..._ISOLATION_UNVERIFIED`, `..._SYNTHETIC_SCOPE_UNVERIFIED`, `..._CONCURRENT_UPDATE`, `RESERVATION_SOURCE_VERSION_CONFLICT`, `PERFORMANCE_WITHDRAWN`, `IDEMPOTENCY_KEY_REUSED`), 400, 422, 503 |

`completeSnapshot=false`이면 서버가 배치 전체를 `REJECTED`로 기록하고 `rowIndex 0`, `INCOMPLETE_SOURCE`를 돌려줍니다. 이 코드는 특정 행 오류가 아니라 배치 사유입니다.

## 사용 조건

1. 화면 설정 `VITE_SYNTHETIC_RESERVATION_IMPORT_UI=true`를 시험 환경의 로컬 `.env.*`에만 둡니다(커밋 금지, 비밀값 아님). 값이 없거나 `true`가 아니면 입력 화면과 반입 API 호출을 열지 않습니다.
2. 화면 설정은 Backend 게이트를 대체하지 않습니다. Backend가 SYNTHETIC_ISOLATED 모드, 격리 ID, 격리 DB, 등록된 synthetic tenant, HMAC 키를 모두 확인해야 반입됩니다. 기본 상태에서는 `409 RESERVATION_IMPORT_DISABLED`가 표시되는 것이 정상입니다.
3. 화면에서 게이트, synthetic tenant, 격리 ID, HMAC 키를 설정하거나 우회하는 기능은 없습니다.

## 화면 동작

- 공연은 기존 접근 가능 공연 선택(AdminEventGate)으로 고르고, 그 공연의 `ACTIVE` 회차만 선택지에 둡니다.
- `completeSnapshot`은 기본값 없이 관리자가 직접 고릅니다.
- 예매 행은 한 줄에 `합성 예매번호,구역,열,좌석`(쉼표 또는 탭)으로 붙여넣습니다. 제출할 때만 한 번 해석하고 Zod로 검증합니다. 입력 중에는 전체 행을 반복 검증하지 않습니다.
- 사전 검증 오류 문구에는 줄 번호와 항목 이름만 쓰고 입력 값은 넣지 않습니다.
- 201 응답은 보낸 공연, 회차, sourceVersion, 행 수와 ACCEPTED/REJECTED 건수가 서로 맞을 때만 결과로 표시합니다.
- 확정 거부(401, 403, 404, 4xx 계약 코드)는 입력을 화면 메모리에 남겨 고쳐 보낼 수 있게 하고 회차 목록을 다시 불러옵니다.
- 응답 유실, 계약과 다른 응답, 503은 `결과 미확인`으로 표시하고 입력을 잠급니다. `같은 요청 재확인`만 같은 요청 키와 같은 본문을 다시 보냅니다. 새 키로 자동 재요청하지 않습니다.

## 예매 데이터 보호

- 예매 행은 비제어 입력창의 DOM 값으로만 두며 React 상태, 주소, localStorage, sessionStorage, IndexedDB, 콘솔에 넣지 않습니다. 요청 본문은 결과 미확인일 때만 재확인용으로 메모리에 남습니다.
- 201 결과(ACCEPTED, REJECTED)를 받으면 예매 행, sourceVersion, completeSnapshot 입력을 지웁니다.
- 화면을 떠나면 입력창 값과 재확인용 본문을 지우고 대기 중 요청을 취소합니다(서버 처리 취소는 아님).
- 응답에는 원문 예매번호가 없으며 화면도 표시하지 않습니다.

## 한계

- Backend에 반입 배치 이력 조회 GET API가 없어 새로고침하거나 화면을 떠나면 이전 결과를 다시 볼 수 없습니다. 필요하면 `batchId`를 따로 기록합니다.
- 결과 미확인 상태에서 화면을 떠나면 같은 요청 재확인도 할 수 없습니다. 같은 회차, 같은 sourceVersion, 같은 내용으로 다시 보내면 Backend가 기존 배치를 돌려주지만, 이 동작은 화면이 보장하지 않습니다.
- 401 안내 문구는 공통 쓰기 훅(`useCaseMutation`)의 고정 문구를 그대로 씁니다. 401이면 세션이 정리되어 로그인 안내 화면으로 바뀝니다.

## A3 시험 절차

1. 격리 Backend를 SYNTHETIC_ISOLATED 반입 게이트가 켜진 상태로 실행합니다(Backend 문서 기준, Frontend에서 설정하지 않음).
2. Frontend 로컬 환경에 관리자 인증 공개 설정과 `VITE_SYNTHETIC_RESERVATION_IMPORT_UI=true`를 두고 `npm run dev`로 실행합니다.
3. TENANT_ADMIN 합성 계정으로 로그인하고 `/app/imports`에서 공연과 ACTIVE 회차를 고릅니다.
4. 합성 행으로 `ACCEPTED`, 중복 예매번호 또는 `completeSnapshot=false`로 `REJECTED`, 게이트를 끈 Backend로 `409 RESERVATION_IMPORT_DISABLED`, ANALYST나 REVIEWER 계정으로 403을 확인합니다.
5. 이후 팬 제보 상세의 후보 대조 실행과 이력에서 반입한 출처가 서버 기준으로 쓰이는지 확인합니다.

## 테스트

`src/test/admin-reservation-import.test.tsx`(Mock fetch 기준, 실제 Backend 연동 아님): 화면 설정 차단, ACTIVE 회차만 선택, 계약 본문과 UUIDv4 키, 중복 제출 1회, ACCEPTED/REJECTED 표시와 입력 초기화, 401/403/404/400/409 계열/422 거부, 응답 유실, 503, 계약과 다른 201, 200 응답의 결과 미확인과 같은 키 재확인, 1000행 처리와 1001행 차단, 저장소, 주소, 콘솔에 예매번호 미기록. 실제 Backend HTTP와 Chrome E2E는 PENDING입니다.
