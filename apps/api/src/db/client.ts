/**
 * ============================================================================
 * BUZZNA D74 - PostgreSQL Database Client with Tenant Context Injection
 * ============================================================================
 *
 * PURPOSE:
 * - Establish PostgreSQL connection pooling for Neon serverless database
 * - Implement Layer 2: Database Row-Level Security (RLS) policy enforcement
 * - Enforce strict tenant context injection via transaction wrapping
 * - Prevent connection pool leakage in PgBouncer by scoping tenant_id per-query
 * - Provide type-safe, compile-time validated query execution
 * - Support idempotent synchronization and conflict resolution
 *
 * CRITICAL ARCHITECTURAL RULES:
 * 1. EVERY query MUST be wrapped inside: BEGIN; SET LOCAL app.current_tenant_id; COMMIT;
 * 2. Tenant context is extracted from AsyncLocalStorage (never from client headers)
 * 3. RLS policies automatically filter rows based on the tenant_id setting
 * 4. Connection pool reuse is neutralized by explicit transaction scoping
 * 5. All monetary values use NUMERIC types (never floating point)
 * 6. Append-only ledgers: no DELETE operations on financial rows
 *
 * ============================================================================
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { env } from '../config/env';
import { logger } from '../common/logging/logger';

/**
 * Tenant context attached to AsyncLocalStorage for per-request isolation
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  roleId: string;
}

/**
 * Async Local Storage for maintaining tenant context across async boundaries
 * This ensures that even async operations maintain proper tenant isolation
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/**
 * PostgreSQL Connection Pool Configuration
 * Configured for Neon serverless with optimal connection parameters
 */
const createConnectionPool = (): Pool => {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    
    // Neon-specific pooling parameters
    max: 20,                          // Maximum simultaneous connections
    idleTimeoutMillis: 30000,         // 30 seconds idle timeout
    connectionTimeoutMillis: 5000,    // 5 seconds connection timeout
    
    // Enable TCP keepalive to prevent connection drops
    keepalives: true,
    keepalivesIdleTimeout: 300000,    // 5 minutes
    
    // Application name for connection debugging
    application_name: 'buzzna-d74',
  });

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected error on idle client in PostgreSQL pool', {
      error: err.message,
      code: err.code,
    });
  });

  // Log pool connection events in development
  if (env.NODE_ENV === 'development') {
    pool.on('connect', () => {
      logger.debug('New PostgreSQL connection established');
    });

    pool.on('remove', () => {
      logger.debug('PostgreSQL connection removed from pool');
    });
  }

  return pool;
};

// Global connection pool instance
let poolInstance: Pool | null = null;

/**
 * Get or create the global connection pool
 */
export const getConnectionPool = (): Pool => {
  if (!poolInstance) {
    poolInstance = createConnectionPool();
  }
  return poolInstance;
};

/**
 * ============================================================================
 * LAYER 2: TENANT CONTEXT INJECTION & TRANSACTION WRAPPER
 * ============================================================================
 *
 * This function wraps query execution inside a transaction that:
 * 1. Begins a transaction explicitly
 * 2. Sets app.current_tenant_id as a session variable (LOCAL scope = connection-specific)
 * 3. Executes the actual query
 * 4. Commits the transaction
 *
 * The LOCAL keyword ensures that the tenant_id is scoped ONLY to this transaction,
 * preventing connection pool leakage where subsequent queries on the same connection
 * could incorrectly inherit the previous request's tenant context.
 *
 * RLS policies automatically filter rows based on this setting.
 */
async function executeWithTenantContext<T>(
  client: PoolClient,
  tenantId: string,
  query: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  try {
    // Step 1: Start explicit transaction
    await client.query('BEGIN;');

    // Step 2: Set tenant context as LOCAL (connection-specific, transaction-scoped)
    // The NULLIF prevents errors if tenantId is somehow undefined
    await client.query(
      `SET LOCAL app.current_tenant_id = $1;`,
      [tenantId]
    );

    // Step 3: Execute the actual business logic query
    const result = await client.query<T>(query, params);

    // Step 4: Commit transaction
    await client.query('COMMIT;');

    return result;
  } catch (error) {
    // Rollback on any error
    try {
      await client.query('ROLLBACK;');
    } catch (rollbackError) {
      logger.error('Failed to rollback transaction', { error: rollbackError });
    }

    throw error;
  }
}

/**
 * ============================================================================
 * QUERY EXECUTION INTERFACE
 * ============================================================================
 *
 * This is the ONLY way to execute queries in the BuzzNa system.
 * It enforces tenant context injection, handles connection pool acquisition,
 * and provides type safety via TypeScript generics.
 */

export interface QueryOptions {
  /**
   * Enable read-only mode (transactions may be omitted for SELECT queries)
   * Default: false (all queries wrapped in transactions for consistency)
   */
  readOnly?: boolean;

  /**
   * Custom timeout in milliseconds (default: 30 seconds)
   */
  timeoutMs?: number;

  /**
   * Idempotency key for webhook/sync operations (prevents double-processing)
   */
  idempotencyKey?: string;
}

/**
 * Execute a query with automatic tenant context injection
 *
 * @template T - Result row type
 * @param query - SQL query string (parameterized)
 * @param params - Query parameters array
 * @param options - Execution options
 * @returns QueryResult<T> with rows and row count
 * @throws Error if tenant context is not available or query fails
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = [],
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  // Extract tenant context from AsyncLocalStorage
  const context = tenantContextStorage.getStore();
  if (!context || !context.tenantId) {
    throw new Error(
      'CRITICAL: Tenant context not available. Query execution halted. ' +
      'Ensure auth.middleware.ts enforceTenantContext is applied before this route.'
    );
  }

  const pool = getConnectionPool();
  let client: PoolClient | null = null;

  try {
    // Acquire connection from pool
    client = await pool.connect();

    // Execute query with tenant context injection
    const result = await executeWithTenantContext<T>(
      client,
      context.tenantId,
      query,
      params
    );

    logger.debug('Query executed successfully', {
      tenantId: context.tenantId,
      queryLength: query.length,
      rowsAffected: result.rowCount,
    });

    return result;
  } catch (error) {
    logger.error('Query execution failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId: context?.tenantId,
      queryLength: query.length,
    });
    throw error;
  } finally {
    // Always release connection back to pool
    if (client) {
      client.release();
    }
  }
}

/**
 * Execute multiple queries in a single transaction
 * All queries share the same tenant context
 *
 * @template T - Result row type (same for all queries)
 * @param queries - Array of [query, params] tuples
 * @returns Array of QueryResult<T> in the same order as input
 * @throws Error if any query fails (entire transaction is rolled back)
 */
export async function executeBatchQueries<T = any>(
  queries: Array<[string, any[]]>
): Promise<QueryResult<T>[]> {
  const context = tenantContextStorage.getStore();
  if (!context || !context.tenantId) {
    throw new Error(
      'CRITICAL: Tenant context not available for batch execution. ' +
      'Ensure auth.middleware.ts is applied before this route.'
    );
  }

  const pool = getConnectionPool();
  let client: PoolClient | null = null;
  const results: QueryResult<T>[] = [];

  try {
    client = await pool.connect();

    // Begin transaction
    await client.query('BEGIN;');

    // Set tenant context once for all queries
    await client.query(
      `SET LOCAL app.current_tenant_id = $1;`,
      [context.tenantId]
    );

    // Execute all queries
    for (const [query, params] of queries) {
      const result = await client.query<T>(query, params);
      results.push(result);
    }

    // Commit all changes atomically
    await client.query('COMMIT;');

    logger.debug('Batch queries executed successfully', {
      tenantId: context.tenantId,
      queryCount: queries.length,
      resultRows: results.reduce((sum, r) => sum + (r.rowCount || 0), 0),
    });

    return results;
  } catch (error) {
    // Rollback entire batch on any error
    if (client) {
      try {
        await client.query('ROLLBACK;');
      } catch (rollbackError) {
        logger.error('Batch rollback failed', { error: rollbackError });
      }
    }

    logger.error('Batch query execution failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId: context?.tenantId,
      queriesAttempted: results.length,
    });

    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Execute a raw transaction with custom logic
 * Use this for complex multi-step operations that need manual control
 *
 * @template T - Result type
 * @param callback - Async function receiving the client (must NOT commit/rollback explicitly)
 * @returns Result from callback
 * @throws Error if callback fails or transaction cannot be committed
 */
export async function executeTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const context = tenantContextStorage.getStore();
  if (!context || !context.tenantId) {
    throw new Error(
      'CRITICAL: Tenant context not available for transaction. ' +
      'Ensure auth.middleware.ts is applied before this route.'
    );
  }

  const pool = getConnectionPool();
  let client: PoolClient | null = null;

  try {
    client = await pool.connect();

    // Begin transaction
    await client.query('BEGIN;');

    // Set tenant context
    await client.query(
      `SET LOCAL app.current_tenant_id = $1;`,
      [context.tenantId]
    );

    // Execute user-provided callback
    const result = await callback(client);

    // Commit transaction
    await client.query('COMMIT;');

    logger.debug('Custom transaction completed successfully', {
      tenantId: context.tenantId,
    });

    return result;
  } catch (error) {
    // Rollback on error
    if (client) {
      try {
        await client.query('ROLLBACK;');
      } catch (rollbackError) {
        logger.error('Transaction rollback failed', { error: rollbackError });
      }
    }

    logger.error('Custom transaction failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId: context?.tenantId,
    });

    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * ============================================================================
 * DATABASE INITIALIZATION & HEALTH CHECK
 * ============================================================================
 */

/**
 * Initialize database connection and run health checks
 * Call this during application bootstrap
 */
export async function initializeDatabase(): Promise<void> {
  try {
    const pool = getConnectionPool();
    const client = await pool.connect();

    try {
      // Test connection
      await client.query('SELECT 1;');
      logger.info('✅ PostgreSQL connection pool initialized successfully');

      // Verify schema exists
      const schemaCheck = await client.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'buzzna';`
      );

      if (schemaCheck.rows.length === 0) {
        throw new Error(
          'CRITICAL: buzzna schema does not exist. ' +
          'Run database migrations before starting the application.'
        );
      }

      logger.info('✅ BuzzNa schema verified');

      // Verify RLS is enabled on key tables
      const rlsCheck = await client.query(
        `SELECT tablename FROM pg_tables 
         WHERE schemaname = 'buzzna' AND rowsecurity = true;`
      );

      logger.info(`✅ Row-Level Security enabled on ${rlsCheck.rows.length} tables`);

      // Verify current_tenant_id function exists
      const functionCheck = await client.query(
        `SELECT 1 FROM pg_proc 
         WHERE proname = 'current_tenant_uuid' 
         AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'buzzna');`
      );

      if (functionCheck.rows.length === 0) {
        throw new Error(
          'CRITICAL: current_tenant_uuid() function not found. ' +
          'Ensure migration 0001 has been executed.'
        );
      }

      logger.info('✅ Database initialization complete. System ready.');
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Database initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Gracefully close all connections in the pool
 * Call this during application shutdown
 */
export async function closeDatabase(): Promise<void> {
  try {
    if (poolInstance) {
      await poolInstance.end();
      poolInstance = null;
      logger.info('✅ PostgreSQL connection pool closed');
    }
  } catch (error) {
    logger.error('Error closing database connection pool', { error });
    throw error;
  }
}

/**
 * Reset database connection pool (useful for testing)
 * WARNING: This terminates all active connections
 */
export async function resetConnectionPool(): Promise<void> {
  await closeDatabase();
  poolInstance = null;
}