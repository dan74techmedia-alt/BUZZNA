import { APP_CONSTANTS } from './constants';

/**
 * Business Rule Validators
 * Prevents invalid data states from entering the local cache.
 */

export const validators = {
  isValidPhone: (phone: string): boolean => {
    return APP_CONSTANTS.PHONE_REGEX.test(phone);
  },

  isPriceValid: (price: number): boolean => {
    return price >= 0;
  },

  // Ensures inventory adjustments don't violate business rules
  isQuantityAdjustmentValid: (current: number, adjustment: number): boolean => {
    return (current + adjustment) >= 0;
  },

  // Validates product SKU/Barcode constraints
  isValidBarcode: (barcode: string): boolean => {
    return barcode.length >= 8 && barcode.length <= 13;
  }
};