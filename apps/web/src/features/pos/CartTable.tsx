import React from 'react';
import { Minus, Plus, Trash2, AlertCircle } from 'lucide-react';
import { useCartStore } from '../../store/cart.store';

export default function CartTable() {
  const { items, updateQuantity, removeItem, getTotal } = useCartStore();

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg m-4">
        <AlertCircle size={48} className="mb-2 text-gray-300" />
        <p className="text-lg font-medium">Checkout Manifest is Empty</p>
        <p className="text-sm">Scan a barcode or use the search drawer to add items.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white m-4 rounded-lg shadow-sm border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-100 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase">Item</th>
            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase">Qty</th>
            <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase">Unit Price</th>
            <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase">Line Total</th>
            <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase">Action</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={item.product_id} className="hover:bg-blue-50 transition-colors group">
              <td className="px-4 py-4">
                <div className="font-semibold text-gray-900">{item.name}</div>
                <div className="text-xs text-gray-500 font-mono">{item.barcode || item.sku || 'NO-SKU'}</div>
                {item.quantity > item.current_quantity && (
                  <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold mt-1 inline-block">
                    WALKAWAY CONFLICT DETECTED
                  </span>
                )}
              </td>
              <td className="px-4 py-4">
                <div className="flex items-center justify-center gap-2">
                  <button 
                    onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                    className="p-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min="0"
                    step={item.unit_of_measure === 'Kg' ? "0.001" : "1"}
                    value={item.quantity}
                    onChange={(e) => updateQuantity(item.product_id, Number(e.target.value))}
                    className="w-16 text-center border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 font-bold"
                  />
                  <button 
                    onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                    className="p-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                    aria-label="Increase quantity"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </td>
              <td className="px-4 py-4 text-right">
                <div className="text-gray-900 font-medium">{item.unit_price.toFixed(2)}</div>
                {item.unit_price < item.cost_floor && (
                  <div className="text-[10px] text-red-500 font-bold">Below Cost Floor</div>
                )}
              </td>
              <td className="px-4 py-4 text-right">
                <div className="text-gray-900 font-bold text-lg">
                  {(item.quantity * item.unit_price).toFixed(2)}
                </div>
              </td>
              <td className="px-4 py-4 text-center">
                <button 
                  onClick={() => removeItem(item.product_id)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                  title="Remove Item"
                >
                  <Trash2 size={20} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}