import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { strictSsl } from './ssl.js';

export * from './schema.js';
export { strictSsl } from './ssl.js';
// Re-exported so the app uses the same drizzle-orm instance as the schema.
export { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

export type Database = NodePgDatabase;

export function createDb(connectionString?: string): Database {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new pg.Pool({
    connectionString: strictSsl(url),
    max: 10,
    // Neon suspends idle compute; drop idle sockets before it does.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  // An idle client erroring (e.g. Neon scaling to zero) must not crash the process.
  pool.on('error', () => {});
  return drizzle(pool);
}

