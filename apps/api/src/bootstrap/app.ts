import express from 'express';
import cors from 'cors';
import { env } from '../config/env';
import { enforceTenantContext } from '../common/middleware/tenant-context';

// Modules
import { authRouter } from '../modules/auth/auth.controller';
import { catalogRouter } from '../modules/catalog/catalog.controller';
import { tillRouter } from '../modules/till/till.controller';
import { inventoryRouter } from '../modules/inventory/inventory.controller';
import { salesRouter } from '../modules/sales/sales.controller';
import { automationRouter } from '../modules/automation/automation.controller';
import { syncRouter } from '../modules/sync/sync.controller';

export const app = express();

// --- Standard Middleware ---
app.use(cors());
app.use(express.json());

// --- Health Check ---
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'DAN74TECHWEB' 
  });
});

// --- Public Routes ---
// Auth is accessible without tenant context
app.use('/api/v1/auth', authRouter);

// --- Protected Routes (Tenant-Scoped) ---
// All modules below require valid tenant/user headers
app.use('/api/v1/catalog', enforceTenantContext, catalogRouter);
app.use('/api/v1/tills', enforceTenantContext, tillRouter);
app.use('/api/v1/inventory', enforceTenantContext, inventoryRouter);
app.use('/api/v1/sales', enforceTenantContext, salesRouter);
app.use('/api/v1/automations', enforceTenantContext, automationRouter);
app.use('/api/v1/sync', enforceTenantContext, syncRouter);

// --- Global Error Handler ---
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]:', err.message);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal Server Error' 
  });
});

// --- Server Startup ---
if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`[BuzzNa D74] Server operational on port ${env.PORT}`);
  });
}