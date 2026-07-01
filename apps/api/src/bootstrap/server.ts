// apps/api/src/bootstrap/server.ts

import http from 'http';
import { Express } from 'express';
import { logger } from '../common/logging/logger';
import { initializeDatabase } from '../db/client';
import { initializeWorkers, scheduleRecurringJobs, shutdownWorkers } from '../workers';
import { checkQueuesHealth } from '../config/queues';

/**
 * Start HTTP Server
 *
 * Performs startup sequence:
 * 1. Initialize database connections
 * 2. Run database migrations
 * 3. Initialize background workers
 * 4. Schedule recurring jobs
 * 5. Start HTTP listener
 *
 * Graceful shutdown on SIGTERM/SIGINT
 */

export async function startServer(app: Express): Promise<http.Server> {
  try {
    logger.info('Starting BuzzNa D74 Server...');

    // ==========================================================================
    // Database Initialization
    // ==========================================================================

    logger.info('Connecting to PostgreSQL...');
    await initializeDatabase();
    logger.info('Database connection established');

    // ==========================================================================
    // Background Workers
    // ==========================================================================

    logger.info('Initializing background workers...');
    await initializeWorkers();
    await scheduleRecurringJobs();
    logger.info('Background workers initialized and scheduled');

    // ==========================================================================
    // Queue Health Check
    // ==========================================================================

    const queueHealth = await checkQueuesHealth();
    logger.info('Queue health status', {
      healthy: queueHealth.healthy,
      queues: queueHealth.queues,
    });

    // ==========================================================================
    // Start HTTP Server
    // ==========================================================================

    const PORT = parseInt(process.env.PORT || '3000');
    const server = http.createServer(app);

    server.listen(PORT, () => {
      logger.info('HTTP server listening', {
        port: PORT,
        env: process.env.NODE_ENV,
        uptime: process.uptime(),
      });
    });

    // ==========================================================================
    // Graceful Shutdown
    // ==========================================================================

    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      // Close HTTP server
      server.close(async () => {
        logger.info('HTTP server closed');

        // Shutdown workers
        await shutdownWorkers();

        logger.info('Graceful shutdown complete');
        process.exit(0);
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        logger.error('Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

export default startServer;