import { Generated } from 'kysely';

export interface DatabaseSchema {
  businesses: BusinessTable;
  inventory_events: InventoryEventTable;
  products: ProductTable;
  sales: SaleTable;
}

export interface BusinessTable {
  tenant_id: Generated<string>;
  legal_name: string;
  trade_name: string | null;
  onboarding_segment: string;
  license_status: 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED' | 'PAYMENT_DUE' | 'GRACE_PERIOD' | 'ACTIVE_MONTHLY' | 'SUSPENDED_NON_PAYMENT' | 'FULLY_ACTIVATED' | 'CANCELLED' | 'MANUALLY_DISABLED';
  license_expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProductTable {
  product_id: Generated<string>;
  tenant_id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  current_quantity: string; // Mapped from numeric(15,3)
  unit_of_measure: string;
  cost_floor: string;       // Mapped from numeric(15,2)
  default_selling_price: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryEventTable {
  event_id: Generated<string>;
  tenant_id: string;
  product_id: string;
  event_type: string;
  reason_code: string | null;
  quantity_delta: string; // Mapped from numeric(15,3)
  unit_buying_price: string | null;
  unit_selling_price: string | null;
  actor_user_id: string | null;
  timestamp: Generated<Date>;
}
