// apps/api/src/modules/tenancy/tenancy.controller.ts

import { Request, Response, NextFunction } from 'express';
import { TenancyService } from './tenancy.service';
import { AppError } from '../../common/errors/AppError';

export class TenancyController {
  private tenancyService: TenancyService;

  constructor() {
    this.tenancyService = new TenancyService();
  }

  /**
   * GET /api/v1/business/me
   * Fetches the active business profile and SaaS entitlement snapshot parameters.
   * Relies on context injection to guarantee tenant isolation.
   */
  public getActiveBusinessProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = req.context?.tenantId;

      if (!tenantId) {
        throw new AppError('Unauthorized: Tenant context is missing or invalid.', 401);
      }

      // The service layer must wrap this query in:
      // BEGIN; SET LOCAL app.current_tenant_id = 'tenantId'; ... COMMIT;
      // to satisfy the architectural Connection Pool Leakage Prevention rule.
      const businessProfile = await this.tenancyService.getBusinessProfile(tenantId);

      if (!businessProfile) {
        throw new AppError('Business profile lookup failed. Tenant record may be corrupted.', 404);
      }

      res.status(200).json({
        success: true,
        data: businessProfile
      });
    } catch (error) {
      next(error);
    }
  };
}