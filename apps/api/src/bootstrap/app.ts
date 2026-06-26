import express from 'express';
import cors from 'cors';
import { env } from '../config/env';
import { enforceTenantContext } from '../common/middleware/tenant-context';

// Initialize the Express application
export const app = express();

// Standard middleware
app.use(cors());
app.use(express.json()); // All core systems communicate via JSON payloads

// Health check endpoint for Render deployment
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Mount domain modules (to be implemented systematically)
// app.use('/api/v1/auth', authRouter);
// app.use('/api/v1/sales', enforceTenantContext, salesRouter);
// app.use('/api/v1/inventory', enforceTenantContext, inventoryRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Boot the server
if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`[BuzzNa D74] Server operational on port ${env.PORT} in ${env.NODE_ENV} mode.`);
  });
}
