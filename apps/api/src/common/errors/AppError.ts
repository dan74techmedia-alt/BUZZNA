/**
 * Standardized application error class for the BuzzNa D74 API.
 * Distinguishes between expected operational errors (e.g., validation failures, unauthorized access)
 * and unexpected programming errors (e.g., database connection drops).
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorCode?: string;

  constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    errorCode?: string
  ) {
    super(message);
    
    // Restore prototype chain for proper `instanceof` evaluations in TypeScript
    Object.setPrototypeOf(this, new.target.prototype);
    
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errorCode = errorCode;
    
    Error.captureStackTrace(this);
  }
}

/**
 * Specific error class for Offline Sync pipeline rejections.
 * Preserves the exact array index of the failing transaction to avoid rejecting the entire batch.
 */
export class SyncBatchError extends AppError {
  public readonly failedRecordIndex: number;

  constructor(message: string, failedRecordIndex: number, errorCode = 'SYNC_CONFLICT_REJECTED') {
    super(message, 409, true, errorCode);
    this.failedRecordIndex = failedRecordIndex;
  }
}