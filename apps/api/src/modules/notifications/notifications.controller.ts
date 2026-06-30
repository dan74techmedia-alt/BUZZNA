import { Request, Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service';

export class NotificationsController {
  private notificationsService = new NotificationsService();

  /**
   * Handles manual or system-triggered SMS routing allocations.
   */
  public sendSmsRoute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.context?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Context termination error: Bound authorization token token lacks verified tenant context.' });
        return;
      }

      const result = await this.notificationsService.sendSms(req.body, tenantId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Exposes system alert attention card generation capabilities internally.
   */
  public createCardRoute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.context?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Context termination error: Bound authorization token lacks verified tenant context.' });
        return;
      }

      const cardId = await this.notificationsService.createAttentionCard(req.body, tenantId);
      res.status(201).json({ success: true, cardId });
    } catch (error) {
      next(error);
    }
  };
}