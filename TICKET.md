# TICKET.md — Implementation Tickets (Claude Execution Plan)

Rules for execution:
- Implement in order. Do not skip acceptance criteria.
- Default network: `cronos-testnet`.
- Keep dependencies minimal. TypeScript everywhere.
- Make it runnable from a fresh clone with `pnpm i && pnpm dev`.

---

## EPIC 0 — Repo bootstrap + tooling

### T0.1 — Initialize pnpm workspace
**Priority:** P0  
**Dependencies:** none  
**Deliverables:**
- Root `package.json` with workspace scripts (`dev`, `build`, `start`, `lint` optional).
- `pnpm-workspace.yaml` including `apps/*`.
- Create `apps/api` and `apps/web` with their own `package.json`.

**Acceptance criteria:**
- `pnpm -w i` succeeds.
- `pnpm -w dev` starts two processes (API + Web).

---

### T0.2 — TypeScript baseline + shared conventions
**Priority:** P0  
**Dependencies:** T0.1  
**Deliverables:**
- TS configs for both apps.
- Prettier config (optional) and consistent formatting.
- Basic logger utility in API.

**Acceptance criteria:**
- `pnpm -w build` passes with no TS errors.

---

## EPIC 1 — API foundation (Express + MySQL + SSE)

### T1.1 — API server skeleton
**Priority:** P0  
**Dependencies:** T0.1  
**Deliverables:**
- `apps/api/src/index.ts`: Express app, JSON middleware, error handler, CORS for dev.
- Health endpoint: `GET /health`.

**Acceptance criteria:**
- `curl http://localhost:<apiPort>/health` returns 200 JSON.

---

### T1.2 — MySQL schema + migration runner
**Priority:** P0  
**Dependencies:** T1.1  
**Deliverables:**
- `apps/api/src/db/schema.sql` with tables: channels, actions, qa_items, payments, blocks.
- `apps/api/src/db/migrate.ts` applies schema idempotently.
- `apps/api/src/db/db.ts` provides query helpers.

**Acceptance criteria:**
- On startup, DB schema exists.
- Re-start does not break (idempotent migrations).

---

### T1.3 — Seed script (demo channel + actions)
**Priority:** P0  
**Dependencies:** T1.2  
**Deliverables:**
- Seed on startup if no channels exist:
    - channel slug: `demo`
    - payToAddress from env (SELLER_WALLET)
    - actions:
        - `sticker_01` (type sticker, 50000)
        - `flash_01` (type flash, 50000)
        - `sound_airhorn` (type sound, 50000)
- Action payloads:
    - sticker: `imageUrl` (public URL)
    - flash: `durationMs`
    - sound: `audioUrl`

**Acceptance criteria:**
- `GET /api/channels/demo/actions` returns 3 actions.

---

### T1.4 — SSE broker (in-memory pubsub)
**Priority:** P0  
**Dependencies:** T1.1  
**Deliverables:**
- `apps/api/src/sse/broker.ts`:
    - per-channel topic
    - connect/disconnect
    - broadcast(eventName, data)
- SSE endpoints:
    - `GET /api/channels/:slug/stream/overlay`
    - `GET /api/channels/:slug/stream/dashboard`

**Acceptance criteria:**
- Connecting from browser receives `:keepalive` comment every 15s.
- Broadcasting an event pushes to connected clients.

---

## EPIC 2 — x402 integration (Cronos Facilitator)

### T2.1 — x402 constants + config
**Priority:** P0  
**Dependencies:** T1.1  
**Deliverables:**
- `apps/api/src/x402/constants.ts`:
    - FACILITATOR_URL
    - network constants for testnet/mainnet
    - USDC.e addresses
    - token name/version
- `apps/api/src/config.ts`:
    - API_PORT, DATABASE_URL (or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME)
    - DEFAULT_NETWORK (`cronos-testnet`)
    - SELLER_WALLET
    - DASHBOARD_TOKEN
    - Optional: allow `cronos` alias but normalize to `cronos-mainnet` internally.

**Acceptance criteria:**
- Server logs resolved network + asset + seller wallet on startup.

---

### T2.2 — Build paymentRequirements generator
**Priority:** P0  
**Dependencies:** T2.1  
**Deliverables:**
- Function `buildPaymentRequirements({ network, payTo, asset, amount, description, mimeType })`
- Ensure amounts are string base units and timeout is 300 seconds.

**Acceptance criteria:**
- Unit-like sanity checks: amount must be `/^\d+$/` string; otherwise throw.

---

### T2.3 — Facilitator client (verify/settle)
**Priority:** P0  
**Dependencies:** T2.1  
**Deliverables:**
- `apps/api/src/x402/facilitator.ts`:
    - `verifyPayment({ paymentHeaderBase64, paymentRequirements })`
    - `settlePayment({ paymentHeaderBase64, paymentRequirements })`
- Uses Axios with timeout (e.g., 15s) and sends headers:
    - `Content-Type: application/json`
    - `X402-Version: 1`

**Acceptance criteria:**
- On invalid header, `verifyPayment` returns `{ isValid:false, invalidReason }` cleanly.
- On settle failure, returns `{ event:"payment.failed", error }` cleanly.

---

### T2.4 — Payment idempotency + persistence
**Priority:** P0  
**Dependencies:** T1.2, T2.3  
**Deliverables:**
- Compute `paymentId = sha256(paymentHeaderBase64)` (Node crypto).
- Before verify/settle:
    - If payment exists and status=settled: return stored settlement data and DO NOT broadcast.
- After settle:
    - Insert/update `payments` row with txHash, from, to, value, timestamp.

**Acceptance criteria:**
- Repeating the same paid request does not create duplicate DB rows (unique constraint enforced).
- Repeating the same paid request does not emit a second SSE event.

---

## EPIC 3 — API routes (public + paywalled + dashboard)

### T3.1 — Public routes
**Priority:** P0  
**Dependencies:** T1.3  
**Deliverables:**
- `GET /api/channels/:slug` → channel info
- `GET /api/channels/:slug/actions` → enabled actions

**Acceptance criteria:**
- For unknown slug, return 404.

---

### T3.2 — Paywalled trigger route
**Priority:** P0  
**Dependencies:** T2.4, T1.4  
**Deliverables:**
- `POST /api/channels/:slug/trigger`
    - body `{ actionKey }`
    - If `X-PAYMENT` missing: 402 with requirements for that action amount.
    - Else: verify → settle → persist → emit `effect.triggered` with payload.
- Extract `X-PAYMENT` robustly (case-insensitive):
    - `req.get('X-PAYMENT')` and fallback to `req.headers['x-payment']`.

**Acceptance criteria:**
- Successful call emits SSE `effect.triggered` to overlay stream.

---

### T3.3 — Paywalled Q&A submission route
**Priority:** P0  
**Dependencies:** T2.4, T1.4  
**Deliverables:**
- `POST /api/channels/:slug/qa`
    - body `{ message, displayName?, tier }`
    - Pricing by tier (normal/priority).
    - Apply message policy BEFORE settle:
        - reject on banned patterns; return 400; do not settle.
    - On success:
        - insert `qa_items` status `queued`
        - emit `qa.created`

**Acceptance criteria:**
- Q&A appears in DB and SSE `qa.created` fires.
- Blocked wallet cannot submit (check `blocks` by fromAddress after verify decode is available; if not available pre-verify, block post-verify and reject pre-settle).

---

### T3.4 — Dashboard auth + queue operations
**Priority:** P0  
**Dependencies:** T1.4, T1.2  
**Deliverables:**
- Middleware: `Authorization: Bearer <DASHBOARD_TOKEN>`
- `GET /api/channels/:slug/qa?status=queued`
- `POST /api/channels/:slug/qa/:id/state` with `show|answered|skipped|blocked`
    - `show` sets status `showing` and emits `qa.show`
    - `answered/skipped` emits `qa.updated`
    - `blocked` inserts into blocks and updates qa item status

**Acceptance criteria:**
- Overlay receives `qa.show` and displays the question.

---

## EPIC 4 — Web app (Viewer / Overlay / Dashboard)

### T4.1 — Web app scaffold + routing
**Priority:** P0  
**Dependencies:** T0.1  
**Deliverables:**
- Vite React app with routes:
    - `/v/:slug` Viewer
    - `/o/:slug` Overlay
    - `/d/:slug` Dashboard
- Shared API base helper.

**Acceptance criteria:**
- Opening each route renders a page without runtime errors.

---

### T4.2 — Wallet connect + x402 client lib (browser)
**Priority:** P0  
**Dependencies:** T4.1  
**Deliverables:**
- MetaMask connect (minimal):
    - `window.ethereum.request({ method:'eth_requestAccounts' })`
    - ethers `BrowserProvider` + `getSigner()`
- Implement `createPaymentHeaderBase64({ signer, paymentRequirements })`:
    - nonce 32 bytes
    - validAfter 0
    - validBefore now(sec)+maxTimeoutSeconds
    - domain uses `Bridged USDC (Stargate)` / `1` / chainId / verifyingContract=asset
    - types `TransferWithAuthorization` as spec
    - `signer.signTypedData(domain, types, message)`
    - base64 encode JSON (btoa of UTF-8 safe encoding)

**Acceptance criteria:**
- Given a 402 response, the client can produce a base64 header and retry.

---

### T4.3 — Viewer page (actions + Q&A)
**Priority:** P0  
**Dependencies:** T4.2, T3.2, T3.3  
**Deliverables:**
- Fetch actions list.
- Render action buttons.
- Q&A form with tier selector.
- On click/submit:
    - call endpoint without payment
    - if 402: generate header; retry with `X-PAYMENT`
    - show progress states: “needs payment → signing → settling → done”
- Show transaction hash on success.

**Acceptance criteria:**
- Trigger action results in overlay effect when overlay is connected.

---

### T4.4 — Overlay page (SSE + rendering)
**Priority:** P0  
**Dependencies:** T1.4, T3.2, T3.4  
**Deliverables:**
- Connect to `/api/channels/:slug/stream/overlay` via EventSource.
- On `effect.triggered`:
    - sticker: show image for N seconds
    - flash: full-screen flash div for duration
    - sound: play audio URL
- On `qa.show`:
    - show large question text for (e.g.) 15 seconds or until replaced.

**Acceptance criteria:**
- OBS browser source displays effects and highlighted question reliably.

---

### T4.5 — Dashboard page (queue + controls)
**Priority:** P0  
**Dependencies:** T3.4, T1.4  
**Deliverables:**
- Auth input or env-based token entry (simple).
- Fetch queued items.
- Buttons: Show / Answered / Skip / Block.
- SSE subscription for `qa.created`, `qa.updated`.

**Acceptance criteria:**
- Clicking “Show” changes status and triggers overlay highlight.

---

## EPIC 5 — Integration polish + demo readiness

### T5.1 — Production “single server” mode (API serves built web)
**Priority:** P1  
**Dependencies:** T4.1, T1.1  
**Deliverables:**
- `pnpm build` builds web into `apps/web/dist`
- API serves static files in prod and falls back to index.html for SPA routes.

**Acceptance criteria:**
- `pnpm start` runs only API and serves the web UI.

---

### T5.2 — Demo script + troubleshooting docs
**Priority:** P1  
**Dependencies:** all P0 tickets  
**Deliverables:**
- `README.md`:
    - setup
    - faucet note
    - OBS steps
    - common errors (wrong domain name/version, decimals, ms timestamps)
- Optional: `apps/api/scripts/smoke.ts` to exercise endpoints.

**Acceptance criteria:**
- A new dev can go from empty folder to a working demo following the README.

---

## EPIC 6 — Support history + receipts (Viewer + Streamer)

### T6.1 — Viewer: “My Supports” auto-refresh + pagination
**Priority:** P0  
**Dependencies:** T4.3, existing `GET /api/channels/:slug/supports/me`  
**Deliverables:**
- After any successful settlement (effect / Q&A / donation / membership), refresh “My Supports” automatically.
- Add a “Load more” button using `nextCursor`.
- Optional: filter by kind (`effect|qa|donation|membership`).

**Acceptance criteria:**
- After a donation succeeds, the new support appears in “My Supports” without a manual refresh.
- “Load more” appends older items and stops when `nextCursor` is null.

---

### T6.2 — API: Payment receipt (detailed view)
**Priority:** P0  
**Dependencies:** T1.2, T2.4  
**Deliverables:**
- Add endpoints that return a single payment row with receipt-grade detail:
  - Public (viewer): `GET /api/channels/:slug/payments/:paymentId?address=0x...`
  - Dashboard (streamer): `GET /api/channels/:slug/payments/:paymentId` (dashboard auth)
- Response includes: `paymentId`, `status`, `kind`, `scheme`, `network`, `asset`, `fromAddress`, `toAddress`, `value`, `nonce`, `txHash`, `blockNumber`, `timestamp`, `actionKey`, `qaId`, `membershipPlanId`, `createdAt`.

**Acceptance criteria:**
- Viewer cannot fetch another wallet’s receipt (must match `fromAddress`).
- Streamer can fetch any payment for the channel when authenticated.

---

### T6.3 — Realtime: Supports update on dashboard via SSE
**Priority:** P0  
**Dependencies:** T1.4, T2.4  
**Deliverables:**
- When a support settles, emit a dashboard SSE event (new `support.created` or reuse `support.alert`) with `paymentId`, `kind`, `value`, `fromAddress`, `txHash`, `timestamp`.
- Dashboard listens and reflects it (toast + refresh stats/leaderboard, or a “Recent supports” list).

**Acceptance criteria:**
- With dashboard open, a new donation appears without reloading the page.

---

### T6.4 — Persist donation message / display name snapshot (optional)
**Priority:** P1  
**Dependencies:** T1.2, T6.2  
**Deliverables:**
- Store donation metadata (message, displayName snapshot) in DB (either new `donations` table keyed by `paymentId`, or additional columns).
- Receipt endpoint includes donation message when available.
- Viewer and dashboard show donation message in the receipt UI.

**Acceptance criteria:**
- Donation message persists across refresh and is visible in receipt detail.

---

## Definition of Done (MVP)
- Viewer can pay-trigger an effect and see it on overlay.
- Viewer can pay-submit a Q&A and streamer can show it on overlay.
- `/verify` and `/settle` are used correctly and txHash is shown.
- Idempotency prevents duplicates on retries.
  text
  코드 복사
