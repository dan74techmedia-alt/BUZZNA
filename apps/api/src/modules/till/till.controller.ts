import { Response, Router } from 'express';
import { withTenant, db } from '../../config/database';
import { openTillSchema } from './till.schema';
import { AuthenticatedRequest, enforceTenantContext } from '../../common/middleware/tenant-context';

export const tillRouter = Router();
tillRouter.use(enforceTenantContext);

tillRouter.post('/open', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = openTillSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const session = await withTenant(tenantId, async (trx) => {
      // Rule: Cashier can only have exactly one open till session active simultaneously
      const existingSession = await trx.selectFrom('till_sessions')
        .select('till_session_id')
        .where('cashier_user_id', '=', userId)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();

      if (existingSession) {
        throw new Error('You already have an open till session.');
      }

      return await trx.insertInto('till_sessions')
        .values({
          tenant_id: tenantId,
          cashier_user_id: userId,
          status: 'OPEN',
          opening_float: data.openingFloat.toString(),
          expected_cash_balance: data.openingFloat.toString(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    res.status(201).json({ message: 'Till session opened', data: session });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to open till session' });
  }
});