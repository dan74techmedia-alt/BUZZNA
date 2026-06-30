import React from 'react';

/**
 * Merchant Payments View
 * Handles UnmatchedPaymentsTables and MatchModal[cite: 35].
 */
export default function MerchantPayments() {
    return (
        <div className="p-6">
            <h2 className="text-2xl font-bold mb-2">Merchant Payment Reconciliation</h2>
            <p className="text-gray-600 mb-6">Match Daraja M-Pesa records to transactions[cite: 28].</p>

            <div className="border rounded shadow-sm bg-white overflow-hidden">
                <div className="p-4 bg-gray-50 border-b">
                    <h3 className="font-bold">UnmatchedPaymentsTables [cite: 35]</h3>
                </div>
                <table className="w-full text-left">
                    <thead className="bg-gray-100 text-gray-700">
                        <tr>
                            <th className="p-4">Receipt Number</th>
                            <th className="p-4">Timestamp</th>
                            <th className="p-4">Amount</th>
                            <th className="p-4">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-t hover:bg-gray-50">
                            <td className="p-4">QWE123RTY</td>
                            <td className="p-4">2026-06-30 14:00</td>
                            <td className="p-4">KES 1,500.00</td>
                            <td className="p-4">
                                <button className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm transition-colors">
                                    Open MatchModal [cite: 35]
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
} 