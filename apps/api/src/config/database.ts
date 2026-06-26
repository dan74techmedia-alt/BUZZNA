import { Kysely, PostgresDialect, sql, Transaction } from 'kysely';
import { Pool } from 'pg';
import { DatabaseSchema } from '../db/schema';
import { env } from './env';

// Initialize PostgreSQL connection pool for Neon DB
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: true,
});

export const db = new Kysely<DatabaseSchema>({
  dialect: new PostgresDialect({
    pool,
  }),
});

/**
 * Executes a database query within a strict Row-Level Security (RLS) transaction block.
 * Every single database operation MUST wrap the tenant_id to prevent data leakage.
 */
export async function withTenant<T>(
  tenantId: string,
  callback: (trx: Transaction<DatabaseSchema>) => Promise<T>
): Promise<T> {
  return await db.transaction().execute(async (trx) => {
    // Inject the tenant ID into the local Postgres context for this transaction
    await sql`SET LOCAL app.current_tenant_id = ${tenantId}`.execute(trx);
    
    // Execute the requested business logic
    return await callback(trx);
  });
}