import { Request, Response } from 'express';
import { db } from '../../bootstrap/database';
import { sql } from 'kysely';

export const handleDarajaCallback = async (req: Request, res: Response) => {
    const { Body } = req.body;

    // Fast return to Safaricom to acknowledge receipt
    res.status(200).json({ ResultCode: 0, ResultDesc: "Confirmation received successfully" });

    if (!Body || !Body.stkCallback) {
        return;
    }

    const callbackData = Body.stkCallback;
    const resultCode = callbackData.ResultCode;

    // Process only successful checkout transactions
    if (resultCode === 0) {
        const metaItems = callbackData.CallbackMetadata.Item;
        
        let amount: number = 0;
        let mpesaReceiptNumber: string = '';
        let phoneNumber: string = '';
        let transactionDateStr: string = '';

        for (const item of metaItems) {
            switch (item.Name) {
                case 'Amount':
                    amount = item.Value;
                    break;
                case 'MpesaReceiptNumber':
                    mpesaReceiptNumber = item.Value;
                    break;
                case 'PhoneNumber':
                    phoneNumber = String(item.Value);
                    break;
                case 'TransactionDate':
                    transactionDateStr = String(item.Value);
                    break;
            }
        }

        try {
            // Locate target tenant based on the merchant shortcode mapping configuration
            const connection = await db.selectFrom('merchant_payment_connections')
                .where('is_active', '=', true)
                // Assuming callback includes identifier details or custom metadata parameters
                .select(['tenant_id'])
                .executeTakeFirst();

            if (!connection) {
                console.error(`No active merchant connection found for incoming automated payment: ${mpesaReceiptNumber}`);
                return;
            }

            const tenantId = connection.tenant_id;

            await db.transaction().execute(async (trx) => {
                // Enforce Layer 2 Connection Pool Isolation Context
                await trx.executeQuery(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

                // Idempotency check: prevent duplicate callback execution logs
                const existingPayment = await trx.selectFrom('merchant_payments')
                    .where('mpesa_receipt_number', '=', mpesaReceiptNumber)
                    .executeTakeFirst();

                if (existingPayment) {
                    return;
                }

                // Append payment row as UNMATCHED to await algorithmic pairing
                await trx.insertInto('merchant_payments')
                    .values({
                        tenant_id: tenantId,
                        amount: amount,
                        mpesa_receipt_number: mpesaReceiptNumber,
                        payer_phone: phoneNumber,
                        status: 'UNMATCHED',
                        raw_payload: JSON.stringify(callbackData),
                        created_at: new Date()
                    })
                    .execute();
            });

        } catch (error) {
            console.error('Failed processing inbound Daraja collection webhook item:', error);
        }
    }
};