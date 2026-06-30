// File: apps/api/src/modules/inventory/inventory.schema.ts
// Purpose: Defines event types and validation for stock adjustments.

export enum InventoryEventType {
    RESTOCK = 'RESTOCK',
    SALE = 'SALE',
    RETURN = 'RETURN',
    ADJUSTMENT = 'ADJUSTMENT',
    STOCK_TAKE = 'STOCK_TAKE'
}

export interface IInventoryEventInput {
    product_id: string;
    event_type: InventoryEventType;
    quantity_delta: string; // Using string to maintain precision for NUMERIC(15,3)
    reason?: string;
}