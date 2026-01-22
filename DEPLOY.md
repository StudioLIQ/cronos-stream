# DEPLOY.md — Stream402 (Railway, demo/testnet)

이 문서는 **백엔드(API + MySQL)** 를 Railway에 배포하는 절차를 정리합니다.  
이 레포는 데모/테스트넷 전용이라, **환경변수도 UI 대신 “파일로 커밋해서 관리”** 할 수 있게 되어 있습니다.

> 주의: 실제 서비스(메인넷/프로덕션)에서는 `.env.*`를 커밋하는 방식은 절대 권장하지 않습니다.

---

## 0) TL;DR (권장 구성)

- Railway Project에 서비스 2개 생성
  - `mysql` (Railway MySQL)
  - `api` (apps/api)
- 설정은 `apps/api/.env.railway`를 수정/커밋해서 관리
- 포트는 Railway의 `PORT`를 자동 인식하므로 `API_PORT` 설정/주입 불필요

---

## 1) 사전 준비

- Node.js 20+
- pnpm
- Railway 계정
- Cronos Testnet 지갑 주소(수령자): `SELLER_WALLET`

---

## 2) “파일 기반 env” 사용법 (중요)

API는 아래 파일들을 **자동으로 로드**합니다(앞이 우선순위가 높음).

1) `apps/api/.env.local` (로컬 개인용, gitignore)
2) `apps/api/.env` (로컬 개인용, gitignore)
3) `apps/api/.env.railway` (데모 배포용, 커밋 가능)
4) `apps/api/.env.demo` (옵션, 커밋 가능)

- 로더 구현: `apps/api/src/env.ts`
- Railway에서 주입되는 환경변수(예: `PORT`, `MYSQL_URL`)는 **파일보다 우선**합니다.

---

## 3) Railway 배포 (API + MySQL)

### 3-1) Railway 프로젝트 생성 & GitHub 연결

1) Railway → **New Project**
2) **Deploy from GitHub Repo**로 이 레포 연결

### 3-2) MySQL 추가

1) Railway 프로젝트에서 **New → Database → MySQL** 추가
2) (권장) API 서비스와 같은 프로젝트 내에 두고 내부 네트워크로 연결합니다.

### 3-3) API 서비스 생성

1) Railway 프로젝트에서 **New → Service → GitHub Repo**로 API 서비스 생성
2) 빌드/실행은 pnpm workspace 기준으로 “레포 루트에서” 수행하는 걸 권장합니다.

### 3-4) Build / Start 커맨드 (pnpm workspace)

Railway 서비스 설정에서 다음을 사용합니다:

- **Install**: `pnpm install`
- **Build**: `pnpm --filter @stream402/api build`
- **Start**: `pnpm --filter @stream402/api start`

포트:
- Railway는 `PORT`를 자동 주입하고, API는 `PORT`를 자동으로 사용합니다. (`apps/api/src/config.ts`)

### 3-5) DB 연결 (2가지 중 택1)

**A안(권장): Railway MySQL “Link” 사용**

- MySQL 서비스를 API 서비스에 **Link/Connect** 하면 Railway가 보통 아래 값을 자동 주입합니다:
  - `MYSQL_URL` 또는 `MYSQLHOST/MYSQLPORT/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE`
- API는 위 변수를 자동 지원합니다. (`apps/api/src/config.ts`)

**B안: DB 접속 정보도 파일에 하드코딩**

1) Railway MySQL의 접속 정보를 확인
2) `apps/api/.env.railway`에 `DATABASE_URL=...`(또는 `DB_*`)를 채워 넣고 커밋/푸시

### 3-6) 설정(지갑/토큰) 반영

1) `apps/api/.env.railway`에서 아래를 원하는 값으로 수정 후 커밋/푸시:
   - `SELLER_WALLET`
   - `DASHBOARD_TOKEN` (외부 공개 시 반드시 변경)
   - `DEFAULT_NETWORK` (= `cronos-testnet` 권장)
   - (선택) Membership NFT (ERC-1155)
     - `MEMBERSHIP_NFT_ADDRESS_CRONOS_TESTNET`
     - `MEMBERSHIP_NFT_MINTER_PRIVATE_KEY` (**절대 커밋하지 말고** Railway 환경변수로 주입 권장)
2) Railway가 자동으로 재배포합니다.

### 3-7) 배포 확인

- 헬스체크: `https://<railway-domain>/health`
- 채널 조회: `https://<railway-domain>/api/channels/demo`

---

## 4) (선택) Web 배포

### 4-1) Vercel + /api 프록시 (기존 방식)

- `apps/web/vercel.json`에서 `<railway-origin>`만 실제 Railway 도메인으로 교체
- Viewer/Overlay/Dashboard:
  - `https://<vercel-domain>/v/demo`
  - `https://<vercel-domain>/o/demo`
  - `https://<vercel-domain>/d/demo`

### 4-2) “API가 Web 정적 파일까지 서빙” (Railway 1서비스로도 가능)

API는 `apps/web/dist`가 존재하면 정적 파일을 같이 서빙합니다.

- Build를 루트에서 한 번에:
  - **Build**: `pnpm build`
  - **Start**: `pnpm start`

---

## 5) 문제 해결

### Railway에서 502/timeout
- `Start` 커맨드가 실제로 프로세스를 띄우는지 로그 확인
- `PORT` 사용 여부 확인 (`apps/api/src/config.ts`)

### DB 연결 실패
- A안(Link)이라면 API 서비스에 `MYSQL_URL`/`MYSQLHOST...`가 주입됐는지 확인
- B안(파일 하드코딩)이라면 `apps/api/.env.railway`의 `DATABASE_URL`이 올바른지 확인

### 대시보드 접속이 안 됨
- `DASHBOARD_TOKEN`이 기대값인지 확인
- 브라우저 로컬스토리지에 예전 토큰이 남아있으면 다시 입력
