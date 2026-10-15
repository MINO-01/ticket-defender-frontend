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

관리자 화면은 `/app/overview`, 팬 제보 화면은 `/fan/guide`에서 시작합니다. 현재 화면은 공통 레이아웃과 라우팅 미리보기이며, 인증·제보 접수·API 연동은 제공하지 않습니다. 공식 PDF 발급도 비활성화 상태입니다.

스타일은 `src/styles/tokens.css`의 CSS Custom Properties와 컴포넌트별 CSS Modules로 구성합니다. 브라우저에는 공개 가능한 설정만 전달해야 합니다.
