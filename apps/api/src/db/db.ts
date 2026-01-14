import Database from 'better-sqlite3';
import path from 'path';
import { migrate } from './migrate.js';
import { logger } from '../logger.js';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'stream402.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    logger.info(`Opening database at ${DB_PATH}`);
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Query helpers
export function queryOne<T>(sql: string, params?: unknown[]): T | undefined {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
}

export function queryAll<T>(sql: string, params?: unknown[]): T[] {
  const stmt = getDb().prepare(sql);
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

export function execute(sql: string, params?: unknown[]): Database.RunResult {
  const stmt = getDb().prepare(sql);
  return params ? stmt.run(...params) : stmt.run();
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
