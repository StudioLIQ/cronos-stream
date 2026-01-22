# DEPLOY.md — Stream402 (Vercel + Railway)

이 문서는 프론트는 Vercel, 백엔드는 Railway에 배포하는 전체 체크리스트입니다.

## 0) 준비물

- Node.js 20+
- pnpm
- Vercel / Railway 계정
- Cronos 테스트넷 지갑 주소(SELLER_WALLET)

---

## 1) Railway — API 배포 (apps/api)

### 1-1. 새 프로젝트 생성

- Railway에서 **New Project → Deploy from GitHub**로 이 레포 연결
- 서비스 루트는 `apps/api` 또는 루트에서 빌드/스타트 커맨드를 지정

### 1-2. 빌드/스타트 커맨드

Railway는 `PORT` 환경변수를 주입합니다. 이 앱은 `API_PORT`를 사용하므로 둘을 맞춰야 합니다.

추천 설정(루트 기준):

- **Install**: `pnpm install`
- **Build**: `pnpm --filter @stream402/api build`
- **Start**: `sh -c "API_PORT=$PORT pnpm --filter @stream402/api start"`

> `apps/api` 루트로 배포한다면 Build/Start는 `pnpm build`, `pnpm start`로 단순화 가능.

### 1-3. 환경변수 설정

필수:
- `SELLER_WALLET` = 스트리머 지갑 주소

외부 공개 데모(권장):
- `DASHBOARD_TOKEN` = 대시보드 접속 토큰 (외부 공개 시 반드시 강한 랜덤값으로 변경)
- `DEFAULT_NETWORK` = `cronos-testnet` (기본값)
- `LOG_LEVEL` = `info` 또는 `debug` (선택)

포트:
- `API_PORT` = Railway의 `PORT`와 동일한 값
  - 위 Start 커맨드로 자동 주입하면 별도 설정 불필요

DB (데이터 유지 필요 시 필수):
- MySQL 사용 권장 (Railway MySQL 또는 외부 MySQL)
- 아래 둘 중 하나로 설정:
  - `DATABASE_URL=mysql://user:pass@host:3306/stream402`
  - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

### 1-4. 배포 확인

- API 헬스체크: `<railway-origin>/health`
- 정상 응답 예시: `{ "status": "ok" }`

---

## 2) Vercel — Web 배포 (apps/web)

웹은 API를 **같은 오리진의 `/api`** 경로로 호출합니다. 따라서 Vercel에서 `/api/*`를 Railway로 프록시하는 설정이 필요합니다.

### 2-1. 새 프로젝트 생성

- Vercel에서 **New Project → Import**
- Root Directory: `apps/web`
- Build Command: `pnpm build`
- Output Directory: `dist`

### 2-2. /api 프록시 설정 (Vercel Rewrite)

웹 라우팅(React Router)과 `/api` 프록시를 위해 `apps/web/vercel.json`을 사용합니다. 아래 파일의 `<railway-origin>`만 실제 도메인으로 바꿔주세요.

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "<railway-origin>/api/$1"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```
> - SSE(`/api/.../stream/...`)도 이 프록시 경로를 통해 동작합니다.  
> - `/v/:slug`, `/o/:slug`, `/d/:slug` 같은 SPA 라우팅이 404가 나지 않도록 `index.html`로 폴백합니다.

### 2-3. 배포 확인

- Viewer: `https://<vercel-domain>/v/demo`
- Overlay: `https://<vercel-domain>/o/demo`
- Dashboard: `https://<vercel-domain>/d/demo`
  - 토큰: `DASHBOARD_TOKEN` 값 (기본은 `demo-token`)

---

## 3) 운영 체크리스트

- [ ] `SELLER_WALLET`이 실제 테스트넷 지갑으로 설정됨
- [ ] Railway API의 `/health` 정상 응답
- [ ] Vercel `/api/*`가 Railway로 정상 프록시됨
- [ ] Viewer/Overlay/Dashboard 페이지 정상 로드
- [ ] 대시보드 토큰 입력 후 Q&A 큐 접근 가능

---

## 4) 외부 공개 데모용 보안/영속성 설정 (필수)

아래 1~3은 **외부 공개 데모** 기준의 필수 작업입니다. 주니어가 그대로 따라할 수 있게 스텝바이스텝으로 작성했습니다.

### 4-1. Vercel `/api` 리라이트 활성화 (vercel.json 사용)

1) Railway에서 배포된 API 도메인을 확인합니다.  
   - 예시: `https://stream402-api.up.railway.app`
2) `apps/web/vercel.json`을 열고 `<railway-origin>`을 실제 도메인으로 교체합니다.  
   - 파일: `apps/web/vercel.json`
3) 변경사항을 커밋/푸시합니다.
4) Vercel 프로젝트에서 새 배포가 완료되면 아래 URL로 프록시 동작을 확인합니다.  
   - `https://<vercel-domain>/api/channels/demo`

### 4-2. Railway MySQL로 DB 영속화

1) Railway 프로젝트에서 **MySQL DB**를 추가합니다. (New → Database → MySQL)
2) 생성된 DB의 연결 정보를 확인합니다.
3) API 서비스 환경변수에 아래 둘 중 하나로 연결 정보를 설정합니다:
   - `DATABASE_URL=mysql://user:pass@host:3306/stream402`
   - 또는 `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
4) 서비스 재배포(Deploy) 후 로그에서 `DB: mysql://...`가 기대값으로 찍히는지 확인합니다.

### 4-3. Dashboard Token 강화 (공개 데모 필수)

1) 안전한 랜덤 토큰을 생성합니다.  
   - 예시(로컬 터미널): `openssl rand -hex 32`
2) Railway 환경변수에 `DASHBOARD_TOKEN`을 새 값으로 설정합니다.
3) 서비스 재배포(Deploy) 후, 대시보드에서 새 토큰으로 로그인합니다.  
   - `https://<vercel-domain>/d/demo`
4) 브라우저에 예전 토큰이 저장되어 있으면 대시보드에서 새 토큰을 다시 입력합니다.  
   - (로컬스토리지에 저장되므로, 입력하면 자동 갱신됨)

---

## 5) 문제 해결

### API가 502/timeout
- `API_PORT`가 Railway의 `PORT`와 일치하는지 확인
- `Start` 커맨드가 `API_PORT=$PORT`를 주입하는지 확인

### /api 호출이 실패하거나 CORS 오류
- Vercel Rewrite가 정확한지 확인
- Rewrite 없이 직접 Railway 도메인 호출 시에는 브라우저 CORS 문제가 발생할 수 있으니 프록시 방식 권장

### 데이터가 사라짐
- 영속 DB(MySQL)를 사용 중인지 확인 (Railway MySQL 또는 외부 MySQL)
- DB 연결 정보(`DATABASE_URL` 또는 `DB_*`)가 올바른지 확인

---

## 6) 참고

- API는 부팅 시 `demo` 채널을 자동 시드합니다.
- 프로덕션에서도 `/api/channels/:slug/stream/...` SSE가 필요합니다.
- Cronos 테스트넷 사용 시 지갑에 테스트 USDC.e 및 가스용 TCRO가 필요합니다.
