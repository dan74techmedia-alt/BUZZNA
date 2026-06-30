// ============================================================================
// BUZZNA D74 SHARED UTILITIES
// Decimal Integrity Engine & String Manipulation
// ============================================================================

/**
 * Safely scales a numeric string into an exact integer based on the required precision.
 * Bypasses JS floating point logic completely using strict string parsing.
 * * @param val - The decimal string (e.g., "150.50")
 * @param scale - 2 for Currency (NUMERIC(12,2)), 3 for Inventory (NUMERIC(15,3))
 * @returns An exact integer (e.g., 15050)
 */
export const parseDecimalToScaledInteger = (val: string, scale: number): number => {
  if (!val || val.trim() === '') return 0;
  
  const isNegative = val.startsWith('-');
  const cleanVal = isNegative ? val.substring(1) : val;
  const [integerPart = '0', decimalPart = ''] = cleanVal.split('.');
  
  const paddedDecimal = decimalPart.padEnd(scale, '0').slice(0, scale);
  const combined = `${integerPart}${paddedDecimal}`;
  
  return (isNegative ? -1 : 1) * parseInt(combined, 10);
};

/** 
 * Restores a scaled integer back into a safe database-ready decimal string.
 * * @param val - The scaled integer (e.g., 15050)
 * @param scale - 2 for Currency, 3 for Inventory
 * @returns A safe decimal string (e.g., "150.50")
 */
export const formatScaledIntegerToDecimal = (val: number, scale: number): string => {
  if (isNaN(val)) return `0.${'0'.repeat(scale)}`;

  const isNegative = val < 0;
  const absValStr = Math.abs(val).toString().padStart(scale + 1, '0');
  
  const integerPart = absValStr.slice(0, -scale) || '0';
  const decimalPart = absValStr.slice(-scale);
  
  return `${isNegative ? '-' : ''}${integerPart}.${decimalPart}`;
};

/**
 * Performs exact addition on two string decimals, returning a string decimal.
 */
export const addDecimals = (a: string, b: string, scale: number = 2): string => {
  const intA = parseDecimalToScaledInteger(a, scale);
  const intB = parseDecimalToScaledInteger(b, scale);
  return formatScaledIntegerToDecimal(intA + intB, scale);
};

/**
 * Performs exact subtraction on two string decimals, returning a string decimal.
 */
export const subtractDecimals = (a: string, b: string, scale: number = 2): string => {
  const intA = parseDecimalToScaledInteger(a, scale);
  const intB = parseDecimalToScaledInteger(b, scale);
  return formatScaledIntegerToDecimal(intA - intB, scale);
};