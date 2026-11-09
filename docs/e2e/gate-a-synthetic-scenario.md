# Gate A 합성 격리 촬영 절차

기준: Backend `feat/capstone-demo-v1-backend` `db47220`(main 미병합), Backend main `a4be847`, Data `feat/#30-shared-signal-observations`, Frontend `feat/final-demo-backend81-alignment-20261110`. 이 문서는 실행 절차이며 결과 기록이 아닙니다. 전체 흐름은 아직 실행되지 않았습니다(NOT_RUN).

공연: 악동뮤지션 대전 콘서트 (합성 시연), 2026-12-05 18:00 KST, 대전 공연장 (가상), 19, 20, 21구역. 자료는 Data `demo/capture-akmu-v1/`에 있으며 `finalForImport: false`입니다. Frontend에는 시연 이미지를 넣지 않고 이 폴더의 파일을 업로드합니다. listing_A: 19구역 8열 12번, 표시 판매가 200,000원 (KRW), 숫자 판매가 200000, 통화 KRW. MATCH_CANDIDATE, LINKED, 위험 점수, 한도 초과는 조사 근거이며 부정 거래 확정이 아닙니다.

## 준비

1. run960, 기존 볼륨, 사용자 DB를 쓰지 않는 격리 인프라를 준비합니다. MySQL 8, Neo4j 5.19 + GDS 2.6.6, MinIO(Object Lock), Keycloak HTTPS. 여유 메모리 6GB 이상을 권장합니다.
2. Data 폴더에서 `generate_capture_demo.py --verify`와 `check_demo_env.py --backend-env ..\ticket-defender-backend\.env`를 실행합니다. `VERIFY_PASS`, `RESULT: PASS`를 확인합니다.
3. FastAPI를 `http://127.0.0.1:8000`에서 실행합니다. `.env`를 자동으로 읽습니다.
4. Backend DEMO_V1 브랜치를 Backend `demo/README.md` 순서로 실행합니다. **Spring은 `.env`를 자동으로 읽지 않으므로** 값을 프로세스 환경에 넣어야 합니다.

| Backend 환경 변수 | 비고 |
| --- | --- |
| `TRACK2_LISTING_ANALYSIS_ENABLED`, `TRACK2_LISTING_ANALYSIS_URL`, `TRACK2_LISTING_ANALYSIS_INTERNAL_KEY` | 로컬 `.env`에 준비됨 |
| `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `FASTAPI_URL`, `FRONTEND_URL`, `TRACK1_INTERNAL_SHARED_SECRET` | 직접 설정. Data에도 같은 `TRACK1_INTERNAL_SHARED_SECRET` 필요 |
| `TRACK1_V2_ENABLED=true`, `TRACK1_INTERNAL_READ_TIMEOUT=PT60S` | |
| `OFFICIAL_PDF_ENABLED=true`, `OFFICIAL_PDF_DEMO_V1_ENABLED=true`, `OFFICIAL_PDF_OPERATIONAL_MODE=SYNTHETIC_ISOLATED`, `OFFICIAL_PDF_SYNTHETIC_ISOLATION_ID`, `OFFICIAL_PDF_S3_*` | |
| `TRACK2_CANDIDATE_IMPORT_ENABLED`, `TRACK2_CANDIDATE_IMPORT_OPERATIONAL_MODE`, `TRACK2_CANDIDATE_IMPORT_SYNTHETIC_ISOLATION_ID`, `TRACK2_CANDIDATE_IMPORT_REFERENCE_HMAC_MASTER_KEY`, `TRACK2_CANDIDATE_IMPORT_REFERENCE_HMAC_KEY_VERSION` | 격리 ID는 PDF와 같게 |
| `FAN_REPORT_*`, `EVIDENCE_PRESERVATION_*`, `ticket-defender.security.admin.*` | 저장소와 인증 |

5. Frontend: `VITE_ADMIN_AUTH_PROVIDER=keycloak`, `VITE_ADMIN_AUTH_ISSUER`, `VITE_ADMIN_AUTH_CLIENT_ID`, `VITE_ADMIN_AUTH_AUDIENCE`, `VITE_FAN_REPORT_EVENT_ID`, `VITE_FAN_REPORT_EVENT_LABEL`, `VITE_SYNTHETIC_RESERVATION_IMPORT_UI=true`, `TD_DEV_API_PROXY_TARGET`를 설정하고 `http://localhost:15173`에서 실행합니다.
6. 합성 tenant를 `official_pdf_synthetic_tenants`와 합성 반입 등록부에 Case 생성 전에 등록합니다. tenant, event, performance UUID는 격리 환경에서 확정한 값을 씁니다.

역할 계정: `TENANT_ADMIN`, `ANALYST`, `REVIEWER`, 그리고 요청자와 다른 subject의 `APPROVER`.

## 공통 사전 작업 (TENANT_ADMIN)

| 순서 | 화면 | 동작 | 기대 |
| --- | --- | --- | --- |
| 1 | `/app/verified-performances` | 공연 선택 후 회차 등록, 참조 `AKMU-DAEJEON-20261205-1800` | ACTIVE 회차 |
| 2 | `/app/settings` 구매 한도 정책 | `정책 등록`: 회차 선택, 최대 2, 버전 `akmu-demo-policy-r1`, 시작 `2026-11-01T00:00`, 출처와 근거 입력, ACCOUNT, PERFORMANCE, NETTED, 선예매 제외 | 적용 중, 의미 값 확인됨 |
| 3 | `/app/imports` | sourceVersion `akmu-demo-reservations-v1`, 완전한 스냅샷 예, `reservation_snapshot.csv` 전체 붙여넣기 | ACCEPTED 67행 |
| 4 | `/app/analysis/quantity` | 원장 버전 `akmu-demo-ledger-v1`, 기준시각 `2026-11-08T10:00:00Z`, 산정 기준 `SYNTHETIC_PROVIDER_TICKET_LEDGER`, 완전함, `quantity_ledger.csv` 붙여넣고 `원장 반입` | ACCEPTED 67행 |

점검: 403은 역할, 버전 충돌은 이미 반입된 `sourceVersion`입니다. `RESERVATION_IMPORT_*` 코드는 합성 격리 설정과 등록부를 확인합니다.

## Case 1: 원장 반입 → 분석 → 군집과 허브 → GRAPH_CLUSTER → 승인 → PDF

| 순서 | 역할 | 화면 | 동작 | 기대 상태 |
| --- | --- | --- | --- | --- |
| 1 | ANALYST 또는 TENANT_ADMIN | `/app/analysis/quantity` | `분석 실행` | SUCCEEDED, EVALUATED, `akmu-over` 3매 신호 1건 |
| 2 | 동일 | 같은 화면 | `이 실행 다시 조회` | 대량 공유 관찰 R4 20계정, N2 30계정. 군집과 별도 |
| 3 | REVIEWER | `/app/analysis/findings` | 조사 우선순위 최상위 그룹(R1) 열기 | 저장 간선 그래프, 공유 근거 |
| 4 | REVIEWER | 군집 상세 Case 생성 영역 | 사유 입력 후 생성 | GRAPH_CLUSTER OPEN |
| 5 | REVIEWER | `/app/cases/:id` | 담당자 지정 → 분류 완료 → 검토 중 → 근거 묶음 생성 → 초안 작성 | 저장 |
| 6 | REVIEWER | 같은 화면 증거 무결성 | 파일 증거가 있으면 검증, `무결성 평가 조회` | 서버 값 표시 |
| 7 | REVIEWER | 같은 화면 승인 요청 제출 | 사유 입력 | PENDING |
| 8 | APPROVER | `/app/approvals`에서 목록의 요청 열기 | 검토 수령 후 승인 | 결정 저장, 자기 승인은 403 |
| 9 | APPROVER 또는 권한 역할 | 결정 직후 링크 또는 `/app/report-center` | 적격성 확인 → 발급 → 다운로드 | 발급 완료, 파일 다운로드, 감사 기록 |

R2는 실측에서 2개 커뮤니티로 분할됩니다. R4, N2의 네트워크 유형은 Backend 원장에 입력이 없어 미확인으로 표시됩니다.

## Case 2: listing_A → 실제 Gemini → MATCH_CANDIDATE → FAN_REPORT → 승인 → PDF

| 순서 | 역할 | 화면 | 동작 | 기대 상태 |
| --- | --- | --- | --- | --- |
| 1 | 비로그인 | `/fan/write` | 공연 시각 2026-12-05 18:00, `listing_A.png` 업로드 후 제출 | 접수번호 |
| 2 | ANALYST 또는 REVIEWER | `/app/fan-reports` → 제보 열기 | 이미지 정보 추출 실행 | COMPLETED, 구역 19, 열 8, 좌석 12, 가격 200000, 통화 KRW FOUND, 근거 인용 표시. 사전 호출 1회에서 통과했으나 **`MODEL_RESPONSE_INVALID`가 나올 수 있음(아래 오류 점검)** |
| 3 | 동일 | 같은 화면 | 회차 연결 | ACTIVE 연결 |
| 4 | 동일 | 같은 화면 | 예매 기록 비교 실행 | MATCH_CANDIDATE 목표. 확정 판정이 아님 |
| 5 | REVIEWER | 같은 화면 Case 생성 | 제보, 증거, 후보 실행 선택 | FAN_REPORT OPEN |
| 6~9 | | Case 1의 5~9 | 근거 묶음, 초안, 무결성 검증, 승인, 발급 | DEMO_V1에서 후보 근거 허용 |

비교 확인용: `listing_B`(21구역 20열 16번)는 NO_MATCH, `listing_C`는 UNKNOWN 또는 UNVERIFIABLE 목표입니다.

## Case 3: R2 군집 + listing_A 후보 → COMBINED → LINKED → 승인 → PDF

| 순서 | 역할 | 화면 | 동작 | 기대 상태 |
| --- | --- | --- | --- | --- |
| 1 | REVIEWER | `/app/analysis/findings` | R2 그룹 중 19구역 8열 12번이 있는 그룹 찾기. 원장 좌석 조회에 회차와 `akmu-demo-reservations-v1` 입력 | 좌석 19/8/12 |
| 2 | REVIEWER | Case 생성 | 새 `listing_A.png` 제보를 접수하고 Case 2의 2~4단계(실제 Gemini 분석, 회차 연결, 예매 기록 비교)를 마친 뒤 R2 군집과 함께 연결 | COMBINED OPEN |
| 3 | REVIEWER | `/app/cases/:id` Track 1 연결 비교 | 조회 | LINKED, 연결 근거 예매 참조 일치 |
| 4~ | | Case 1의 5~9 | 근거 묶음부터 발급까지 | 발급 완료 |

## 오류 점검

| 증상 | 확인 |
| --- | --- |
| 이미지 분석 `MODEL_RESPONSE_INVALID` | 모델 응답이 서버 검증에 거부됨. 실패 기록을 남기고 새 실행으로 재시도. 값을 고치지 않음 |
| 이미지 분석 503 | `check_demo_env.py`, FastAPI 실행, 내부 키 일치 |
| 분석 실행 FAILED `ANALYZER_*` | Neo4j GDS, `TRACK1_INTERNAL_SHARED_SECRET`, `TRACK1_INTERNAL_READ_TIMEOUT` |
| 평가 `POLICY_NOT_CONFIRMED` | 정책 의미 값 4개와 기간 |
| 평가 `QUANTITY_DATA_INCOMPLETE` | 완전한 스냅샷 선택, 티켓 상태 |
| 승인 요청 `APPROVAL_BASIS_BLOCKED` | `OFFICIAL_PDF_DEMO_V1_ENABLED`, 합성 격리 ID, 등록부 등록 시각 |
| PDF 적격성 차단 | 무결성 검증, Object Lock, STALE, IssuanceHold |
| 403 | 역할. 요청자와 승인자가 같은지 확인 |

## 현재 검증 상태

| 항목 | 상태 |
| --- | --- |
| 실제 Gemini의 listing_A 필드 추출 (Data 경로, 1회) | PASS |
| MATCH_CANDIDATE 후보 대조 | NOT_RUN |
| LINKED 연결 비교 | NOT_RUN |
| 공식 PDF 3건 | NOT_RUN |

## 기록 방법

단계별 HTTP 상태, 서버 코드, 커밋 SHA를 PASS, FAIL, BLOCKED, NOT_RUN으로 남깁니다. 토큰, 비밀번호, 예매 원문, HMAC 값은 기록하지 않습니다.
