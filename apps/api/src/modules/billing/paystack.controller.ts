import { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../../bootstrap/database';

export const handlePaystackWebhook = async (req: Request, res: Response) => {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET as string;
    const signature = req.headers['x-paystack-signature'] as string;

    // 1. HMAC-SHA512 Cryptographic Verification
    const hash = crypto.createHmac('sha512', secret)
                       .update(JSON.stringify(req.body))
                       .digest('hex');

    if (hash !== signature) {
        return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body;

    // Fast return 200 to acknowledge receipt to Paystack immediately
    res.status(200).send('Webhook received');

    // 2. Process Successful Payment (Asynchronously or via BullMQ in production)
    if (event.event === 'charge.success') {
        const paystackReference = event.data.reference;
        const amountPaid = event.data.amount / 100; // Paystack amounts are in kobo/cents
        const tenantId = event.data.metadata.tenant_id;

        try {
            // 3. Idempotency Check: Prevent Double-Crediting
            const existingPayment = await db.selectFrom('subscription_payments')
                .where('paystack_reference', '=', paystackReference)
                .executeTakeFirst();

            if (existingPayment) {
                console.log(`Payment ${paystackReference} already processed. Skipping.`);
                return;
            }

            // 4. Update Database (Insert Payment & Update License Status)
            await db.transaction().execute(async (trx) => {
                // Set Layer 2 Context Enforcement
                await trx.executeQuery(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

                await trx.insertInto('subscription_payments')
                    .values({
                        tenant_id: tenantId,
                        paystack_reference: paystackReference,
                        amount_paid: amountPaid,
                        raw_webhook_payload: event.data
                    })
                    .execute();

                // Restore business operational scope
                await trx.updateTable('businesses')
                    .set({ license_status: 'ACTIVE_MONTHLY' })
                    .where('tenant_id', '=', tenantId)
                    .execute();
            });

        } catch (error) {
            console.error('Failed to process Paystack webhook:', error);
            // In a robust system, drop this into a Dead Letter Queue or BullMQ retry loop
        }
    }
};