-- Stream402 Database Schema

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  displayName TEXT NOT NULL,
  payToAddress TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'cronos-testnet',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL REFERENCES channels(id),
  actionKey TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('sticker', 'sound', 'flash')),
  priceBaseUnits TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(channelId, actionKey)
);

CREATE TABLE IF NOT EXISTS qa_items (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL REFERENCES channels(id),
  paymentId TEXT UNIQUE NOT NULL,
  fromAddress TEXT NOT NULL,
  displayName TEXT,
  message TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('normal', 'priority')),
  priceBaseUnits TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'showing', 'answered', 'skipped', 'blocked')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  shownAt TEXT,
  closedAt TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL REFERENCES channels(id),
  paymentId TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('verified', 'settled', 'failed')),
  scheme TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  fromAddress TEXT NOT NULL,
  toAddress TEXT NOT NULL,
  value TEXT NOT NULL,
  nonce TEXT NOT NULL,
  txHash TEXT,
  blockNumber INTEGER,
  timestamp INTEGER,
  error TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL REFERENCES channels(id),
  fromAddress TEXT NOT NULL,
  reason TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channelId, fromAddress)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_qa_items_channel_status ON qa_items(channelId, status);
CREATE INDEX IF NOT EXISTS idx_payments_channel ON payments(channelId);
CREATE INDEX IF NOT EXISTS idx_blocks_channel_address ON blocks(channelId, fromAddress);
