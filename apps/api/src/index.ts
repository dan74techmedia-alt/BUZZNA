import './bootstrap/load-env';

import { createApp } from './bootstrap/app';
import { startServer } from './bootstrap/server';
import { logger } from './common/logging/logger';

/**
 * BuzzNa D74 Enterprise Operating System
 * API Entry Point
 */

async function main(): Promise<void> {
  try {
    const app = createApp();

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