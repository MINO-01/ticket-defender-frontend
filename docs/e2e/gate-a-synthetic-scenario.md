# Gate A 합성 격리 시나리오

기준: Backend PR #80 `82c5899`, Data `feat/#30-track1-quantity-input-contract`. 이 문서는 실행 절차이며 결과 기록이 아닙니다. 실행하지 않은 단계는 NOT_RUN으로 기록합니다.

## 격리 조건

- 새 Compose 프로젝트 또는 새 컨테이너 이름, 전용 loopback 포트, 실행마다 생성한 비밀값을 사용합니다.
- run960, 기존 poster 환경, Windows MySQL80, 기존 볼륨과 버킷을 재사용하지 않습니다.
- Backend는 작업 폴더가 아니라 `git archive`로 추출한 복사본에서 빌드합니다.
- 합성 데이터만 사용합니다. 실제 팬 이미지와 외부 VLM 호출은 정책 승인과 노출된 키 교체 전에는 금지합니다.
- 권장 여유 메모리는 6GB 이상입니다(MySQL, MinIO, Keycloak, Neo4j GDS, Spring, FastAPI, Vite, Chrome).

## 서버 설정

| 구성 | 값 |
| --- | --- |
| 공식 PDF | `OFFICIAL_PDF_ENABLED=true`, `OFFICIAL_PDF_OPERATIONAL_MODE=SYNTHETIC_ISOLATED`, 실행별 `OFFICIAL_PDF_SYNTHETIC_ISOLATION_ID`, loopback MySQL, loopback 또는 미지정 저장소 endpoint |
| 합성 등록 | Case와 출처를 만들기 전에 `official_pdf_synthetic_tenants`에 `registered_at`을 생략하고 등록 |
| 증거 보존 | Object Lock 버킷과 `EVIDENCE_PRESERVATION_*` 설정. 없으면 승인과 발급이 차단되는 것이 정상 |
| Track 1 수신 | `/api/v1/audits/analyze`는 관리자 토큰이 아닌 분석 전용 JWT 체인. `TRACK1_INTERNAL_SHARED_SECRET`을 FastAPI와 일치 |
| Track 1 v2 | `TRACK1_V2_ENABLED` 기본 꺼짐. 켜도 웹 진입점과 조회 API가 없음 |
| Track 2 분석기 | `TRACK2_LISTING_ANALYSIS_*`. 실제 모델 없이 스텁을 쓰면 결과를 실제 VLM 품질로 기록하지 않음 |

## 시나리오

| 단계 | 동작 | 기대 결과 |
| --- | --- | --- |
| 1 | TENANT_ADMIN이 검증 회차 확인 후 구매 한도 정책 등록, 수정, 철회 | 201, 200, 200. 같은 버전 재사용과 낡은 `expectedRevision`은 409 |
| 2 | 합성 원장 신규 반입(`ticketReference` 포함 다좌석 포함) | ACCEPTED 또는 사유가 있는 REJECTED. run960 원장은 재반입하지 않음 |
| 3 | 분석 전용 JWT로 Track 1 합성 입력 전송 | 실제 `gds.louvain.stream` 실행, 군집 저장. 장애는 503으로 유지 |
| 4 | 군집 상세와 원장 좌석 조회 | 다좌석은 `seats[]` 전체 표시 |
| 5 | 팬 제보 접수, 조회, 증거 원본 조회 | 201, 200. 저장 실패는 실패 상태 유지 |
| 6 | 이미지 분석 실행 | COMPLETED, PARTIAL, UNVERIFIABLE, FAILED 구분 |
| 7 | 회차 연결과 후보 대조 | MATCH_CANDIDATE는 확정 판정이 아님 |
| 8 | 양 트랙 출처 Case 생성, `track1-candidate-links` 조회 | `linkBasis=RESERVATION_REFERENCE`, 후보 포함 Case의 승인은 `APPROVAL_BASIS_BLOCKED` |
| 9 | 후보 없는 Track 1 적격 Case: Snapshot, 초안, 무결성 검증, 승인 요청 | 승인 요청 201 |
| 10 | 다른 멤버십의 APPROVER가 ReviewReceipt 후 결정 | 자기 승인은 403 |
| 11 | 공식 PDF 적격성, 발급, 상태, 다운로드 | 발급과 승인 분리. 다운로드는 권한과 감사 확인 |
| 12 | 부정 경로 | 무인증 401, 역할 없음 403, 타 tenant 404, 근거 변경 후 STALE, IssuanceHold 차단, 레거시 PDF 409 |

## 기록 방법

단계별로 HTTP 상태, 서버 코드, 사용한 커밋 SHA를 PASS, FAIL, BLOCKED, NOT_RUN으로 남깁니다. 토큰, 비밀번호, 예매 원문, HMAC 값은 기록하지 않습니다. 실행 후 해당 격리 컨테이너와 임시 비밀값만 제거합니다.
