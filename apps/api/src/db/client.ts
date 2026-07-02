// apps/api/src/db/client.ts

import { Pool, PoolClient, QueryResult } from 'pg';
import { env } from '../config/env';
import { logger } from '../common/logging/logger';
import { getCurrentTenantContext } from '../common/tenant-context';

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

// Global connection pool instance
let poolInstance: Pool | null = null;

/**
 * Create PostgreSQL connection pool with Neon-optimized settings
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
 * Execute a query with automatic tenant context injection
 *
 * CRITICAL: This wraps EVERY query in:
 * BEGIN;
 * SET LOCAL app.current_tenant_id = <tenant_id>;
 * <actual query>
 * COMMIT;
 *
 * This prevents connection pool leakage where reused connections
 * could retain the previous request's tenant context.
 *
 * @template T - Result row type
 * @param query - SQL query string (parameterized)
 * @param params - Query parameters array
 * @returns QueryResult<T> with rows and row count
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  // Get tenant context from AsyncLocalStorage
  const context = getCurrentTenantContext();

  const pool = getConnectionPool();
  let client: PoolClient | null = null;

  try {
    // Acquire connection from pool
    client = await pool.connect();

    // Begin explicit transaction
    await client.query('BEGIN;');

    try {
      // Set tenant context as LOCAL (connection-specific, transaction-scoped)
      await client.query(
        `SET LOCAL app.current_tenant_id = $1;`,
        [context.tenantId]
      );

      // Execute the actual business logic query
      const result = await client.query<T>(query, params);

      // Commit transaction
      await client.query('COMMIT;');

      logger.debug('Query executed successfully', {
        tenantId: context.tenantId,
        queryLength: query.length,
        rowsAffected: result.rowCount,
      });

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
  } catch (error) {
    logger.error('Query execution failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId: context.tenantId,
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
 */
export async function executeBatchQueries<T = any>(
  queries: Array<[string, any[]]>
): Promise<QueryResult<T>[]> {
  const context = getCurrentTenantContext();

  const pool = getConnectionPool();
  let client: PoolClient | null = null;
  const results: QueryResult<T>[] = [];

  try {
    client = await pool.connect();

    // Begin transaction
    await client.query('BEGIN;');

    try {
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
      try {
        await client.query('ROLLBACK;');
      } catch (rollbackError) {
        logger.error('Batch rollback failed', { error: rollbackError });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Batch query execution failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId: context.tenantId,
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
 *
 * @template T - Result type
 * @param callback - Async function receiving the client
 * @returns Result from callback
 */
export async function executeTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const context = getCurrentTenantContext();

  const pool = getConnectionPool();
  let client: PoolClient | null = null;

  try {
    client = await pool.connect();

    // Begin transaction
    await client.query('BEGIN;');

    try {
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
      try {
        await client.query('ROLLBACK;');
      } catch (rollbackError) {
        logger.error('Transaction rollback failed', { error: rollbackError });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Custom transaction failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId: context.tenantId,
    });
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Initialize database and verify schema exists
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
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'public';`
      );

      if (schemaCheck.rows.length === 0) {
        logger.warn('⚠️ Database schema not found. Migrations may need to be run.');
      } else {
        logger.info('✅ Database schema verified');
      }
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
 * Gracefully close all connections
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
