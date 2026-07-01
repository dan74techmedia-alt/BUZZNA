// apps/api/src/index.ts

import loadEnvironment from './bootstrap/load-env';
import { createApp } from './bootstrap/app';
import { startServer } from './bootstrap/server';
import { logger } from './common/logging/logger';

/**
 * Application Entry Point
 *
 * Initializes and starts the BuzzNa D74 backend server
 */

async function main(): Promise<void> {
  try {
    // Load environment
    loadEnvironment();

    // Create Express app
    const app = createApp();

    // Start HTTP server
    await startServer(app);
  } catch (error) {
    logger.error('Fatal error starting application', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();

export default main;