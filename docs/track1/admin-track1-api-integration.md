# 관리자 공연 선택 및 Track 1 실제 API 연동 (Frontend Issue #20)

이 문서는 관리자 Track 1 화면이 실제 Spring API와 연결된 범위, 화면에서 표시하지 않는 정보, 후속 작업을 정리합니다.
기준 계약은 Backend main의 `docs/api/admin-events-v1.yaml`, `docs/api/admin-events-v1.md`, `docs/api/track1-admin-evidence-read-v1.md`입니다.

## 연동 범위

| 화면 | 주소 | 호출 API |
| --- | --- | --- |
| 공연 선택 | `/app/analysis/findings?eventId=` | `GET /api/v1/admin/events?page=&pageSize=100` |
| 군집 목록 | `/app/analysis/findings?eventId=&page=&sort=` | `GET /api/v1/admin/track1/clusters?eventId=&page=&pageSize=20&sort=` |
| 군집 상세 | `/app/analysis/findings/detail?eventId=&analysisRequestId=&clusterId=` | `GET /api/v1/admin/track1/clusters/detail?eventId=&analysisRequestId=&clusterId=` |

- 모든 요청은 기존 Keycloak 세션의 관리자 JWT와 공통 `adminApiClient`를 사용합니다. tenantId와 역할은 요청에 보내지 않고 화면에서 권한 근거로 쓰지 않습니다.
- 응답은 Zod 스키마로 검증합니다. 응답의 공연 ID, 페이지, 군집 식별자가 요청과 다르면 계약 불일치로 처리합니다.
- 분석 요청 ID와 군집 ID에는 슬래시가 포함될 수 있어 경로가 아닌 쿼리 값으로 인코딩해 전달합니다.

## 공연 선택

- 서버가 반환한 공연의 내부 UUID(`items[].id`)만 선택값으로 사용합니다. `externalEventId`는 고객사 간에 같을 수 있어 식별자로 쓰지 않습니다.
- 공연은 서버 페이지(100개) 단위로 불러오며 `공연 더 불러오기`로 다음 페이지를 이어 붙입니다.
- 선택 상태는 주소의 `eventId` 쿼리로 유지합니다. 주소로 접근하면 접근 가능 공연 목록에서 해당 공연을 다시 확인하며, 첫 페이지에 없으면 최대 10페이지까지 이어서 조회합니다. 확인되기 전에는 Track 1 API를 호출하지 않습니다.
- 공연을 바꾸면 페이지 값을 버리고 이전 요청을 중단합니다. 늦게 도착한 이전 응답은 요청 경로가 현재와 달라 표시되지 않습니다.
- `AdminEventGate`와 `useSelectedEventId`는 Track 2와 Case 화면에서도 재사용할 수 있게 분리했습니다. 이번 Issue에서는 해당 화면에 연결하지 않았습니다.

## 표시 원칙

- Risk Score는 0~1 사이 조사 우선순위 신호로 소수 둘째 자리까지 표시합니다. 백분율이나 부정 거래 확률로 표시하지 않습니다. 값이 없으면 0점이 아니라 `값 없음`으로 표시합니다.
- 응답의 `coverage`는 `STORED_EVIDENCE_ONLY`만 허용합니다. 저장 구성원은 중복 저장 방지로 일부 누락될 수 있어 전체 분석 스냅샷이나 확정 판정으로 안내하지 않습니다.
- 목록이 0건이면 "저장된 군집이 없습니다"로 표시하고, 분석 실행 여부나 실패 여부를 뜻하지 않는다고 안내합니다.
- 검색과 연결 정보 필터는 Backend가 지원하지 않아 실제 연동 화면에서 제공하지 않습니다. 정렬은 서버 정렬 값(`priority-desc`, `priority-asc`, `recent`)만 사용합니다.

## 오류 구분

| 결과 | 화면 안내 |
| --- | --- |
| 401 | 세션을 정리하고 기존 재로그인 화면으로 전환 |
| 403 | 필요한 역할 없음 |
| 404 | 존재하지 않거나 접근 범위 밖 (두 경우를 구분하지 않음) |
| 409 `TENANT_SELECTION_REQUIRED` | 여러 고객사 소속 계정 미지원 (DEC-02 PENDING) |
| 400 | 요청 값 오류 |
| 500 / 503 | 서버 오류 / 일시 장애 |
| 네트워크 실패 | 서버 연결 실패 |
| 스키마 불일치 | 응답 형식이 계약과 다름 |

모든 실패는 빈 목록, 0점, 합성 데모 데이터로 대체하지 않으며 재시도 버튼을 제공합니다. 서버의 상세 메시지는 표시하지 않고 고정 문구만 사용합니다.

## 데모 데이터 분리

- 인증 세션에서는 실제 API 화면만 엽니다. 기존 합성 데모 화면과 그래프는 개발 빌드의 `VITE_ADMIN_DEMO_PREVIEW=true` 미리보기에서만 열립니다.
- 인증 세션에서 기존 데모 주소(`/app/analysis/findings/DEMO-CL-001` 등)에 접근하면 주소 오류로 안내하고 API를 호출하지 않습니다.
- 데모 화면과 그래프 라이브러리는 미리보기에서만 지연 로드해 인증 세션의 화면 번들에 포함하지 않습니다.

## 미지원 항목

현재 Backend 응답은 공연 정보, 분석 메타데이터, 저장 구성원(`auditId`, `accountId`, `reservationNo`)만 제공합니다.
다음 정보가 없으므로 실제 상세 화면에서는 관계 그래프를 그리지 않고 미지원 사유를 표시합니다.

- 공유 신호 종류와 설명
- 신호별 계정 연결 관계와 그래프 간선
- 좌석 정보

## 후속 Backend 작업 제안

완전한 관계 그래프 화면에는 별도 Backend Issue가 필요합니다.

1. 분석 응답의 신호별 연결 관계(신호 종류, 연결된 구성원, 근거 설명)를 고객사와 공연 범위로 저장하는 영속 구조와 migration
2. 원문 결제, 주소, 기기, IP 값 대신 고객사 범위 HMAC 토큰 또는 신호 종류만 노출하는 응답 계약과 개인정보 검토
3. 상세 API의 `coverage`에 그래프 제공 범위를 구분하는 값 추가와 Frontend 스키마 갱신
4. 저장 구성원 누락 여부를 화면에서 구분할 수 있는 분석 응답 구성원 수 등 메타데이터

## 로그인 후 주소 복원

기존 인증 정책상 액세스 토큰은 메모리에만 있어 새로고침하면 다시 로그인해야 하고, Keycloak은 등록된 고정 콜백 주소(`/app/overview`)로 돌아옵니다.
로그인 버튼을 누를 때 현재 관리자 경로와 쿼리만 현재 탭의 `sessionStorage`에 보관했다가 인증이 완료되면 한 번만 복원하고 지웁니다.

- Redirect URI와 PKCE, 콜백 처리 방식은 바꾸지 않습니다. 토큰, 인증 코드, fragment는 저장하지 않습니다.
- 동일 출처의 `/app` 하위 경로만 복원합니다. 다른 출처, 공개 팬 화면, 경로 이탈(`..`, `%2e%2e`), 역슬래시, fragment, 제어 문자가 있는 값과 10분이 지난 값은 버립니다.
- 로그인에 실패하면 이동하지 않습니다. 복원한 주소의 공연과 군집은 각 화면이 서버 권한을 다시 확인합니다.

## 알려진 제한

- 실제 Keycloak과 Spring을 연결한 HTTP 연동 검증은 격리 환경(`docs/keycloak/README.md`)이 준비된 상태에서 별도로 수행해야 합니다.
