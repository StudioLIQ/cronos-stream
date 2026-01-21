-- Stream402 Database Schema (MySQL 8+)

CREATE TABLE IF NOT EXISTS channels (
  id CHAR(36) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  displayName VARCHAR(255) NOT NULL,
  payToAddress VARCHAR(64) NOT NULL,
  network VARCHAR(64) NOT NULL DEFAULT 'cronos-testnet',
  streamEmbedUrl TEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_channels_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS actions (
  id CHAR(36) NOT NULL,
  channelId CHAR(36) NOT NULL,
  actionKey VARCHAR(191) NOT NULL,
  type ENUM('sticker', 'sound', 'flash') NOT NULL,
  priceBaseUnits VARCHAR(64) NOT NULL,
  payloadJson TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_actions_channel_actionKey (channelId, actionKey),
  CONSTRAINT fk_actions_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qa_items (
  id CHAR(36) NOT NULL,
  channelId CHAR(36) NOT NULL,
  paymentId VARCHAR(64) NOT NULL,
  fromAddress VARCHAR(64) NOT NULL,
  displayName VARCHAR(255) NULL,
  message TEXT NOT NULL,
  tier ENUM('normal', 'priority') NOT NULL,
  priceBaseUnits VARCHAR(64) NOT NULL,
  status ENUM('queued', 'showing', 'answered', 'skipped', 'blocked') NOT NULL DEFAULT 'queued',
  isMember TINYINT(1) NOT NULL DEFAULT 0,
  memberPlanId CHAR(36) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shownAt DATETIME NULL,
  closedAt DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_qa_items_paymentId (paymentId),
  KEY idx_qa_items_channel_status (channelId, status),
  CONSTRAINT fk_qa_items_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL,
  channelId CHAR(36) NOT NULL,
  paymentId VARCHAR(64) NOT NULL,
  status ENUM('verified', 'settled', 'failed') NOT NULL DEFAULT 'verified',
  scheme VARCHAR(32) NOT NULL,
  network VARCHAR(64) NOT NULL,
  asset VARCHAR(64) NOT NULL,
  fromAddress VARCHAR(64) NOT NULL,
  toAddress VARCHAR(64) NOT NULL,
  value VARCHAR(64) NOT NULL,
  nonce VARCHAR(128) NOT NULL,
  txHash VARCHAR(128) NULL,
  blockNumber BIGINT NULL,
  timestamp BIGINT NULL,
  error TEXT NULL,
  kind ENUM('effect', 'qa', 'donation', 'membership') NULL,
  actionKey VARCHAR(191) NULL,
  qaId CHAR(36) NULL,
  membershipPlanId CHAR(36) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payments_paymentId (paymentId),
  KEY idx_payments_channel (channelId),
  KEY idx_payments_channel_from_timestamp (channelId, fromAddress, timestamp),
  KEY idx_payments_from_timestamp (fromAddress, timestamp),
  CONSTRAINT fk_payments_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blocks (
  id CHAR(36) NOT NULL,
  channelId CHAR(36) NOT NULL,
  fromAddress VARCHAR(64) NOT NULL,
  reason TEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_blocks_channel_fromAddress (channelId, fromAddress),
  CONSTRAINT fk_blocks_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS membership_plans (
  id CHAR(36) NOT NULL,
  channelId CHAR(36) NOT NULL,
  name VARCHAR(191) NOT NULL,
  priceBaseUnits VARCHAR(64) NOT NULL,
  durationDays INT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_membership_plans_channel (channelId),
  CONSTRAINT fk_membership_plans_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS memberships (
  id CHAR(36) NOT NULL,
  channelId CHAR(36) NOT NULL,
  fromAddress VARCHAR(64) NOT NULL,
  planId CHAR(36) NOT NULL,
  expiresAt DATETIME NOT NULL,
  lastPaymentId VARCHAR(64) NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_memberships_channel_address (channelId, fromAddress),
  KEY idx_memberships_channel_expires (channelId, expiresAt),
  CONSTRAINT fk_memberships_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_memberships_plan FOREIGN KEY (planId) REFERENCES membership_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wallet profile tables for wallet-signed nicknames

CREATE TABLE IF NOT EXISTS wallet_profiles (
  address VARCHAR(64) NOT NULL,
  displayName VARCHAR(191) NOT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_wallet_profiles (
  channelId CHAR(36) NOT NULL,
  address VARCHAR(64) NOT NULL,
  displayNameOverride VARCHAR(191) NOT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (channelId, address),
  CONSTRAINT fk_channel_wallet_profiles_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_profile_nonces (
  address VARCHAR(64) NOT NULL,
  nonce VARCHAR(64) NOT NULL,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (address, nonce),
  KEY idx_wallet_profile_nonces_address_expires (address, expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_profile_nonces (
  channelId CHAR(36) NOT NULL,
  address VARCHAR(64) NOT NULL,
  nonce VARCHAR(64) NOT NULL,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channelId, address, nonce),
  KEY idx_channel_profile_nonces_channel_address_expires (channelId, address, expiresAt),
  CONSTRAINT fk_channel_profile_nonces_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
