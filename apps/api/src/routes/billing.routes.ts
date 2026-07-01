import { Router } from 'express';
import * as billingController from '../modules/billing/billing.controller';
import * as paystackController from '../modules/billing/paystack.controller';
import { requireAuth } from '../common/middleware/auth.middleware';

const router = Router();

// Paystack Webhooks (Public endpoint, signature validated inside controller)
// Must be mounted before requireAuth or mapped carefully if mounted under protected route in index
router.post('/paystack/webhook', paystackController.handleWebhook);

// Protected Billing Operations
router.use(requireAuth);

// Fetch current subscription plans and billing history
router.get('/plans', billingController.getSubscriptionPlans);
router.get('/invoices', billingController.getInvoices);
router.get('/status', billingController.getLicenseStatus);

// Start corporate BuzzNa billing monetization pipelines
router.post('/paystack/initiate', paystackController.initiatePayment);

export default router;