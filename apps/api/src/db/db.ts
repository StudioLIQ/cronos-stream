import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { migrate } from './migrate.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

async function waitForDb(dbPool: Pool): Promise<void> {
  const maxAttempts = parseInt(process.env.DB_CONNECT_RETRIES || '15', 10);
  const delayMs = parseInt(process.env.DB_CONNECT_RETRY_DELAY_MS || '1000', 10);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await dbPool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err;
      }
      logger.warn('Waiting for MySQL to be ready...', { attempt, maxAttempts });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    logger.info(
      `Connecting to MySQL at ${config.db.host}:${config.db.port}/${config.db.database}...`
    );

    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      multipleStatements: true,
      dateStrings: true,
    });

    await waitForDb(pool);
    await migrate(pool);
  })();

  return initPromise;
}

export function getDb(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    initPromise = null;
  }
}

// Query helpers
type Queryable = Pool | PoolConnection;

async function getQueryable(conn?: Queryable): Promise<Queryable> {
  if (conn) return conn;
  await initDb();
  return getDb();
}

export async function queryOne<T>(
  sql: string,
  params: unknown[] = [],
  conn?: Queryable
): Promise<T | undefined> {
  const db = await getQueryable(conn);
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows[0] as unknown as T | undefined;
}

export async function queryAll<T>(
  sql: string,
  params: unknown[] = [],
  conn?: Queryable
): Promise<T[]> {
  const db = await getQueryable(conn);
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function execute(
  sql: string,
  params: unknown[] = [],
  conn?: Queryable
): Promise<ResultSetHeader> {
  const db = await getQueryable(conn);
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  await initDb();
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    connection.release();
  }
}
