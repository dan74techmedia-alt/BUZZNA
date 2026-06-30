import React from 'react';

/**
 * Billing View
 * Includes LicenseCard, InvoiceTable, and Read-only suspension banners[cite: 36].
 */
export default function Billing() {
    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-6">Platform SaaS Billing</h2>

            {/* Read-only Suspension Banner */}
            <div className="bg-red-100 p-4 rounded border-l-4 border-red-600 mb-6 text-red-900">
                <h3 className="font-bold mb-2">Read-only suspension banners [cite: 36]</h3>
                <ul className="list-disc pl-5">
                    <li>SUSPENDED_NON_PAYMENT enforces a strict read-only lock, blocking all POS writes and syncing[cite: 46].</li>
                </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border p-6 rounded shadow-sm bg-white">
                    <h3 className="font-bold text-lg mb-4">LicenseCard [cite: 36]</h3>
                    <div className="mb-4">
                        <span className="text-gray-500 block">Current Status</span>
                        <span className="font-bold text-yellow-600">PAYMENT_DUE</span>
                    </div>
                    <p className="text-sm text-gray-600">
                        PAYMENT_DUE retains a 3-day grace period[cite: 46].
                    </p>
                </div>

                <div className="border p-6 rounded shadow-sm bg-white">
                    <h3 className="font-bold text-lg mb-4">InvoiceTable [cite: 36]</h3>
                    <p className="text-sm text-gray-500 mb-4">Historical billing records and generated invoices will populate here.</p>
                    <button className="w-full border border-gray-300 text-gray-700 font-bold px-4 py-2 rounded hover:bg-gray-50 transition-colors">
                        View Past Invoices
                    </button>
                </div>
            </div>
        </div>
    );
} 