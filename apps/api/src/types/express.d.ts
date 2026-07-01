import { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      user?: {
        userId: string;
        username: string;
        roleId: string;
        permissions: string[];
      };
      licenseStatus?: 'TRIAL_ACTIVE' | 'ACTIVE' | 'SUSPENDED_NON_PAYMENT' | 'GRACE_PERIOD';
    }
  }
}