# Gate A 합성 격리 시나리오

기준: Backend main `5d80788`, Data 브랜치 `feat/#30-track1-demo-verification`, Frontend 브랜치 `feat/final-demo-live-integration-20261109`. 이 문서는 실행 절차이며 결과 기록이 아닙니다. 실행하지 않은 단계는 NOT_RUN으로 기록합니다.

## 격리 조건

- 새 컨테이너 이름, 전용 loopback 포트, 실행마다 생성한 비밀값을 사용합니다.
- run960, poster 환경, Windows MySQL80, 기존 볼륨과 버킷, `finalForImport: false` 시험 원장을 사용하지 않습니다.
- Backend는 작업 폴더를 쓰지 않고 `git archive`로 추출한 복사본에서 빌드합니다.
- 합성 데이터만 사용합니다. 실제 팬 이미지와 외부 VLM 호출은 교체된 키와 처리 정책 확인 전에는 금지합니다.
- 여유 메모리 6GB 이상을 확보합니다. 부족하면 다른 프로세스를 종료하지 말고 단위 테스트와 격리 분석만 순차 실행합니다.

## 실행 순서

1. 인증서: 로컬 테스트 CA와 `localhost` SAN 인증서를 저장소 밖에 만들고 JVM 전용 truststore에 넣습니다.
2. 인프라: `mysql:8.0.46`, MinIO(원본, Object Lock 보존, PDF 버킷), Keycloak 26.8.1 HTTPS(`docs/keycloak` realm), Neo4j 5.19.0과 GDS 2.6.6 JAR(SHA-256 대조)을 띄웁니다.
3. 스키마: Spring을 `SPRING_JPA_HIBERNATE_DDL_AUTO=create`로 한 번 실행합니다. `public_request_quota`는 JDBC 전용이라 `docs/database/fan-report-intake-migration.sql`의 DDL을 적용합니다.
4. 시드: 합성 `tenants`, `events(public_intake_enabled=1)`, 역할별 `memberships`(`subject`는 Keycloak 사용자 ID), `membership_roles`, `membership_events`, 다른 tenant의 사용자 1명. `official_pdf_synthetic_tenants`는 Case 생성 전에 `registered_at` 없이 등록합니다.
5. FastAPI: Data 브랜치로 실행합니다. `TRACK1_INTERNAL_SHARED_SECRET`을 Spring과 맞춥니다. 외부 VLM은 켜지 않습니다.
6. Spring 설정: `FAN_REPORT_*`, `EVIDENCE_PRESERVATION_*`, `OFFICIAL_PDF_ENABLED=true`, `OFFICIAL_PDF_OPERATIONAL_MODE=SYNTHETIC_ISOLATED`, 실행별 `OFFICIAL_PDF_SYNTHETIC_ISOLATION_ID`, `ticket-defender.security.admin.{issuer,jwk-set-uri,audience}`, `A3_SYNTHETIC_IMPORT_*`, #81 배포 후 `TRACK1_V2_ENABLED=true`.
7. Frontend: `VITE_ADMIN_AUTH_PROVIDER=keycloak`, `VITE_ADMIN_AUTH_ISSUER`, `VITE_ADMIN_AUTH_CLIENT_ID`, `VITE_ADMIN_AUTH_AUDIENCE`, `VITE_FAN_REPORT_EVENT_ID`, `VITE_FAN_REPORT_EVENT_LABEL`, `VITE_SYNTHETIC_RESERVATION_IMPORT_UI=true`, `TD_DEV_API_PROXY_TARGET`로 `http://localhost:15173`에서 실행합니다.

## 시연 경로 A: 팬 제보에서 공식 PDF까지

| 단계 | 화면 | 기대 결과 | 현재 상태 |
| --- | --- | --- | --- |
| 1 | `/fan/write` 제출, 접수 조회 | 201, 조회 200, 실패 복구 | 화면 연결됨 |
| 2 | `/app/verified-performances`, `/app/imports` | 합성 예매 반입 ACCEPTED, 다좌석은 5번째 값 `ticketReference` | 화면 연결됨 |
| 3 | `/app/fan-reports/:id` 이미지 분석 | COMPLETED, PARTIAL, UNVERIFIABLE, FAILED 구분 | 실제 모델은 BLOCKED. 스텁 검증은 모델 품질이 아님 |
| 4 | 같은 화면의 회차 연결과 후보 대조 | MATCH_CANDIDATE는 확정 판정이 아님 | 화면 연결됨 |
| 5 | 같은 화면의 Case 생성 후 `/app/cases/:id` | `linkBasis=RESERVATION_REFERENCE` | 화면 연결됨 |
| 6 | Case의 조사 근거 묶음, 초안, 증거 무결성 검증 | MATCH와 승인 적격성 분리 | 실제 Backend 검증됨 |
| 7 | 승인 요청 | 후보 포함 Case는 `APPROVAL_BASIS_BLOCKED` 유지 | 실제 Backend 검증됨 |
| 8 | 후보 없는 Track 1 적격 Case로 `/app/approvals/:id` 독립 승인 | 자기 승인 403 | 화면 연결됨 |
| 9 | `/app/report-center/decisions/:id` 발급, 다운로드, 감사 | 승인과 발급 분리 | 화면 연결됨 |

정책상 후보 단독 근거는 승인되지 않으므로 8~9는 적격 근거 Case로 별도 검증합니다.

## 시연 경로 B: 수량 원장에서 분석 결과까지

| 단계 | 화면 | 기대 결과 | 현재 상태 |
| --- | --- | --- | --- |
| 1 | `/app/settings` 구매 한도 정책 등록 | 201, 낡은 개정 409 | 화면 연결됨 |
| 2 | `/app/analysis/quantity` 원장 반입 | ACCEPTED 또는 행별 사유가 있는 REJECTED | Backend #81 BLOCKED |
| 3 | 같은 화면의 분석 실행 | 실제 Louvain 실행, 장애는 FAILED 유지 | Backend #81 BLOCKED |
| 4 | 같은 화면의 결과 | 한도 내 계정, 3매 초과 신호, 평가 불가 사유 구분 | Backend #81 BLOCKED |
| 5 | `/app/analysis/findings` 군집과 그래프 | 저장 간선이 있을 때만 그래프 표시 | 그래프는 Backend 응답 대기 |

Data 측 입력과 기대 결과는 `tests/fixtures/track1_v2_demo_scenario.json`과 manifest로 격리 GDS에서 검증합니다.

## 공통 부정 경로

무인증 401, 역할 없음 403, 타 tenant 404, 근거 변경 후 STALE, IssuanceHold 차단, 레거시 PDF 409, 서비스 장애를 빈 결과로 표시하지 않음.

## 기록 방법

단계별 HTTP 상태, 서버 코드, 커밋 SHA를 PASS, FAIL, BLOCKED, NOT_RUN으로 남깁니다. 토큰, 비밀번호, 예매 원문, HMAC 값은 기록하지 않습니다. 끝나면 이 실행의 컨테이너와 임시 비밀값만 제거합니다.
