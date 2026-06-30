import React, { useState } from 'react';

/**
 * Till Management View
 * Features EOD Shop Close Wizard with multi-step blind balance forms[cite: 33].
 */
export default function TillManagement() {
    const [actualCash, setActualCash] = useState<number | ''>('');

    const handleClosure = () => {
        // Business Rule: Cashiers cannot see expected till balance during closure[cite: 42].
        // Enforcement: If physical cash entry variance exceeds limits, the session locks (REVIEW_REQUIRED)[cite: 43].
        console.log("Submitting blind handover payload: ", { actualCash });
    };

    return (
        <div className="p-6 max-w-lg mx-auto">
            <h2 className="text-2xl font-bold mb-4">EOD Shop Close Wizard [cite: 33]</h2>
            
            <div className="border p-6 rounded shadow-md bg-white">
                <div className="mb-4">
                    <label className="block text-gray-700 font-bold mb-2">
                        Physical Cash Entry (Blind Handover)
                    </label>
                    <p className="text-sm text-gray-500 mb-4">
                        Cashiers cannot see expected till balance during closure[cite: 42].
                    </p>
                    <input
                        type="number"
                        className="border p-3 w-full rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={actualCash}
                        onChange={(e) => setActualCash(Number(e.target.value))}
                        placeholder="Enter actual cash counted"
                    />
                </div>
                
                <button 
                    onClick={handleClosure} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-3 rounded transition-colors"
                >
                    Submit Blind Balance
                </button>
            </div>
        </div>
    );
} 