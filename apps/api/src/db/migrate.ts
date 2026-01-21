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

  logger.info('Database migration complete');
}
