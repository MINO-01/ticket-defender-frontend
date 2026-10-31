# Ticket Defender Frontend

Ticket Defender의 관리자 화면과 팬 제보 화면을 위한 React 프런트엔드입니다.

## 개발 환경

Node.js 22.13 이상(22.x), 24.x 또는 26 이상과 npm을 사용합니다.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
```

관리자 화면은 `/app/overview`, 팬 제보 화면은 `/fan/guide`에서 시작합니다. 관리자 화면은 공통 레이아웃과 라우팅 미리보기이며, 팬 제보 화면은 Backend W02 팬 제보 접수와 접수 상태 조회 API에 연결됩니다. 관리자 인증과 관리자 API 연동은 제공하지 않습니다. 공식 PDF 발급도 비활성화 상태입니다.

FE-02 팬 제보 화면은 브라우저 메모리에서 입력과 JPEG·PNG 첨부파일을 유지하고, 제출 전 확인까지만 지원합니다. 현재 프런트엔드에서는 첨부 없이도 확인 단계로 이동할 수 있습니다. 이는 임시 UI 정책이며 최종 접수 계약은 아닙니다. 후속 Backend 계약에서는 이미지 없는 제보의 일반 검토 접수 가능 여부를 검토하고, 이미지가 없을 때 VLM 분석을 자동 실행하지 않도록 정해야 합니다. 첨부 필수 여부와 증거 충분성 판단은 별도 정책으로 확정해야 합니다.

## 팬 제보 접수 API 연동

팬 제보 화면은 `POST /api/v1/fan-reports`(multipart)와 `POST /api/v1/fan-reports/lookup`(JSON)을 동일 출처로 호출합니다. 계약은 Backend `docs/api/fan-report-intake-v1.yaml`을 따릅니다.

- Backend의 팬 제보 접수는 기본 비활성입니다. 격리된 합성 데이터 환경에서만 활성화해 검증합니다.
- Backend에는 공개 공연 목록 API가 없습니다. 그래서 실제 접수 공연은 `VITE_FAN_REPORT_EVENT_ID`에 서버에 등록된 공연 UUID를 명시적으로 넣는 방식으로만 제공합니다. 값이 없거나 UUID 형식이 아니면 실제 제출 버튼이 비활성화되고 시연용 공연만 표시됩니다. 공연의 활성 여부와 제보 허용 여부는 Backend가 최종 검증합니다.
- 시연용 공연 `DEMO_AUTUMN_LIVE`는 실제 접수 API로 전송하지 않습니다.
- 개발 서버에서는 `TD_DEV_API_PROXY_TARGET`을 설정하면 `/api` 요청을 로컬 Backend로 전달합니다. 운영 CORS 정책은 변경하지 않습니다.
- `Idempotency-Key`(UUID v4)와 `Report-Recovery-Secret`(32바이트 난수, Base64url 43자)은 첫 제출 때 브라우저 Web Crypto로 생성해 현재 탭의 메모리에만 보관합니다. 응답 유실이나 결과 불명확 상태에서는 같은 키, 비밀, 입력, 파일 순서로 재전송합니다. 새로고침하거나 탭을 닫으면 재시도 정보가 사라져 복구할 수 없습니다.
- 복구 비밀, 조회 코드, 입력 내용은 URL, 로그, localStorage, sessionStorage에 기록하지 않습니다.

설정 예시는 `.env.example`을 참고합니다.

스타일은 `src/styles/tokens.css`의 CSS Custom Properties와 컴포넌트별 CSS Modules로 구성합니다. 브라우저에는 공개 가능한 설정만 전달해야 합니다.
