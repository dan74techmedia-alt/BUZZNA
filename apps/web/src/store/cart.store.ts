// apps/web/src/store/cart.store.ts
import { create } from 'zustand';

// Product type derived from 0004_product_categories_products.sql schema
export interface PosProduct {
  product_id: string;
  name: string;
  barcode: string | null;
  default_selling_price: number; // Parsed from NUMERIC(12,2)
  cost_floor: number;
  current_quantity: number; // Cached projection only
}

export interface CartItem extends PosProduct {
  cart_item_id: string; // unique local uuid for tracking
  quantity: number;
  line_discount: number;
  final_unit_price: number;
}

interface CartState {
  items: CartItem[];
  paymentMethod: 'CASH' | 'MPESA' | 'DEBT' | null;
  
  addItem: (product: PosProduct, quantity?: number) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  applyDiscount: (cartItemId: string, discountAmount: number) => void;
  setPaymentMethod: (method: 'CASH' | 'MPESA' | 'DEBT') => void;
  clearCart: () => void;
  
  // Computed (Safe Decimal Helpers)
  getGrossTotal: () => number;
  getTotalItems: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  paymentMethod: null,

  addItem: (product, quantity = 1) => set((state) => {
    // Architecture Target: High-velocity barcode matching groups identical items
    const existingIndex = state.items.findIndex(i => i.product_id === product.product_id && i.final_unit_price === product.default_selling_price);
    
    if (existingIndex >= 0) {
      const newItems = [...state.items];
      newItems[existingIndex].quantity += quantity;
      return { items: newItems };
    }

    const newItem: CartItem = {
      ...product,
      cart_item_id: crypto.randomUUID(),
      quantity,
      line_discount: 0,
      final_unit_price: product.default_selling_price
    };
    return { items: [...state.items, newItem] };
  }),

  removeItem: (cartItemId) => set((state) => ({
    items: state.items.filter(i => i.cart_item_id !== cartItemId)
  })),

  updateQuantity: (cartItemId, quantity) => set((state) => ({
    items: state.items.map(i => i.cart_item_id === cartItemId ? { ...i, quantity: Math.max(0.001, quantity) } : i) // Supports fractional butcheries
  })),

  applyDiscount: (cartItemId, discountAmount) => set((state) => ({
    items: state.items.map(item => {
      if (item.cart_item_id === cartItemId) {
        const newUnitPrice = item.default_selling_price - discountAmount;
        // Business Rule: Margin validation guards (Haggle guards)
        if (newUnitPrice < item.cost_floor) {
          console.warn('Margin Guard Blocked: Discount violates cost_floor boundary.');
          return item; // Reject update
        }
        return { ...item, line_discount: discountAmount, final_unit_price: newUnitPrice };
      }
      return item;
    })
  })),

  setPaymentMethod: (method) => set({ paymentMethod: method }),

  clearCart: () => set({ items: [], paymentMethod: null }),

  getGrossTotal: () => {
    const total = get().items.reduce((sum, item) => sum + (item.final_unit_price * item.quantity), 0);
    // Strict Decimal Integrity Rule (NUMERIC 12,2 equivalent)
    return parseFloat(total.toFixed(2));
  },

  getTotalItems: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  }
}));