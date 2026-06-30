// File Path: apps/api/src/bootstrap/app.ts

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

let compression: any;
try {
  compression = require('compression');
} catch {
  compression = () => (req: Request, res: Response, next: NextFunction) => next();
}

// Infrastructure Core Vectors
import { errorHandler } from '../common/errors/errorHandler';
import { logger } from '../common/logging/logger';
import { authenticateTenant, requirePermission } from '../common/middleware/auth.middleware';
import { licenseLockdown } from '../common/middleware/license-lockdown.middleware';

// Authoritative Control Plane Module Routers
import { authRouter } from '../modules/auth/auth.controller';
import { catalogRouter } from '../modules/catalog/catalog.controller';
import { inventoryRouter } from '../modules/inventory/inventory.controller';
import { salesRouter } from '../modules/sales/sales.controller';
import { tillRouter } from '../modules/till/till.controller';
import { expensesRouter } from '../modules/expenses/expenses.controller';
import { customersRouter } from '../modules/customers/customers.controller';
import { suppliersRouter } from '../modules/suppliers/suppliers.controller';
import { analyticsRouter } from '../modules/analytics/analytics.controller';
import { automationRouter } from '../modules/automation/automation.controller';
import { notificationsRouter } from '../modules/notifications/notifications.controller';
import { paystackRouter } from '../modules/billing/paystack.controller';
import { darajaRouter } from '../modules/merchant-payments/daraja.controller';
import { syncRouter } from '../modules/sync/sync.controller';

// Extend Express Request interface to preserve unmutated buffer strings natively
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// Instantiate core Express engine execution thread
const app: Application = express();

/**
 * Global HTTP Traffic Shielding & Optimizations
 */
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client-Version'],
  credentials: true
}));
app.use(compression());

// Route access logger stream redirected directly into Winston architecture
app.use(morgan(':method :url :status :res[content-length] - :response-time ms', {
  stream: { write: (message: string) => logger.info(message.trim()) }
}));

/**
 * Advanced Parsing Assembly Engine
 * Intercepts incoming requests and preserves binary raw body states before serialization.
 * This guarantees that downstream webhook validators receive unaltered cryptographic signatures.
 */
app.use(express.json({
  limit: '10mb',
  verify: (req: Request, res: Response, buf: Buffer) => {
    if (buf && buf.length) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

/**
 * System Operational Pulse Checks (Infrastructure Boundary)
 */
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'HEALTHY',
    systemTime: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

/**
 * Layer 1 Boundary: Public Access Lines
 * These channels handle core user sign-ons or process automated asynchronous webhooks 
 * from external payment servers that cannot supply a standard Tenant Bearer Token.
 */
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/billing/webhooks', paystackRouter);
import { requirePermission } from '../common/middleware/auth.middleware';
app.use('/api/v1/merchant-payments/webhooks', darajaRouter);

/**
 * Layer 2 Boundary: Secure Multi-Tenant Operations
 * Enforces strict JWT verification and applies a license check to all routes below.
 * This prevents deactivated tenants or invalid identities from accessing internal services.
 */
app.use('/api/v1', authenticateTenant, licenseLockdown);

// Wire protected sub-module routers into the secure workspace path
app.use('/api/v1/catalog', catalogRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/sales', salesRouter);
app.use('/api/v1/till', tillRouter);
app.use('/api/v1/expenses', expensesRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/suppliers', suppliersRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/automation', automationRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/sync', syncRouter);

/**
 * Layer 3 Boundary: Exception Routing & Fallbacks
 * Captures dead routes or unhandled execution errors before they can impact server uptime.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The requested endpoint [${req.method} ${req.url}] does not exist on this cluster interface.`
    }
  });
});

// Primary Operational Global Error Interceptor Matrix
app.use(errorHandler);

export default app;