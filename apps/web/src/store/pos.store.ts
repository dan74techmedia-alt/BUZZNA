/**
 * BUZZNA D74 ENTERPRISE OPERATING SYSTEM
 * Frontend POS State Management (Zustand)
 * * Architecture: Offline-First & Local-Authority
 * Purpose: Manages the active checkout manifest, enforces margin validation (Mitumba),
 * handles decimal fractional units (Butcheries), and queues offline transactions.
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../offline/db';
import { syncManager } from '../offline/syncmanager';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export type PaymentMethod = 'CASH' | 'MPESA' | 'DEBT';

export interface CartItem {
  itemId: string; // Ephemeral local UI id
  productId: string;
  name: string;
  barcode: string | null;
  unitOfMeasure: string;
  quantity: string; // Stored as string to preserve NUMERIC(15,3) precision
  unitPrice: string; // Stored as string for NUMERIC(12,2)
  costFloor: string; // Margin guard
  lineDiscount: string; 
  subtotal: string; // Derived: (unitPrice - lineDiscount) * quantity
}

export interface PaymentAllocation {
  allocationId: string;
  method: PaymentMethod;
  amount: string;
}

interface PosState {
  // Session Identity
  tillSessionId: string | null;
  customerId: string | null;
  
  // Manifest Data
  cart: CartItem[];
  allocations: PaymentAllocation[];
  
  // Derived Totals
  grossTotal: string;
  totalAllocated: string;
  balanceDue: string;
  
  // Status Flags
  isCheckingOut: boolean;
  checkoutError: string | null;

  // Actions
  setTillSession: (sessionId: string) => void;
  setCustomer: (customerId: string | null) => void;
  scanProduct: (barcode: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: string) => void;
  applyDiscount: (itemId: string, discountAmount: string) => void;
  addPayment: (method: PaymentMethod, amount: string) => void;
  removePayment: (allocationId: string) => void;
  removeItem: (itemId: string) => void;
  voidCart: () => void;
  executeCheckout: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Precision Math Helpers (Evading floating-point errors)
// ---------------------------------------------------------------------------

const safeAdd = (a: string, b: string): string => (parseFloat(a) + parseFloat(b)).toFixed(2);
const safeSub = (a: string, b: string): string => (parseFloat(a) - parseFloat(b)).toFixed(2);
const safeMult = (qty: string, price: string): string => (parseFloat(qty) * parseFloat(price)).toFixed(2);

const recalculateTotals = (cart: CartItem[], allocations: PaymentAllocation[]) => {
  const grossTotal = cart.reduce((sum, item) => safeAdd(sum, item.subtotal), '0.00');
  const totalAllocated = allocations.reduce((sum, alloc) => safeAdd(sum, alloc.amount), '0.00');
  const balanceDue = safeSub(grossTotal, totalAllocated);

  return { grossTotal, totalAllocated, balanceDue };
};

// ---------------------------------------------------------------------------
// Zustand Store Implementation
// ---------------------------------------------------------------------------

export const usePosStore = create<PosState>((set, get) => ({
  tillSessionId: null,
  customerId: null,
  cart: [],
  allocations: [],
  grossTotal: '0.00',
  totalAllocated: '0.00',
  balanceDue: '0.00',
  isCheckingOut: false,
  checkoutError: null,

  setTillSession: (sessionId: string) => set({ tillSessionId: sessionId }),
  
  setCustomer: (customerId: string | null) => set({ customerId }),

  scanProduct: async (barcode: string) => {
    try {
      // 1. Local Authority Lookup (Zero-latency offline cache)
      const product = await db.products_cache.where('barcode').equals(barcode).first();
      
      if (!product) {
        throw new Error(`Product not found in local cache for barcode: ${barcode}`);
      }

      const { cart } = get();
      const existingItemIndex = cart.findIndex(item => item.productId === product.product_id);

      let newCart = [...cart];

      if (existingItemIndex >= 0) {
        // Increment quantity (handles retail velocity)
        const item = newCart[existingItemIndex];
        const newQty = (parseFloat(item.quantity) + 1).toFixed(3);
        const newSubtotal = safeMult(newQty, safeSub(item.unitPrice, item.lineDiscount));
        
        newCart[existingItemIndex] = { ...item, quantity: newQty, subtotal: newSubtotal };
      } else {
        // Add new line item
        const newItem: CartItem = {
          itemId: uuidv4(),
          productId: product.product_id,
          name: product.name,
          barcode: product.barcode,
          unitOfMeasure: product.unit_of_measure,
          quantity: '1.000',
          unitPrice: product.default_selling_price.toString(),
          costFloor: product.cost_floor.toString(),
          lineDiscount: '0.00',
          subtotal: product.default_selling_price.toString()
        };
        newCart.push(newItem);
      }

      set({ cart: newCart, ...recalculateTotals(newCart, get().allocations), checkoutError: null });
    } catch (error) {
      set({ checkoutError: error instanceof Error ? error.message : 'Unknown scanning error' });
    }
  },

  updateQuantity: (itemId: string, quantity: string) => {
    // Supports up to 3 decimal indices for Butcheries / Agrovets
    const { cart, allocations } = get();
    const newCart = cart.map(item => {
      if (item.itemId === itemId) {
        const subtotal = safeMult(quantity, safeSub(item.unitPrice, item.lineDiscount));
        return { ...item, quantity, subtotal };
      }
      return item;
    });
    set({ cart: newCart, ...recalculateTotals(newCart, allocations) });
  },

  applyDiscount: (itemId: string, discountAmount: string) => {
    const { cart, allocations } = get();
    
    const newCart = cart.map(item => {
      if (item.itemId === itemId) {
        const netUnitPrice = safeSub(item.unitPrice, discountAmount);
        
        // Haggle Margin Validation Guard (Mitumba / Wholesale)
        if (parseFloat(netUnitPrice) < parseFloat(item.costFloor)) {
          console.warn(`Margin Guard: Cannot discount below cost floor of ${item.costFloor}`);
          return item; // Reject discount change
        }

        const subtotal = safeMult(item.quantity, netUnitPrice);
        return { ...item, lineDiscount: discountAmount, subtotal };
      }
      return item;
    });

    set({ cart: newCart, ...recalculateTotals(newCart, allocations) });
  },

  addPayment: (method: PaymentMethod, amount: string) => {
    const { allocations, cart } = get();
    const newAllocations = [...allocations, { allocationId: uuidv4(), method, amount }];
    set({ allocations: newAllocations, ...recalculateTotals(cart, newAllocations) });
  },

  removePayment: (allocationId: string) => {
    const { allocations, cart } = get();
    const newAllocations = allocations.filter(a => a.allocationId !== allocationId);
    set({ allocations: newAllocations, ...recalculateTotals(cart, newAllocations) });
  },

  removeItem: (itemId: string) => {
    const { cart, allocations } = get();
    const newCart = cart.filter(item => item.itemId !== itemId);
    set({ cart: newCart, ...recalculateTotals(newCart, allocations) });
  },

  voidCart: () => {
    set({ cart: [], allocations: [], grossTotal: '0.00', totalAllocated: '0.00', balanceDue: '0.00', checkoutError: null });
  },

  executeCheckout: async () => {
    const state = get();
    
    if (state.cart.length === 0) {
      set({ checkoutError: 'Cannot checkout an empty cart.' });
      return false;
    }

    if (!state.tillSessionId) {
      set({ checkoutError: 'No active till session bound.' });
      return false;
    }

    if (parseFloat(state.balanceDue) > 0) {
      set({ checkoutError: 'Balance due must be 0.00 to finalize.' });
      return false;
    }

    set({ isCheckingOut: true, checkoutError: null });

    try {
      const transactionId = uuidv4();
      const terminalTimestamp = new Date().toISOString();

      // 1. Construct the Checkout Manifest
      const salePayload = {
        transaction_id: transactionId,
        session_id: state.tillSessionId,
        customer_id: state.customerId,
        gross_total: state.grossTotal,
        terminal_timestamp: terminalTimestamp,
        items: state.cart.map(item => ({
          product_id: item.productId,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          line_discount: item.lineDiscount
        })),
        allocations: state.allocations.map(alloc => ({
          payment_method: alloc.method,
          amount: alloc.amount
        }))
      };

      // 2. Local Dexie Commit - The "Walkaway" Protocol Execution
      // We write to the local outbox regardless of network status. 
      // Negative inventory is resolved by the server via attention cards.
      await db.transaction('rw', db.sync_queue, async () => {
        await db.sync_queue.add({
          client_event_id: uuidv4(),
          entity_type: 'SALES_TRANSACTION',
          event_type: 'CHECKOUT_MANIFEST',
          payload: salePayload,
          occurred_at: terminalTimestamp,
          status: 'PENDING'
        });
      });

      // 3. Trigger Background Sync
      // Non-blocking fire-and-forget sync push.
      syncManager.push().catch(err => {
        console.warn('Background sync deferred (Offline Mode Active):', err);
      });

      // 4. Clear UI state for next customer (Zero Attendance overhead)
      get().voidCart();
      set({ isCheckingOut: false });
      
      return true;

    } catch (error) {
      set({ 
        isCheckingOut: false, 
        checkoutError: error instanceof Error ? error.message : 'System failure during checkout commit.' 
      });
      return false;
    }
  }
}));