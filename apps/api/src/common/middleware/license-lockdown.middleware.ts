import { Request, Response, NextFunction } from 'express';

// Ensure the request has passed through tenant unpacking middleware first
export const enforceLicenseStatus = (req: Request, res: Response, next: NextFunction) => {
    const tenantContext = req.tenant; // Injected by your Layer 1 JWT Middleware

    if (!tenantContext) {
        return res.status(401).json({ error: 'Tenant context missing from request.' });
    }

    const { licenseStatus } = tenantContext;
    const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

    // If the tenant is suspended, strictly block all operational write requests
    if (licenseStatus === 'SUSPENDED_NON_PAYMENT' && writeMethods.includes(req.method)) {
        
        // Define paths that MUST remain open even during suspension (e.g., paying the bill)
        const allowedSuspendedPaths = [
            '/api/v1/billing/paystack/initiate',
            '/api/v1/auth/logout'
        ];

        if (!allowedSuspendedPaths.some(path => req.path.includes(path))) {
            return res.status(403).json({
                error: 'Account suspended due to non-payment. Operational writes (POS, Inventory, Expenses) are strictly locked. Please update your billing to resume.'
            });
        }
    }

    // TRIAL_ACTIVE, FULLY_ACTIVATED, PAYMENT_DUE, GRACE_PERIOD allow full execution scopes
    next();
};