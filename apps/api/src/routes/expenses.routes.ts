import { Router } from 'express';
import * as expensesController from '../modules/expenses/expenses.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Expense tracking
router.get('/', expensesController.getExpenses);
router.get('/categories', expensesController.getExpenseCategories);

// Record capital outflows
router.post('/', enforceLicenseWriteAccess, expensesController.createExpense);
router.post('/categories', enforceLicenseWriteAccess, expensesController.createExpenseCategory);

export default router;