# LOCAL.md — Stream402 로컬 개발/디버깅 가이드

이 문서는 로컬에서 **API + Web을 실행하고 디버깅**하는 절차를 단계별로 정리합니다.

---

## 0) 준비물

- Node.js 20+
- pnpm
- Docker (Docker Desktop 또는 Docker Engine)
- 크로노스 테스트넷 지갑(SELLER_WALLET)
- (선택) MetaMask 또는 호환 지갑

---

## 1) 설치

1) 레포 루트에서 의존성 설치:

```bash
pnpm install
```

---

## 2) 지갑/테스트넷 준비 (데모 결제 테스트용)

이 단계는 **유료 액션/질문 결제 플로우까지 확인**하려면 필요합니다.

### 2-1. Cronos Testnet 네트워크 추가 (MetaMask 기준)

1) MetaMask → **Settings → Networks → Add network**  
2) 아래 값 입력:
   - Network Name: `Cronos Testnet`
   - RPC URL: `https://evm-t3.cronos.org`
   - Chain ID: `338`
   - Currency Symbol: `TCRO`
   - Block Explorer: `https://explorer.cronos.org/testnet`
3) 네트워크 전환 후 테스트넷 지갑 주소 복사

### 2-2. 테스트용 TCRO 받기 (가스비)

1) Cronos Testnet Faucet 접속  
   - 공식 안내 문서:  
     ```text
     https://docs.cronos.org/for-users/testnet-faucet
     ```
   - Faucet URL:  
     ```text
     https://cronos.org/faucet
     ```
2) 지갑 주소 입력
3) 테스트 TCRO 수령 (트랜잭션 승인용 가스비)
4) 일일 한도에 걸리면 공식 문서에 안내된 Discord 채널에서 요청

### 2-3. 테스트 USDC.e 받기

USDC.e 컨트랙트(테스트넷):
`0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0`

1) Faucet/테스트 토큰 소스에서 devUSDC.e 받기  
2) MetaMask에 토큰 추가(선택):
   - Token Contract: 위 주소
   - Symbol: `USDC.e`
   - Decimals: `6`

> 결제 테스트는 지갑에 **TCRO + USDC.e**가 있어야 정상 동작합니다.

---

## 2) 환경변수 설정 (API)

API는 아래 파일들을 자동으로 읽습니다(앞이 우선순위가 높음):

1) `apps/api/.env.local` (로컬 개인용, gitignore)
2) `apps/api/.env` (로컬 개인용, gitignore)
3) `apps/api/.env.railway` (데모/테스트넷용, 커밋 가능)
4) `apps/api/.env.demo` (옵션, 커밋 가능)

### 2-1) 로컬 개인 설정(권장)

1) `apps/api/.env` 생성:

```env
# 필수: 수령 지갑 주소
SELLER_WALLET=0xYourWalletAddress

# 선택: 대시보드 접속 토큰 (기본값: demo-token)
DASHBOARD_TOKEN=your-secret-token

# 선택: 네트워크 (기본값: cronos-testnet)
DEFAULT_NETWORK=cronos-testnet

# 선택: 포트 (기본값: 3402)
API_PORT=3402

# DB (MySQL) — 로컬은 docker-compose.yml 사용 권장
# 1) 레포 루트에서: docker compose up -d mysql
# 2) 아래 값은 docker-compose.yml 기본값과 매칭됨
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=stream402
DB_PASSWORD=stream402
DB_NAME=stream402

# (선택) Membership NFT (ERC-1155)
# - 설정하면 멤버십 결제 후 ERC-1155 멤버십 NFT를 추가로 민팅합니다.
# - 민터 지갑은 해당 네트워크의 가스비(TCRO)를 보유해야 합니다.
# MEMBERSHIP_NFT_ADDRESS_CRONOS_TESTNET=0x...
# MEMBERSHIP_NFT_ADDRESS_CRONOS_MAINNET=0x...
# MEMBERSHIP_NFT_MINTER_PRIVATE_KEY=0x...

# (옵션) 단일 URL로 쓰고 싶으면 아래로 대체 가능
# DATABASE_URL=mysql://stream402:stream402@127.0.0.1:3307/stream402
```

2) 저장 후 커밋하지 말 것 (로컬 전용).

---

## (선택) Membership NFT 배포/설정

멤버십은 x402 결제 정산 후, 서버가 **ERC-1155 멤버십 NFT를 추가로 민팅**할 수 있습니다.

- `MEMBERSHIP_NFT_ADDRESS_CRONOS_TESTNET`: 배포한 ERC-1155 컨트랙트 주소
- `MEMBERSHIP_NFT_MINTER_PRIVATE_KEY`: 컨트랙트 `mint()` 권한을 가진 민터 지갑 프라이빗키
- 민터 지갑은 **가스비(TCRO)** 를 보유해야 합니다.

토큰 ID는 채널 slug 기반으로 결정됩니다:
- `tokenId = keccak256("stream402:membership:<slug>")` (uint256)

### 2-2) 데모/테스트넷 공용 설정(옵션)

- Railway 배포/공유를 쉽게 하려면 `apps/api/.env.railway`를 수정해서 커밋해도 됩니다.
- 실제 서비스에서는 이 방식(환경변수 파일 커밋)을 절대 권장하지 않습니다.

---

## 3) 로컬 실행 (개발 모드)

### 3-0. MySQL 실행 (필수)

레포 루트에서:

```bash
docker compose up -d mysql
```

### 3-1. API + Web 동시에 실행 (추천)

루트에서:

```bash
pnpm dev
```

기본 접속 주소:
- API: `http://localhost:3402`
- Web: `http://localhost:5173`

> Web 개발 서버는 `/api` 요청을 자동으로 `http://localhost:3402`로 프록시합니다.

### 3-2. API만 실행

```bash
pnpm --filter @stream402/api dev
```

### 3-3. Web만 실행

```bash
pnpm --filter @stream402/web dev
```

---

## 4) 로컬 실행 (프로덕션 모드)

빌드 후 API에서 정적 웹을 서빙합니다.

```bash
pnpm build
pnpm start
```

접속:
- `http://localhost:3402/v/demo`
- `http://localhost:3402/o/demo`
- `http://localhost:3402/d/demo`

---

## 5) 기본 검증 시나리오

1) API 헬스 체크:
   - `http://localhost:3402/health`
2) Demo 채널 확인:
   - `http://localhost:3402/api/channels/demo`
3) Web 화면 확인:
   - `http://localhost:5173/v/demo` (Viewer)
   - `http://localhost:5173/o/demo` (Overlay)
   - `http://localhost:5173/d/demo` (Dashboard)
4) Dashboard 토큰 입력:
   - 기본값: `demo-token`
   - `.env`에서 바꿨다면 그 값으로 입력
5) (선택) Viewer에서 유튜브 스트림 링크 변경:
   - 기본값: `https://www.youtube.com/watch?v=Ap-UM1O9RBU`
   - `http://localhost:5173/v/demo` → Live 섹션 아래 입력창에 유튜브 채널 ID(UC...) 또는 유튜브 URL 입력 → Apply
   - Reset 버튼으로 기본값으로 복원 (이 설정은 브라우저에만 저장됨)
6) (선택) Viewer에서 후원 테스트:
   - `http://localhost:5173/v/demo` → Donate 섹션에서 금액 입력/프리셋 선택 → Donate
   - 스트리머 오버레이 `http://localhost:5173/o/demo`에서 donation alert 표시 확인

---

## 6) DB 초기화/리셋

MySQL 볼륨을 지우면 초기 상태로 돌아갑니다.

1) 서버 종료
2) 레포 루트에서 DB 컨테이너/볼륨 제거:

```bash
docker compose down -v
```

3) 다시 `docker compose up -d mysql` 후 API를 켜면 `demo` 채널이 자동 시드됩니다.

---

## 7) 디버깅 팁

- **CORS/프록시**: 개발 모드에서는 Vite 프록시가 `/api`를 API로 자동 연결합니다.
- **SSE 확인**:
  - Overlay SSE: `GET /api/channels/:slug/stream/overlay`
  - Dashboard SSE: `GET /api/channels/:slug/stream/dashboard`
  - 브라우저 DevTools → Network에서 EventStream으로 확인
- **Dashboard 토큰**:
  - 토큰은 localStorage에 저장됩니다.
  - 변경 시 대시보드 페이지에서 새 토큰을 다시 입력하세요.

---

## 8) 자주 발생하는 문제

### API가 안 뜸
- `API_PORT`가 이미 사용 중인지 확인
- 포트를 바꾸면 Web 프록시를 함께 조정 필요 (기본은 3402)

### Viewer/Overlay에 이벤트가 안 뜸
- SSE 연결이 살아있는지 DevTools에서 확인
- API 로그에 에러가 없는지 확인

### Q&A가 안 보임
- Dashboard 토큰이 맞는지 확인
- 필터 상태(queued/showing 등) 확인

---

## 9) 로컬 데모 URL 모음

- Viewer: `http://localhost:5173/v/demo`
- Overlay: `http://localhost:5173/o/demo`
- Dashboard: `http://localhost:5173/d/demo`
- API Health: `http://localhost:3402/health`
