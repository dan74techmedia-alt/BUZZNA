vimport { Request } from 'express';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'FATAL';

interface LogMetadata {
  tenantId?: string;
  userId?: string;
  path?: string;
  method?: string;
  durationMs?: number;
  [key: string]: any;
}

/**
 * Centralized logging pipeline optimized for production deployment on Render.
 * Outputs strictly formatted JSON to stdout/stderr for automated log aggregation.
 */
class Logger {
  private formatMessage(level: LogLevel, message: string, meta?: LogMetadata): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    return JSON.stringify(logEntry);
  }

  public info(message: string, meta?: LogMetadata): void {
    console.log(this.formatMessage('INFO', message, meta));
  }

  public warn(message: string, meta?: LogMetadata): void {
    console.warn(this.formatMessage('WARN', message, meta));
  }

  public error(message: string, meta?: LogMetadata): void {
    console.error(this.formatMessage('ERROR', message, meta));
  }

  public debug(message: string, meta?: LogMetadata): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('DEBUG', message, meta));
    }
  }

  public fatal(message: string, meta?: LogMetadata): void {
    console.error(this.formatMessage('FATAL', message, meta));
    // Fatal errors trigger immediate process termination to prevent unstable states
    process.exit(1);
  }

  /**
   * Helper to extract standard tracking metadata from an Express request context.
   */
  public extractRequestMeta(req: Request): LogMetadata {
    return {
      tenantId: req.context?.tenantId,
      userId: req.context?.userId,
      path: req.path,
      method: req.method,
      ip: req.ip,
    };
  }
}

export const logger = new Logger(); 