import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import type { Pool, RowDataPacket } from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureColumnExists(
  db: Pool,
  opts: { table: string; column: string; ddl: string }
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [opts.table, opts.column]
  );

  const count = Number((rows?.[0] as { count?: unknown } | undefined)?.count ?? 0);
  if (count > 0) return;

  logger.info(`Adding missing column ${opts.table}.${opts.column}...`);
  await db.query(opts.ddl);
}

async function ensureIndexExists(
  db: Pool,
  opts: { table: string; index: string; ddl: string }
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [opts.table, opts.index]
  );

  const count = Number((rows?.[0] as { count?: unknown } | undefined)?.count ?? 0);
  if (count > 0) return;

  logger.info(`Adding missing index ${opts.table}.${opts.index}...`);
  await db.query(opts.ddl);
}

async function ensureTableExists(
  db: Pool,
  opts: { table: string; ddl: string }
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [opts.table]
  );

  const count = Number((rows?.[0] as { count?: unknown } | undefined)?.count ?? 0);
  if (count > 0) return;

  logger.info(`Creating missing table ${opts.table}...`);
  await db.query(opts.ddl);
}

export async function migrate(db: Pool): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  logger.info('Running database migration...');

  await db.query(schema);

  await ensureColumnExists(db, {
    table: 'channels',
    column: 'streamEmbedUrl',
    ddl: `ALTER TABLE channels ADD COLUMN streamEmbedUrl TEXT NULL AFTER network`,
  });

  // T6.1: Support ledger - enrich payments with context
  await ensureColumnExists(db, {
    table: 'payments',
    column: 'kind',
    ddl: `ALTER TABLE payments ADD COLUMN kind ENUM('effect', 'qa', 'donation', 'membership') NULL AFTER error`,
  });

  await ensureColumnExists(db, {
    table: 'payments',
    column: 'actionKey',
    ddl: `ALTER TABLE payments ADD COLUMN actionKey VARCHAR(191) NULL AFTER kind`,
  });

  await ensureColumnExists(db, {
    table: 'payments',
    column: 'qaId',
    ddl: `ALTER TABLE payments ADD COLUMN qaId CHAR(36) NULL AFTER actionKey`,
  });

  await ensureColumnExists(db, {
    table: 'payments',
    column: 'membershipPlanId',
    ddl: `ALTER TABLE payments ADD COLUMN membershipPlanId CHAR(36) NULL AFTER qaId`,
  });

  // T11: Membership NFTs - store mint tx hash/errors for membership receipts
  await ensureColumnExists(db, {
    table: 'payments',
    column: 'nftTxHash',
    ddl: `ALTER TABLE payments ADD COLUMN nftTxHash VARCHAR(128) NULL AFTER txHash`,
  });

  await ensureColumnExists(db, {
    table: 'payments',
    column: 'nftError',
    ddl: `ALTER TABLE payments ADD COLUMN nftError TEXT NULL AFTER nftTxHash`,
  });

  // Add indexes for support history queries
  await ensureIndexExists(db, {
    table: 'payments',
    index: 'idx_payments_channel_from_timestamp',
    ddl: `CREATE INDEX idx_payments_channel_from_timestamp ON payments (channelId, fromAddress, timestamp)`,
  });

  await ensureIndexExists(db, {
    table: 'payments',
    index: 'idx_payments_from_timestamp',
    ddl: `CREATE INDEX idx_payments_from_timestamp ON payments (fromAddress, timestamp)`,
  });

  // T7.5: Membership perks - add isMember and memberPlanId to qa_items
  await ensureColumnExists(db, {
    table: 'qa_items',
    column: 'isMember',
    ddl: `ALTER TABLE qa_items ADD COLUMN isMember TINYINT(1) NOT NULL DEFAULT 0 AFTER status`,
  });

  await ensureColumnExists(db, {
    table: 'qa_items',
    column: 'memberPlanId',
    ddl: `ALTER TABLE qa_items ADD COLUMN memberPlanId CHAR(36) NULL AFTER isMember`,
  });

  // T9.3: Goals table
  await ensureTableExists(db, {
    table: 'goals',
    ddl: `CREATE TABLE IF NOT EXISTS goals (
      id CHAR(36) NOT NULL,
      channelId CHAR(36) NOT NULL,
      type ENUM('donation', 'membership') NOT NULL,
      name VARCHAR(191) NOT NULL,
      targetValue VARCHAR(64) NOT NULL,
      currentValue VARCHAR(64) NOT NULL DEFAULT '0',
      startsAt DATETIME NULL,
      endsAt DATETIME NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_goals_channel (channelId),
      KEY idx_goals_channel_type_enabled (channelId, type, enabled),
      CONSTRAINT fk_goals_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  });

  logger.info('Database migration complete');
}
