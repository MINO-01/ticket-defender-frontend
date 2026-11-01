# 캡스톤 검증용 Keycloak OIDC 환경

이 문서는 합성 데이터로 관리자 로그인과 Backend JWT 검증을 확인하기 위한 **캡스톤 격리 환경**을 설명합니다. 운영 인증 제공자 선정이나 개인정보 처리 운영 승인을 의미하지 않습니다. 운영 인증 제공자(OIDC 또는 기업 SSO)는 여전히 미확정입니다.

## 인증 기술 결정

| 항목 | 결정 |
| --- | --- |
| 인증 제공자 | 로컬 Keycloak 26.8.1 컨테이너(캡스톤 격리용) |
| Frontend SDK | 공식 `keycloak-js` 26.2.5 |
| 흐름 | Authorization Code + PKCE(S256), Public Client, client secret 없음 |
| 토큰 | RS256 Access Token, audience `ticket-defender-admin` |
| Backend | 기존 Spring Security OAuth2 Resource Server(issuer, JWKS, audience, exp, sub 검증) |
| 권한 | 기존 MySQL membership, role, event grant(`AdminAccessService`) |

선정 이유

- 무료 오픈소스이며 로컬 컨테이너 하나로 HTTPS issuer, JWKS, RS256, audience mapper를 모두 재현할 수 있습니다.
- 표준 OIDC만 사용하므로 Backend 코드를 바꾸지 않고 기존 Resource Server 설정 세 개로 연동됩니다.
- 공식 SDK가 state, nonce, PKCE verifier 생성과 콜백 검증을 담당해 자체 구현 위험이 적습니다.

검토한 대안

- 상용 IDaaS(Auth0, Okta, Cognito 등): 외부 계정과 외부 전송이 필요하고 합성 검증 환경에서 비용과 정책 검토가 추가됩니다.
- 범용 OIDC 클라이언트 라이브러리(oidc-client-ts 등): 사용할 수 있지만 제공자가 Keycloak이면 공식 SDK가 설정과 유지보수 면에서 단순합니다.
- 자체 로그인과 JWT 발급: 프로젝트 원칙상 금지합니다.

## Frontend 동작 요약

- `VITE_ADMIN_AUTH_PROVIDER=keycloak`과 HTTPS realm issuer가 모두 올바를 때만 로그인합니다. 값이 없거나 잘못되면 관리자 화면을 차단합니다.
- SDK는 관리자 보호 라우트가 처음 열릴 때만 불러오고 초기화합니다. 팬 제보 화면에서는 인증 서버에 접속하지 않습니다.
- 콜백 fragment(code, state)는 초기화 중 SDK가 읽고 주소에서 제거합니다. 초기화가 끝나기 전에는 하위 라우트를 렌더링하지 않아 라우터가 주소를 바꾸지 않습니다.
- 액세스 토큰은 SDK 인스턴스 메모리에만 있습니다. SDK는 일회용 거래 정보(state, nonce, PKCE verifier)만 콜백 처리 전까지 `kc-callback-*` 키로 보관하고 처리 후 삭제합니다.
- 토큰 갱신을 사용하지 않으며 만료되면 다시 로그인합니다. 새로고침 후에는 로그인 버튼을 누르면 Keycloak 세션으로 다시 인증합니다.
- 로그아웃은 `id_token_hint`가 URL에 남지 않도록 POST 방식으로 요청합니다.
- 토큰의 역할 claim으로 tenant나 업무 권한을 판단하지 않습니다.

## 격리 환경 구성

실제 운영 데이터, 기존 Windows MySQL80, 다른 세션의 컨테이너와 분리된 프로젝트 전용 이름과 포트를 사용합니다. 비밀번호, 인증서 개인키, truststore는 저장소 밖에 두고 커밋하지 않습니다.

1. 로컬 테스트 CA와 `localhost`, `127.0.0.1` SAN 서버 인증서를 저장소 밖에서 생성합니다.
2. Keycloak을 HTTPS로 실행합니다. 관리자 초기 계정은 `--env-file`로 전달합니다.

   ```bash
   docker run -d --name td-fe17-keycloak --memory 1g -p 127.0.0.1:18443:8443 \
     --env-file <저장소 밖>/keycloak.env \
     -v <저장소 밖>/server.crt:/opt/keycloak/conf/tls/server.crt:ro \
     -v <저장소 밖>/server.key:/opt/keycloak/conf/tls/server.key:ro \
     quay.io/keycloak/keycloak:26.8.1@sha256:3f3c5f8e03c614774b4bd9173b88391fefa4153bfc010d8012d59ad825377332 \
     start-dev --http-enabled=false --https-port=8443 \
     --https-certificate-file=/opt/keycloak/conf/tls/server.crt \
     --https-certificate-key-file=/opt/keycloak/conf/tls/server.key
   ```

3. `ticket-defender-demo-realm.json`을 관리 콘솔 또는 `kcadm.sh`로 가져옵니다. 사용자와 비밀번호는 포함하지 않습니다.
4. 합성 관리자 계정을 만들고 비밀번호는 저장소 밖에서 무작위로 생성합니다. Keycloak 사용자 ID가 JWT `sub`이므로 격리 MySQL `memberships.subject`에 같은 값을 넣습니다.
5. 격리 Spring에 다음 설정을 적용합니다. JVM에는 로컬 CA만 담은 전용 truststore(`-Djavax.net.ssl.trustStore`)를 지정하며 TLS 검증을 끄지 않습니다.

   | 설정 | 값 |
   | --- | --- |
   | `ticket-defender.security.admin.issuer` | `https://localhost:18443/realms/ticket-defender-demo` |
   | `ticket-defender.security.admin.jwk-set-uri` | `https://localhost:18443/realms/ticket-defender-demo/protocol/openid-connect/certs` |
   | `ticket-defender.security.admin.audience` | `ticket-defender-admin` |

6. Frontend 개발 서버를 `http://localhost:15173`에서 실행합니다. 값은 `.env.local` 또는 프로세스 환경 변수로 넣습니다.

   ```bash
   VITE_ADMIN_AUTH_PROVIDER=keycloak
   VITE_ADMIN_AUTH_ISSUER=https://localhost:18443/realms/ticket-defender-demo
   VITE_ADMIN_AUTH_CLIENT_ID=ticket-defender-web
   VITE_ADMIN_AUTH_AUDIENCE=ticket-defender-admin
   TD_DEV_API_PROXY_TARGET=http://127.0.0.1:18080
   ```

7. 브라우저가 로컬 테스트 CA를 신뢰해야 Keycloak 토큰 요청이 성공합니다. E2E 자동화에서는 Chrome `--ignore-certificate-errors-spki-list`로 테스트 서버 공개키 하나만 신뢰했습니다.

## 부정 검증용 테스트 클라이언트

만료, 잘못된 issuer, 잘못된 audience 토큰을 실제로 만들기 위해 격리 realm에만 direct access grant 테스트 클라이언트를 추가했습니다. realm 템플릿에는 포함하지 않으며 Frontend는 사용하지 않습니다.

- `td-e2e-probe`: audience mapper 포함, Access Token 수명 60초. `127.0.0.1` 주소로 발급하면 같은 키로 서명되지만 issuer가 달라집니다.
- `td-e2e-noaud`: audience mapper 없음

## 운영 환경과의 차이

- Keycloak `start-dev`, 내장 H2 저장소, 로컬 테스트 CA를 사용하므로 운영 구성이 아닙니다.
- Redirect URI와 Web Origin이 `http://localhost:15173`으로 고정되어 있습니다.
- 운영 인증 제공자, 세션 정책, MFA, 계정 수명주기, 감사 로그 보존은 별도 결정이 필요합니다.
