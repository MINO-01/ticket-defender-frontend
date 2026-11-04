# 관리자 Case 조회 실제 API 연동 (Issue #29)

인증된 관리자가 권한 있는 공연의 Case 목록, 상세, 연결 출처, 활동 이력을 Backend Case API로 조회합니다.
기준: Frontend main d4a27a8, Backend main 17c832b. Case 생성, 상태 변경, 담당자 지정, EvidenceSnapshot, 보고서, 승인, 공식 PDF는 이번 범위가 아닙니다.

## 사용하는 API

| 화면 | API | 비고 |
| --- | --- | --- |
| 목록 | `GET /api/v1/cases?eventId&page&pageSize=20&status` | 응답 `items, page, pageSize, hasNext`. 전체 건수 없음. 서버 정렬 `createdAt` 내림차순 |
| 상세 | `GET /api/v1/cases/{caseId}` | `CaseDto.View` |
| 출처 | `GET /api/v1/cases/{caseId}/sources` | 배열. 서버 정렬 `linkedAt, id` 오름차순 |
| 활동 이력 | `GET /api/v1/cases/{caseId}/activities?page&pageSize=20` | 서버 정렬 `occurredAt, id` 오름차순 |

역할별 범위는 Backend가 판단합니다. TENANT_ADMIN, REVIEWER는 권한 있는 공연의 Case를, ANALYST는 자신이 만들었거나 담당자로 지정된 Case만 받습니다. 범위 밖 Case, 다른 고객사, 권한 없는 공연은 모두 404입니다.

## 코드 구성

- `src/features/admin-cases/caseApi.ts`: Zod 응답 스키마, API 경로, 화면 주소, 상태 값 읽기, 표시 문구
- `src/features/admin-cases/LiveCaseListPage.tsx`: `AdminEventGate`로 공연을 확인한 뒤 목록 조회
- `src/features/admin-cases/LiveCaseDetailPage.tsx`: 상세, 출처, 활동 이력
- `src/features/admin-cases/CaseRoutes.tsx`: 인증 세션은 실제 화면, 개발 전용 미리보기는 기존 합성 데모 화면(`CaseListPage`, `CaseDetailPage`, `demoData`)을 lazy로 연다. 실제 화면은 demoData를 import하지 않고 실패 시 대체하지 않는다.

## 화면 동작

- 공연 선택 전에는 Case API를 호출하지 않습니다. 주소의 `eventId`, `status`, `page`로 같은 서버 페이지를 다시 조회합니다.
- 상태나 공연을 바꾸면 page를 0으로 되돌립니다. 이동은 `hasNext`만 사용하며 총 페이지 수와 전체 건수를 계산하지 않습니다.
- 검색, 담당자 필터, 정렬, 합성 통계, 조사 우선순위 점수는 서버가 지원하지 않아 실제 화면에서 제거했습니다.
- 담당자 이름 조회 API가 없어 목록은 지정 여부만, 상세와 이력은 멤버십 UUID만 표시합니다.
- 목록 링크는 `/app/cases/{caseId}?eventId={eventId}` 형식입니다. 상세 주소 처리 규칙은 다음과 같습니다.
  - caseId가 UUID가 아니거나 eventId 형식이 잘못되면 API를 호출하지 않고 주소 오류로 표시합니다.
  - eventId가 있으면 응답 eventId와 같을 때만 표시합니다. 다르면 출처와 이력을 요청하지 않습니다.
  - eventId가 없는 직접 주소는 서버 권한 검증 결과를 따르고, 목록 링크는 응답의 eventId로 만듭니다.
- 출처와 활동 이력은 상세 조회가 성공하고 공연이 확인된 뒤에만 요청하며, 각각 독립된 로딩, 오류, 다시 시도를 가집니다.
- 출처는 유형별로 실제 필드만 표시합니다. 군집 출처는 기존 `track1DetailRoute`, 제보와 증거 이미지 출처는 `fanReportDetailRoute`로 연결합니다. 증거 이미지는 특정 제보에 속한 자료이며 독립된 분석 결과로 표시하지 않습니다. null은 "기록 없음" 또는 Risk Score의 경우 "값 없음"으로 표시합니다.
- caseVersion과 evidenceRevision은 별도 항목으로 표시합니다. Backend 17c832b에서 evidenceRevision은 생성 시 1이며 이를 올리는 명령은 아직 없습니다.
- 담당자 변경, 상태 변경, EvidenceSnapshot 생성, 보고서 초안 작성, 승인 요청, 공식 PDF 발급 버튼은 비활성입니다.

## 응답 계약 검증

다음 응답은 성공으로 표시하지 않고 "서버 응답 형식이 계약과 다릅니다"로 처리합니다.

- 스키마 위반(필수 필드 누락, 알 수 없는 상태나 유형, 오프셋 없는 시각, `relatedCaseId`와 `relationReason` 짝 불일치, createdAt이 updatedAt보다 늦음)
- 출처 유형과 맞지 않는 필드 조합(군집 출처의 fanReportId, 제보 출처의 군집 필드, 증거 출처의 evidenceId 누락 등)
- 요청과 다른 page나 pageSize, 현재 공연과 다른 eventId, 상태 필터와 다른 상태의 Case
- 요청과 다른 caseId의 상세 응답, 요청과 다른 page의 활동 이력

## 인증과 오류 처리

공통 `createAdminApiClient`와 `describeAdminApiFailure`를 재사용합니다. 401은 세션을 정리하고 재로그인 화면으로 전환하며, 403, 404, 409(TENANT_SELECTION_REQUIRED), 503, 네트워크 오류는 고정 문구의 오류로 표시합니다. 어떤 실패도 빈 목록으로 바꾸지 않고 서버의 상세 메시지는 표시하지 않습니다. 경로나 공연이 바뀌면 이전 요청을 중단하고 늦게 도착한 응답은 표시하지 않습니다(`useAdminQuery`).

## 테스트

- `src/test/admin-cases-api.test.tsx` 35건: 경로와 스키마, 공연 선택 전 미호출, 상태 필터와 서버 페이지, 계약 위반, 401/403/404/409/503, 상세와 출처, 활동 이력, 주소 처리, 응답 순서 역전
- 기존 `src/test/admin-cases.test.tsx`는 개발 전용 미리보기 플래그로 합성 데모 화면 회귀를 계속 검증합니다.

## 실제 HTTP 및 Chrome E2E 결과 (2026-11-04)

저장소 밖 `D:\td-e2e-fe29`에서 실행했으며 저장소에는 포함하지 않았습니다.

- 구성: Backend main 17c832b(git archive 사본 빌드), Java 21, 격리 MySQL 8.0.45(기존 MySQL80 바이너리로 별도 datadir, 127.0.0.1:13306에서 실행. MySQL80 서비스와 데이터는 사용하지 않음), 합성 JWT를 발급하는 HTTPS OIDC 대역 서버(Keycloak 아님), Vite dev, 시스템 Chrome(CDP)
- 데이터: 고객사, 공연, 멤버십, 팬 제보, 증거 행, Track 1 저장 군집 증거만 SQL로 시드했습니다. Case 27건, 출처, 활동 이력은 실제 Case 쓰기 API(생성, 담당자 지정, 분류 전이)로 만들었습니다.
- EVIDENCE_ASSET 출처 생성 시 Spring이 수행하는 S3 HEAD는 MinIO 대신 HEAD 전용 대역 서버가 응답했습니다. 객체 바이트, Object Lock은 이번 검증 대상이 아닙니다.
- HTTP E2E 17건 통과: 서버 페이지와 hasNext, status 필터, TENANT_ADMIN, ANALYST 자기 Case와 담당 Case, 공연 분리, 상세 필드, 출처 3종, 활동 이력 정렬과 서버 페이지, ANALYST의 다른 Case 404, 다른 고객사 404, 권한 없는 공연 404, 역할 없음 403, 다중 고객사 409, 토큰 없음, 만료, 위조, 다른 audience 401, 잘못된 page 400, 격리 DB 중단 시 503과 복구
- Chrome E2E 22건 통과: 미인증 미호출, 실제 목록 20건과 다음 페이지, 상태 필터, 공연 변경, 상세, 출처 링크, 활동 이력, 비활성 버튼, Track 1 군집 상세 이동, 목록 복귀 시 공연 유지, 응답 순서 역전(CDP Fetch로 이전 응답 지연), 404, ANALYST 범위, 다른 고객사, 403, 409, DB 장애 503과 복구 후 빈 결과, 세션 만료, 인증 화면의 데모 데이터 미혼입
- 관찰: Case 생성 시 CASE_OPENED와 CASE_SOURCE_LINKED는 같은 occurredAt으로 기록되어 서버가 activityId 순으로 정렬하므로, 화면 첫 줄이 항상 "Case 생성"은 아닙니다. Frontend는 서버 순서를 그대로 표시합니다.

## 미구현 및 후속 작업

- Case 생성, 상태 전이, 담당자 지정, EvidenceSnapshot, ReportVersion, 승인, 공식 PDF 화면 연동
- 멤버십 ID를 사용자 이름으로 바꾸는 API가 생기면 표시 개선
- 승인 검토 화면(`/app/approvals`)은 이번 범위가 아니며 여전히 합성 데모 데이터를 사용합니다.
- 실제 Keycloak 로그인과 MinIO 기반 증거 객체 검증을 포함한 Case 화면 E2E
