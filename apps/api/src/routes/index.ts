import { Router } from 'express';
import authRoutes from './auth.routes';
import catalogRoutes from './catalog.routes';
import inventoryRoutes from './inventory.routes';
import salesRoutes from './sales.routes';
import tillRoutes from './till.routes';
import customersRoutes from './customers.routes';
import suppliersRoutes from './suppliers.routes';
import expensesRoutes from './expenses.routes';
import billingRoutes from './billing.routes';
import merchantPaymentsRoutes from './merchant-payments.routes';
import syncRoutes from './sync.routes';
import analyticsRoutes from './analytics.routes';
import notificationsRoutes from './notifications.routes';
import { requireAuth } from '../common/middleware/auth.middleware';

const router = Router();

// API Health Check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'BuzzNa D74 Enterprise OS API is operational.' });
});

// Mount modular routes
// Auth routes handle their own middleware (e.g., public login/register, protected /me)
router.use('/auth', authRoutes);

// Billing webhooks usually bypass standard auth for provider signatures, managed inside the router
router.use('/billing', billingRoutes);

// All other API routes are strictly protected by the mandatory JWT authentication middleware
router.use(requireAuth);

// Domain API Mounts
router.use('/business', authRoutes); // /api/v1/business/me is historically tied to auth/tenancy
router.use('/products', catalogRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/sales', salesRoutes);
router.use('/tills', tillRoutes);
router.use('/customers', customersRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/expenses', expensesRoutes);
router.use('/merchant-payments', merchantPaymentsRoutes);
router.use('/sync', syncRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/notifications', notificationsRoutes);

export default router;