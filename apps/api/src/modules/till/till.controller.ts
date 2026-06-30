// apps/api/src/modules/till/till.controller.ts
import { Router, Request, Response, NextFunction } from 'express';
import { TillService } from './till.service';
import { validate } from '../../common/middleware/validation.middleware';
import { openTillSchema, closeTillSchema } from './till.schema';
import { requireAuth } from '../../common/middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await TillService.getActiveSession(req.user!.tenant_id, req.user!.user_id);
    res.status(200).json({ data: session });
  } catch (error) {
    next(error);
  }
});

router.post('/open', validate(openTillSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await TillService.openSession(req.user!.tenant_id, req.user!.user_id, req.body);
    res.status(201).json({ data: session });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/close', validate(closeTillSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await TillService.closeSession(req.user!.tenant_id, req.params.id, req.body);
    res.status(200).json({ data: summary });
  } catch (error) {
    next(error);
  }
});

export const TillController = router;