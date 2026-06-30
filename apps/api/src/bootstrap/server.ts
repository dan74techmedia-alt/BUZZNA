// apps/api/src/bootstrap/server.ts

import cluster from 'cluster';
import os from 'os';
import http from 'http';
import { env } from './load-env';
import app from './app';
import { logger } from '../common/logging/logger';
import { pool } from '../config/database';
import { redisCacheClient } from '../config/redis';

const totalCpuCores = os.cpus().length;

if (cluster.isPrimary && env.NODE_ENV === 'production') {
  logger.info(`Master System Bootstrapper Core starting in Production Cluster mode.`);
  logger.info(`Provisioning system worker threads across ${totalCpuCores} isolated CPU cores.`);

  // Fork system execution pipelines to match physical architecture capacity
  for (let i = 0; i < totalCpuCores; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.error(`Execution system thread worker [PID: ${worker.process.pid}] terminated unexpectedly with Code: ${code} | Signal: ${signal}. Spawning replacement worker thread.`);
    cluster.fork();
  });
} else {
  const httpServer = http.createServer(app);

  httpServer.listen(env.PORT, () => {
    logger.info(`BuzzNa D74 Production Engine fully operational on Port Vector: ${env.PORT} [Process PID: ${process.pid}]`);
  });

  // Handle systemic lifecycle interruption signatures gracefully
  const initiateGracefulTeardown = async (signalEvent: string) => {
    logger.warn(`System received termination intercept signature via ${signalEvent}. Initiating graceful operational shutdown sequence.`);
    
    httpServer.close(async () => {
      logger.info('HTTP server infrastructure channel safely closed. Halting database pools and asynchronous worker fabrics.');
      
      try {
        // Drain database connection pools safely
        await pool.end();
        logger.info('Relational Neon PostgreSQL database connection pools completely drained.');
        
        // Terminate cache connectivity
        await redisCacheClient.quit();
        logger.info('Asynchronous redis backend communication instances disconnected safely.');
        
        logger.info('System components shutdown executed clean. Terminating process pipeline context.');
        process.exit(0);
      } catch (error) {
        logger.error('An error was encountered during system teardown sequence execution:', error);
        process.exit(1);
      }
    });

    // Force strict hard drop timeout if system processes fail to drop within safe window parameters
    setTimeout(() => {
      logger.error('Graceful teardown window timeout exceeded. Enforcing structural emergency application exit.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => initiateGracefulTeardown('SIGTERM'));
  process.on('SIGINT', () => initiateGracefulTeardown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection warning caught inside server framework context:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Critical Uncaught Exception event trapped inside system bootstrap execution scope:', error);
    initiateGracefulTeardown('UNCAUGHT_EXCEPTION');
  });
}