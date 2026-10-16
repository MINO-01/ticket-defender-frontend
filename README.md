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

관리자 화면은 `/app/overview`, 팬 제보 화면은 `/fan/guide`에서 시작합니다. 관리자 화면은 공통 레이아웃과 라우팅 미리보기이며, 팬 제보 화면은 입력·첨부·최종 확인 UI까지 제공합니다. 인증·제보 접수·API 연동은 제공하지 않습니다. 공식 PDF 발급도 비활성화 상태입니다.

FE-02 팬 제보 화면은 브라우저 메모리에서 입력과 JPEG·PNG 첨부파일을 유지하고, 제출 전 확인까지만 지원합니다. 현재 프런트엔드에서는 첨부 없이도 확인 단계로 이동할 수 있습니다. 이는 임시 UI 정책이며 최종 접수 계약은 아닙니다. 후속 Backend 계약에서는 이미지 없는 제보의 일반 검토 접수 가능 여부를 검토하고, 이미지가 없을 때 VLM 분석을 자동 실행하지 않도록 정해야 합니다. 첨부 필수 여부와 증거 충분성 판단은 별도 정책으로 확정해야 합니다.

스타일은 `src/styles/tokens.css`의 CSS Custom Properties와 컴포넌트별 CSS Modules로 구성합니다. 브라우저에는 공개 가능한 설정만 전달해야 합니다.
