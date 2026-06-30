// apps/api/src/modules/expenses/expenses.schema.ts
import { z } from 'zod';

export const createExpenseCategorySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Category name must be at least 2 characters long').max(100),
  }),
});

export const createExpenseSchema = z.object({
  body: z.object({
    category_id: z.string().uuid('Invalid Category ID format'),
    till_session_id: z.string().uuid('Invalid Till Session ID format').optional(),
    amount: z.number().positive('Expense amount must be greater than zero'),
    description: z.string().min(5, 'Provide a descriptive reason for this expense').max(500),
  }),
});

export type CreateExpenseCategoryDTO = z.infer<typeof createExpenseCategorySchema>['body'];
export type CreateExpenseDTO = z.infer<typeof createExpenseSchema>['body'];