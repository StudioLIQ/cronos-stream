# PROJECT.md — Stream402 (Cronos x402 + OBS Overlay)

## 1) What we are building

Stream402 is a platform-agnostic “paid interaction” layer for livestreamers.

Viewers can:
- Pay a small amount of USDC.e per action (sticker/flash/sound).
- Pay to submit a question into a prioritized Q&A queue.

Streamers can:
- Run an OBS browser-source overlay that renders paid effects and highlighted questions in real time.
- Operate a Q&A queue from a dashboard (show / answered / skipped / blocked).

Payments use the x402 flow:
- Client requests a paid endpoint.
- Server replies `402 Payment Required` with `paymentRequirements`.
- Client signs an EIP-712 payload for EIP-3009 `transferWithAuthorization`, Base64-encodes it into `X-PAYMENT`, retries the request.
- Server calls Cronos x402 Facilitator `/verify` then `/settle`, then delivers the resource and emits realtime events.

## 2) Primary user stories (MVP)

### Viewer
1. As a viewer, I click “Sticker” and the overlay shows it within ~2 seconds.
2. As a viewer, I submit a paid question; it appears in the streamer’s queue immediately.
3. As a viewer, my wallet signs once per paid action; no separate checkout UI.

### Streamer
1. As a streamer, I open `/o/:channel` in OBS and see paid effects and highlighted questions.
2. As a streamer, I open `/d/:channel`, see the queue, and can “Show” a question on overlay, then mark it done.
3. As a streamer, I can block abusive wallets so they cannot submit further questions.

### System / correctness
1. Duplicate retries with the same `X-PAYMENT` must not create duplicate effects or duplicate Q&A items (idempotent).
2. Server performs `/verify` and only `/settle` if business rules pass (e.g., message policy).
3. All amounts are 6-decimal base units as strings (no decimals, no JS numbers).

## 3) Out of scope (explicit non-goals)
- Twitch/YouTube/CHZZK/Afreeca platform APIs (chat, subs, bits).
- Refunds/chargebacks.
- Multi-admin roles and moderation teams.
- Full AI automation (clip factory, etc.). Optional: simple summary panel later.

## 4) Tech stack (recommended)
- Monorepo with pnpm workspaces:
    - `apps/api`: Node.js + TypeScript + Express + Axios + MySQL
    - `apps/web`: Vite + React + TypeScript + ethers (for signTypedData)
- Realtime: Server-Sent Events (SSE) from `apps/api` to overlay and dashboard.
- DB: MySQL (e.g., local via docker-compose, prod via managed MySQL).

Reasoning: fastest path from empty folder to a working demo; SSE is enough; Vite is simpler than Next for OBS overlay.

## 5) Repo layout (target)
.
├─ apps/
│ ├─ api/
│ │ ├─ src/
│ │ │ ├─ index.ts
│ │ │ ├─ config.ts
│ │ │ ├─ db/
│ │ │ │ ├─ schema.sql
│ │ │ │ ├─ migrate.ts
│ │ │ │ └─ db.ts
│ │ │ ├─ sse/
│ │ │ │ └─ broker.ts
│ │ │ ├─ x402/
│ │ │ │ ├─ constants.ts
│ │ │ │ ├─ types.ts
│ │ │ │ └─ facilitator.ts
│ │ │ └─ routes/
│ │ │ ├─ public.ts
│ │ │ ├─ paywalled.ts
│ │ │ └─ dashboard.ts
│ │ └─ package.json
│ └─ web/
│ ├─ src/
│ │ ├─ main.tsx
│ │ ├─ routes/
│ │ │ ├─ Viewer.tsx
│ │ │ ├─ Overlay.tsx
│ │ │ └─ Dashboard.tsx
│ │ ├─ lib/
│ │ │ ├─ api.ts
│ │ │ ├─ x402.ts
│ │ │ ├─ sse.ts
│ │ │ └─ format.ts
│ │ └─ ui/
│ └─ package.json
├─ pnpm-workspace.yaml
├─ package.json
├─ PROJECT.md
└─ TICKET.md
markdown
코드 복사

## 6) Cronos x402 constants and protocol requirements

### 6.1 Network constants
Use these values for the `asset` field and typed-data domain.

**Testnet**
- network string: `cronos-testnet`
- chainId: `338`
- RPC: `https://evm-t3.cronos.org`
- USDC.e contract: `0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0`

**Mainnet (optional)**
- network string: `cronos-mainnet`
- chainId: `25`
- RPC: `https://evm.cronos.org`
- USDC.e contract: `0xf951eC28187D9E5Ca673Da8FE6757E6f0Be5F77C`

**Facilitator base URL**
- `https://facilitator.cronoslabs.org/v2/x402`

### 6.2 Token metadata (must match exactly)
For EIP-712 domain:
- `name`: `Bridged USDC (Stargate)`
- `version`: `1`
- `verifyingContract`: the USDC.e contract address for the selected network
- `chainId`: 338 (testnet) or 25 (mainnet)

Decimals:
- USDC.e is 6 decimals. 1 USDC.e = `"1000000"` in base units.

### 6.3 x402 payment header (client side)
The client generates:
- `nonce`: 32 random bytes, hex string (`0x` + 64 hex chars)
- `validAfter`: `0`
- `validBefore`: current time (seconds) + `maxTimeoutSeconds`
- `value`: string base units (no decimals)

Typed data:
- primary type: `TransferWithAuthorization`
- fields: `from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`

Client creates the JSON:
```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "cronos-testnet",
  "payload": {
    "from": "0x...",
    "to": "0x...",
    "value": "50000",
    "validAfter": 0,
    "validBefore": 1735689551,
    "nonce": "0x...",
    "signature": "0x...",
    "asset": "0x..."
  }
}
Then Base64-encodes the JSON string and sends it as the HTTP header:
X-PAYMENT: <base64>
6.4 402 response (server side)
If no valid payment header is present:
Respond with HTTP 402 and JSON body:
json
코드 복사
{
  "error": "Payment Required",
  "x402Version": 1,
  "paymentRequirements": {
    "scheme": "exact",
    "network": "cronos-testnet",
    "payTo": "0xSTREAMER_WALLET",
    "asset": "0xc01e....",
    "description": "Paid Q&A: normal",
    "mimeType": "application/json",
    "maxAmountRequired": "250000",
    "maxTimeoutSeconds": 300
  }
}
6.5 Facilitator verify/settle (server side)
Server calls Facilitator with header:
Content-Type: application/json
X402-Version: 1
Request body (same for verify and settle):
json
코드 복사
{
  "x402Version": 1,
  "paymentHeader": "<base64 header value>",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "cronos-testnet",
    "payTo": "0xSTREAMER_WALLET",
    "asset": "0xc01e....",
    "maxAmountRequired": "250000",
    "maxTimeoutSeconds": 300
  }
}
Verify response:
{ "isValid": true, "invalidReason": null }
Settle success response:
event: "payment.settled" and includes txHash, from, to, value, blockNumber, timestamp.
Settle failure response:
event: "payment.failed" and includes error (examples: Authorization already used, Authorization expired).
Rate limits (important for demo stability):
verify: 10 req/min/IP
settle: 5 req/min/IP
7) Product pricing (MVP fixed)
effects (sticker/flash/sound): 0.05 USDC.e → "50000"
Q&A normal: 0.25 USDC.e → "250000"
Q&A priority: 0.50 USDC.e → "500000"
No dynamic pricing in MVP.
8) Backend API specification
Base path: /api/channels/:slug
Public
GET /api/channels/:slug
returns channel config (network, payTo, enabled actions)
GET /api/channels/:slug/actions
returns enabled actions list
Paywalled
POST /api/channels/:slug/trigger
body: { "actionKey": "sticker_01" }
if no payment: 402 with requirements for that action
if paid: settles, emits effect.triggered, returns { ok:true, payment:{...} }
POST /api/channels/:slug/qa
body: { "message": "...", "displayName": "...", "tier": "normal" | "priority" }
if no payment: 402 with tier pricing
if paid: settles, inserts qa item, emits qa.created, returns { ok:true, qaId, payment }
Dashboard (bearer token)
GET /api/channels/:slug/qa?status=queued|showing|...
POST /api/channels/:slug/qa/:id/state
body: { "state": "show" | "answered" | "skipped" | "blocked" }
Realtime (SSE)
GET /api/channels/:slug/stream/overlay
GET /api/channels/:slug/stream/dashboard
Event types:
effect.triggered → { eventId, actionKey, payload, amount, from, txHash, timestamp }
qa.created → { qaId, tier, message, displayName, amount, from, txHash, createdAt }
qa.show → { qaId, message, tier, displayName }
qa.updated → { qaId, status }
9) Data model (MySQL)
channels
id (uuid)
slug (unique)
displayName
payToAddress
network (cronos-testnet | cronos-mainnet)
createdAt, updatedAt
actions
id (uuid)
channelId
actionKey (unique per channel)
type (sticker | sound | flash)
priceBaseUnits (string)
payloadJson (text/json)
enabled (0/1)
qa_items
id (uuid)
channelId
paymentId (unique)
fromAddress
displayName (nullable)
message
tier (normal | priority)
priceBaseUnits
status (queued | showing | answered | skipped | blocked)
createdAt, shownAt, closedAt
payments (idempotency + auditing)
id (uuid)
channelId
paymentId (unique) = sha256(paymentHeaderBase64)
status (verified | settled | failed)
scheme, network, asset
fromAddress, toAddress
value, nonce
txHash, blockNumber, timestamp
error (nullable)
createdAt
blocks
channelId
fromAddress (unique per channel)
reason
createdAt
10) Idempotency rules (must-have)
Compute paymentId = sha256(paymentHeaderBase64) and store in payments.
If the same paymentId is seen again:
do NOT settle again
do NOT emit events again
return the same success payload if already settled
This prevents:
double effects
duplicate Q&A inserts
11) Content policy (MVP)
Before /settle, apply a lightweight message filter for Q&A:
Reject if:
Contains obvious PII patterns (phone/email) OR banned words list.
Return HTTP 400 and do not call settle.
12) Running locally (target DX)
Requirements
Node.js 20+
pnpm
Browser wallet (MetaMask)
devUSDC.e on Cronos testnet for viewer wallet
Scripts
Root:
pnpm i
pnpm dev (starts API + Web)
pnpm build
pnpm start (production mode; API serves web dist)
Environment:
apps/api/.env (local, gitignored) or apps/api/.env.railway (demo deploy, committable)
apps/web/.env (optional; proxy-based local dev can use relative paths)
13) OBS usage
Add a Browser source
URL: http://localhost:<webPort>/o/<channelSlug>
Size: 1920x1080
Enable audio through OBS if using sound actions
14) Acceptance tests (manual)
Viewer triggers an effect → overlay shows it and backend returns payment.settled.
Viewer submits Q&A → dashboard shows queued item; streamer clicks “Show” → overlay highlights question.
Re-send same request with same X-PAYMENT → no duplicate overlay and no duplicate DB rows.
