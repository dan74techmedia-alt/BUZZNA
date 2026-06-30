import { App } from '@capacitor/app';
import { db } from '../../offline/db';

/**
 * Initializes the bridge between the native Android MpesaSmsReceiver 
 * and the local IndexedDB database (Dexie).
 */
export const initializeOfflineSmsBridge = async () => {
    // Listen for custom events fired by the native container
    App.addListener('onMpesaReceiptReceived', async (data: any) => {
        try {
            console.log('Received offline M-Pesa SMS from native container:', data);
            
            const rawMessage = data.rawMessage;
            
            // Basic regex parsing to extract Receipt Number and Amount
            // Example format: "QWE123RTY Confirmed. Ksh1,500.00 sent to BuzzNa..."
            const receiptMatch = rawMessage.match(/^[A-Z0-9]{10}/);
            const amountMatch = rawMessage.match(/Ksh([\d,]+\.\d{2})/);

            if (receiptMatch && amountMatch) {
                const receiptNumber = receiptMatch[0];
                const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

                // Write directly to IndexedDB local cache for offline terminal matching
                await db.table('merchant_payments_cache').add({
                    receipt_number: receiptNumber,
                    amount: amount,
                    raw_message: rawMessage,
                    status: 'PENDING_MATCH',
                    synced: false,
                    terminal_timestamp: new Date().toISOString()
                });

                console.log(`Successfully cached offline receipt ${receiptNumber} for ${amount}`);
            }
        } catch (error) {
            console.error('Failed to process offline SMS to IndexedDB:', error);
        }
    });
}; 