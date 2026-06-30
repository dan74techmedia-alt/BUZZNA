// apps/api/src/modules/expenses/expenses.controller.ts
import { Router, Request, Response, NextFunction } from 'express';
import { ExpensesService } from './expenses.service';
import { validate } from '../../common/middleware/validation.middleware';
import { createExpenseCategorySchema, createExpenseSchema } from './expenses.schema';
import { requireAuth } from '../../common/middleware/auth.middleware';
import { enforceLicense } from '../../common/middleware/license-lockdown.middleware';

const router = Router();

router.use(requireAuth);

router.get('/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await ExpensesService.listCategories(req.user!.tenant_id);
    res.status(200).json({ data: categories });
  } catch (error) {
    next(error);
  }
});

router.post('/categories', enforceLicense(['TRIAL_ACTIVE', 'FULLY_ACTIVATED']), validate(createExpenseCategorySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await ExpensesService.createCategory(req.user!.tenant_id, req.body);
    res.status(201).json({ data: category });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expenses = await ExpensesService.listExpenses(req.user!.tenant_id);
    res.status(200).json({ data: expenses });
  } catch (error) {
    next(error);
  }
});

router.post('/', enforceLicense(['TRIAL_ACTIVE', 'FULLY_ACTIVATED']), validate(createExpenseSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await ExpensesService.createExpense(req.user!.tenant_id, req.user!.user_id, req.body);
    res.status(201).json({ data: expense });
  } catch (error) {
    next(error);
  }
});

export const ExpensesController = router;