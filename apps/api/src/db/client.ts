// apps/api/src/db/client.ts

import { pool } from '../config/database'; 
import { AppError } from '../common/errors/AppError';
import { logger } from '../common/logging/logger';
import { PoolClient } from 'pg';

/**
 * Executes a set of database operations within an isolated transaction block that strictly
 * configures the PostgreSQL Row-Level Security (RLS) context variable.
 * This guarantees protection against connection pooling context leaks when using PgBouncer.
 */
export async function executeIsolatedTenantTransaction<T>(
  tenantId: string,
  transactionCallback: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!tenantId || tenantId.trim() === '') {
    throw new AppError('Tenant isolation bypass attempt detected. Operation aborted.', 401);
  }

  const client = await pool.connect();

  try {
    // Begin strict transactional encapsulation block
    await client.query('BEGIN;');

    // Inject the authenticated tenant context directly into the current database socket runtime settings
    // This setting applies only to the current transaction block and is cleared upon COMMIT or ROLLBACK.
    await client.query({
      text: 'SELECT set_config(\'app.current_tenant_id\', $1, true);',
      values: [tenantId]
    });

    // Execute the caller's specific domain logic queries using the contextually locked socket
    const operationResult = await transactionCallback(client);

    // Commit changes safely if all nested logic passes parameters successfully
    await client.query('COMMIT;');
    return operationResult;

  } catch (error) {
    // Ensure all state changes are safely dropped if any specific statement fails
    await client.query('ROLLBACK;');
    logger.error(`Transaction execution aborted and rolled back for Tenant Context ID: ${tenantId}. Error:`, error);
    throw error;
  } finally {
    // Release client socket back into the PgBouncer / Neon connection pool safely
    client.release();
  }
}

/**
 * Read-Only transaction context executor utility. Enforces RLS context validation rules
 * while optimizing database execution path patterns for query operations.
 */
export async function executeIsolatedTenantQuery<T>(
  tenantId: string,
  queryCallback: (client: PoolClient) => Promise<T>
): Promise<T> {
  return executeIsolatedTenantTransaction(tenantId, async (client) => {
    await client.query('SET TRANSACTION READ ONLY;');
    return queryCallback(client);
  });
}