# 관리자 전체 현황 화면 (Issue #44)

`/app/overview`는 선택한 공연의 조사 현황을 기존 Backend 조회 API로만 보여 줍니다. 새 API나 집계 API를 쓰지 않고, 서버가 주지 않는 통계는 만들지 않습니다. 건수와 상태는 조사 진행 현황이며 부정 거래 판정이 아닙니다.

## 조회 API

기준: Backend main `2027c15`. 공연은 기존 접근 가능 공연 선택(AdminEventGate)으로 고르고, 고르기 전에는 아래 API를 부르지 않습니다.

| 영역 | 요청 | 역할 | 표시 |
| --- | --- | --- | --- |
| 팬 제보 | `GET /api/v1/admin/fan-reports?eventId&page=0&pageSize=1` | ANALYST, REVIEWER | 서버 `totalItems` |
| 저장된 군집 | `GET /api/v1/admin/track1/clusters?eventId&page=0&pageSize=1&sort=recent` | TENANT_ADMIN, ANALYST, REVIEWER, APPROVER | 서버 `totalItems` (저장된 증거 기준) |
| 최근 Case | `GET /api/v1/cases?eventId&page=0&pageSize=5` | TENANT_ADMIN, ANALYST, REVIEWER | 생성 시각 최신순 최대 5건, `hasNext` 안내 |

- 공연 선택 1회에 영역별 요청 1회씩, 모두 3회입니다. 페이지 순회, 상세 N+1 조회, 자동 폴링은 없습니다. 실패한 영역의 `다시 시도`는 그 영역만 다시 조회합니다.
- Case 목록 API는 전체 건수를 주지 않습니다. Case 합계와 승인 대기 총건수는 표시하지 않습니다. ANALYST는 자신이 만들었거나 담당한 Case만 받습니다.
- 위험 점수는 표시하지 않습니다. 위험 점수는 조사 우선순위이며 불법 거래 확률이 아닙니다.

## 오류 처리

- 영역마다 따로 처리합니다. 403은 그 영역에 필요한 역할을, 404는 범위 안내를, 503과 네트워크 오류는 장애 안내를 표시합니다. 401은 세션을 정리하고 로그인 안내로 바뀝니다.
- 응답의 공연, 페이지, 페이지 크기, 항목 수와 `totalItems`, `hasNext`가 서로 맞지 않으면 계약 위반으로 처리합니다.
- 실패한 영역은 0건이나 빈 목록으로 표시하지 않습니다. 서버가 성공으로 돌려준 0건과 빈 목록만 그대로 표시합니다.
- 개발 전용 미리보기 세션에서는 실제 API를 부르지 않고 안내만 표시합니다. 합성 데모 데이터와 섞지 않습니다.

## 연결 화면

팬 제보 검토, 검증 회차 관리, 연관 예매 분석, 사건 관리 목록과 Case 상세로 같은 `eventId`를 유지해 이동합니다.

## 테스트

`src/test/admin-overview.test.tsx`(Mock fetch 기준, 실제 Backend 연동 아님): 공연 선택 전후 요청 수, totalItems와 최근 Case 표시, 상세 이동, 서버 0건과 빈 목록, 영역별 403/503/네트워크 오류, 영역별 다시 시도, 계약 위반 응답, 404, 401, 첫 화면 안내. 실제 Backend E2E는 통합 테스트 단계에서 검증합니다.
