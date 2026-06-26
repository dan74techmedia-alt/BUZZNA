import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../offline/db';
import { SyncManager } from '../offline/syncManager';
import { useAuth } from '../providers/AuthProvider';

// --- Types ---
interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  costFloor: number;
}

export default function PosConsole() {
  const { tenant, user } = useAuth();
  
  // --- State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'MPESA'>('CASH');
  const [isProcessing, setIsProcessing] = useState(false);

  // --- Real-time Offline Cache Query ---
  // This achieves zero-latency by reading directly from the user's device
  const searchResults = useLiveQuery(
    () => {
      if (!searchTerm) return localDb.products_cache.limit(10).toArray();
      return localDb.products_cache
        .where('name').startsWithIgnoreCase(searchTerm)
        .or('barcode').equals(searchTerm)
        .limit(10)
        .toArray();
    },
    [searchTerm]
  );

  // --- Real-time Sync Queue Monitor ---
  const pendingSyncCount = useLiveQuery(
    () => localDb.sync_queue.where('syncStatus').equals('PENDING').count(),
    []
  );

  // --- Handlers ---
  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.product_id);
      if (existing) {
        return prev.map(item => 
          item.productId === product.product_id 
            ? { ...item, quantity: item.quantity + 1 } 
            : item
        );
      }
      return [...prev, {
        productId: product.product_id,
        name: product.name,
        quantity: 1,
        unitPrice: Number(product.default_selling_price),
        costFloor: Number(product.cost_floor)
      }];
    });
    setSearchTerm(''); // Reset search for next high-velocity scan
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setIsProcessing(true);

    try {
      // 1. Build Payload adhering to Phase 4 Contract
      const salePayload = {
        saleDate: new Date().toISOString(),
        cashierId: user?.user_id,
        items: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineDiscount: 0 
        })),
        paymentAllocations: [{
          paymentMethod: paymentMethod,
          amount: cartTotal
        }],
        totalAmount: cartTotal
      };

      // 2. Queue the event locally. This is INSTANT.
      await SyncManager.queueEvent('SALE', 'SALE_FINALIZED', salePayload);

      // 3. Deduct projected local inventory immediately (Walkaway Protocol)
      for (const item of cart) {
         const p = await localDb.products_cache.get(item.productId);
         if (p) {
            await localDb.products_cache.update(item.productId, { current_quantity: p.current_quantity - item.quantity });
         }
      }

      // 4. Reset UI for the next customer
      setCart([]);
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      
      {/* LEFT PANEL: Product Search & Grid */}
      <div className="flex-1 flex flex-col border-r border-[var(--color-surface)] p-4">
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Terminal: {tenant?.legal_name}</h1>
          
          {/* Offline Pending Badge */}
          {pendingSyncCount !== undefined && pendingSyncCount > 0 && (
            <div className="bg-[var(--color-secondary)] text-white px-3 py-1 rounded-full text-sm font-medium animate-pulse">
              {pendingSyncCount} Pending Sync
            </div>
          )}
        </header>

        {/* High-Velocity Search Bar */}
        <input 
          autoFocus
          type="text"
          placeholder="Scan barcode or search by name..."
          className="w-full p-4 mb-4 text-lg bg-[var(--color-surface)] border-2 border-transparent focus:border-[var(--color-primary)] rounded outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-4">
          {searchResults?.map(product => (
            <button 
              key={product.product_id}
              onClick={() => addToCart(product)}
              className="p-4 bg-[var(--color-surface)] rounded shadow hover:border-[var(--color-primary)] border-2 border-transparent flex flex-col items-start transition-all"
            >
              <span className="font-semibold">{product.name}</span>
              <span className="text-[var(--color-primary)] font-bold mt-2">
                KES {Number(product.default_selling_price).toFixed(2)}
              </span>
              <span className="text-xs opacity-60 mt-1">Stock: {product.current_quantity} {product.unit_of_measure}</span>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL: Cart & Checkout */}
      <div className="w-96 flex flex-col bg-[var(--color-surface)] p-4 shadow-xl">
        <h2 className="text-xl font-bold mb-4 border-b border-gray-300 pb-2">Current Cart</h2>
        
        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-center opacity-50 mt-10">Cart is empty.</p>
          ) : (
            cart.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center mb-4 bg-[var(--color-background)] p-3 rounded">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm opacity-70">{item.quantity} x KES {item.unitPrice.toFixed(2)}</p>
                </div>
                <p className="font-bold">KES {(item.quantity * item.unitPrice).toFixed(2)}</p>
              </div>
            ))
          )}
        </div>

        {/* Payment Allocation Panel */}
        <div className="mt-4 border-t border-gray-300 pt-4">
          <div className="flex justify-between text-xl font-bold mb-4">
            <span>Total:</span>
            <span>KES {cartTotal.toFixed(2)}</span>
          </div>

          <div className="flex gap-2 mb-4">
            <button 
              className={`flex-1 py-3 font-bold rounded ${paymentMethod === 'CASH' ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-200 text-gray-700'}`}
              onClick={() => setPaymentMethod('CASH')}
            >
              CASH
            </button>
            <button 
              className={`flex-1 py-3 font-bold rounded ${paymentMethod === 'MPESA' ? 'bg-[#4CAF50] text-white' : 'bg-gray-200 text-gray-700'}`}
              onClick={() => setPaymentMethod('MPESA')}
            >
              M-PESA
            </button>
          </div>

          <button 
            disabled={cart.length === 0 || isProcessing}
            onClick={handleCheckout}
            className="w-full py-4 bg-[var(--color-primary)] text-white text-xl font-bold rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isProcessing ? 'Processing...' : 'Complete Checkout'}
          </button>
        </div>
      </div>
    </div>
  );
}