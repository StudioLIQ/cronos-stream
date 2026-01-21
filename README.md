# Stream402

Stream402 is a platform-agnostic "paid interaction" layer for livestreamers using the x402 payment protocol on Cronos.

## Features

- **Donations**: Viewers can donate a custom amount (USDC.e) while watching the stream
- **Paid Effects**: Sticker, flash, and sound effects triggered by viewers
- **Paid Q&A**: Prioritized question queue with tier-based pricing
- **OBS Overlay**: Browser source that displays effects, donation alerts, and highlighted questions
- **Dashboard**: Queue management for streamers

## Prerequisites

- Node.js 20+
- pnpm
- Docker (for local MySQL)
- MetaMask or compatible wallet with Cronos testnet USDC.e

## Getting Started

### Installation

```bash
pnpm install
```

### Environment Variables

Create `apps/api/.env`:

```env
# Required: Your wallet address to receive payments
SELLER_WALLET=0xYourWalletAddress

# Optional: Dashboard authentication token (default: demo-token)
DASHBOARD_TOKEN=your-secret-token

# Optional: Network (default: cronos-testnet)
DEFAULT_NETWORK=cronos-testnet

# Optional: API port (default: 3402)
API_PORT=3402

# Database (MySQL)
# - Recommended: use docker-compose.yml at repo root
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=stream402
DB_PASSWORD=stream402
DB_NAME=stream402

# (Optional) Demo viewer livestream embed (YouTube)
# - Preferred: set a YouTube Channel ID (starts with UC...) to always show the current live
# - Alternative: set a specific YouTube video ID or a full embed URL
# DEMO_YOUTUBE_CHANNEL_ID=UCxxxxxxxxxxxxxxxxxxxxxx
# DEMO_YOUTUBE_VIDEO_ID=xxxxxxxxxxx
# DEMO_STREAM_EMBED_URL=https://www.youtube.com/embed/live_stream?channel=UC...
```

### Development Mode

Start MySQL:

```bash
docker compose up -d mysql
```

Start both API and Web in development:

```bash
pnpm dev
```

- API: http://localhost:3402
- Web: http://localhost:5173

### Production Mode

Build and start:

```bash
pnpm build
pnpm start
```

Access at http://localhost:3402

## Usage

### Pages

- `/v/:slug` - Viewer page (trigger effects, submit questions)
- `/o/:slug` - Overlay page (OBS browser source)
- `/d/:slug` - Dashboard page (queue management)

The viewer page includes an embedded YouTube stream by default (demo), and you can override it per-browser by pasting a YouTube link in the Live section.

### Demo Channel

The app seeds a `demo` channel on first start. Access it at:

- Viewer: http://localhost:5173/v/demo (dev) or http://localhost:3402/v/demo (prod)
- Overlay: http://localhost:5173/o/demo
- Dashboard: http://localhost:5173/d/demo (token: demo-token)

The demo viewer defaults to `https://www.youtube.com/watch?v=Ap-UM1O9RBU`.
- Override in `/v/demo` → Live section (saved to your browser only).
- Or set `DEMO_YOUTUBE_CHANNEL_ID` and reset the DB volume so seed runs again.

### OBS Setup

1. Add a Browser source in OBS
2. URL: `http://localhost:3402/o/demo`
3. Size: 1920x1080
4. Check "Enable audio through OBS" for sound effects

## Cronos Testnet Setup

### Get Test CRO

1. Visit the [Cronos Testnet Faucet](https://cronos.org/faucet)
2. Enter your wallet address
3. Receive test CRO for gas fees

### Get Test USDC.e

The USDC.e contract on testnet is `0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0`

You'll need devUSDC.e in your wallet to trigger paid actions.

### Add Cronos Testnet to MetaMask

The app automatically prompts to add/switch to Cronos testnet when connecting.

Network details:
- Network Name: Cronos Testnet
- RPC URL: https://evm-t3.cronos.org
- Chain ID: 338
- Currency: TCRO
- Explorer: https://explorer.cronos.org/testnet

## Pricing

| Action | Price (USDC.e) |
|--------|---------------|
| Donation | Custom |
| Effect (sticker/flash/sound) | $0.05 |
| Q&A Normal | $0.25 |
| Q&A Priority | $0.50 |

## API Endpoints

### Public
- `GET /api/channels/:slug` - Channel info
- `GET /api/channels/:slug/actions` - Available actions

### Paywalled (returns 402 without X-PAYMENT header)
- `POST /api/channels/:slug/trigger` - Trigger effect
- `POST /api/channels/:slug/donate` - Send donation (custom amount)
- `POST /api/channels/:slug/qa` - Submit question

### Dashboard (requires Bearer token)
- `GET /api/channels/:slug/qa?status=queued` - Get Q&A queue
- `POST /api/channels/:slug/qa/:id/state` - Update Q&A state

### SSE Streams
- `GET /api/channels/:slug/stream/overlay` - Overlay events
- `GET /api/channels/:slug/stream/dashboard` - Dashboard events

## Troubleshooting

### "Wrong domain name/version" error

The EIP-712 domain must match exactly:
- name: "Bridged USDC (Stargate)"
- version: "1"

### Signature rejected

Make sure:
- You're on Cronos testnet (chain ID 338)
- Your wallet has USDC.e balance
- The token contract address is correct

### Effects not showing on overlay

Check:
- Overlay is connected to the SSE stream (check DevTools Network tab)
- API is running and accessible
- No CORS errors in console

### Q&A not appearing in dashboard

Verify:
- Dashboard token is correct
- SSE connection is established
- Filter is set to "queued"

## Tech Stack

- **API**: Express + TypeScript + MySQL + mysql2
- **Web**: Vite + React + TypeScript + ethers.js
- **Payment**: Cronos x402 Protocol

## License

MIT
