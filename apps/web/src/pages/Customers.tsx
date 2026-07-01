import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, CreditCard, AlertCircle, FileText } from 'lucide-react';
import { api } from '../offline/syncmanager'; // Assuming an internal wrapper for Axios/fetch

interface Customer {
  customer_id: string;
  full_name: string;
  phone_number: string | null;
  is_active: boolean;
  debt_balance: number; // Derived from customer_credit_ledger
}

export default function Customers() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [isRepaymentModalOpen, setRepaymentModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  // Fetch customers with aggregated debt balances
  const { data: customers = [], isLoading, isError } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => {
      const response = await api.get('/api/v1/customers');
      return response.data;
    },
  });

  const recordRepaymentMutation = useMutation({
    mutationFn: async (payload: { customer_id: string; amount: number; payment_method: string }) => {
      return await api.post(`/api/v1/customers/${payload.customer_id}/repayments`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setRepaymentModalOpen(false);
      setRepaymentAmount('');
      setSelectedCustomer(null);
    },
  });

  const handleRepaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !repaymentAmount || isNaN(Number(repaymentAmount))) return;
    
    recordRepaymentMutation.mutate({
      customer_id: selectedCustomer.customer_id,
      amount: Number(repaymentAmount),
      payment_method: paymentMethod,
    });
  };

  const filteredCustomers = customers.filter(c => 
    c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (c.phone_number && c.phone_number.includes(searchTerm))
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Neighborhood Credit Ledger</h1>
          <p className="text-sm text-gray-500">Manage customer accounts and track outstanding debts</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
          <Plus size={18} />
          <span>New Customer</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by name or MSISDN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <FileText size={16} />
            <span>Export Debt Analytics</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex justify-center items-center h-64 text-gray-500">Loading ledger data...</div>
          ) : isError ? (
            <div className="flex justify-center items-center h-64 text-red-500 gap-2">
              <AlertCircle size={20} />
              <span>Failed to load customer ledger. Verify connection or tenant context.</span>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Outstanding Debt</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredCustomers.map((customer) => (
                  <tr key={customer.customer_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{customer.full_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {customer.phone_number || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${customer.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {customer.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`font-medium ${customer.debt_balance > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        KSH {customer.debt_balance.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        disabled={customer.debt_balance <= 0}
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setRepaymentModalOpen(true);
                        }}
                        className={`flex items-center justify-end gap-1 w-full ${customer.debt_balance > 0 ? 'text-blue-600 hover:text-blue-900' : 'text-gray-300 cursor-not-allowed'}`}
                      >
                        <CreditCard size={16} />
                        Receive Pay
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      No customers found matching the search criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Repayment Modal */}
      {isRepaymentModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Record Repayment</h2>
            <div className="mb-4 p-3 bg-blue-50 text-blue-800 rounded border border-blue-100 text-sm">
              <span className="font-semibold">{selectedCustomer.full_name}</span> has an outstanding balance of <span className="font-bold text-red-600">KSH {selectedCustomer.debt_balance.toFixed(2)}</span>
            </div>
            
            <form onSubmit={handleRepaymentSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Received (NUMERIC 12,2)</label>
                <input
                  type="number"
                  step="0.01"
                  max={selectedCustomer.debt_balance}
                  required
                  value={repaymentAmount}
                  onChange={(e) => setRepaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="CASH">CASH</option>
                  <option value="MPESA">MPESA</option>
                </select>
              </div>
              
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRepaymentModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={recordRepaymentMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordRepaymentMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400 flex items-center gap-2"
                >
                  {recordRepaymentMutation.isPending ? 'Processing...' : 'Confirm Repayment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}