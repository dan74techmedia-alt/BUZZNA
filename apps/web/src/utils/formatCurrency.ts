/**
 * Formats numeric values into consistent currency strings.
 * Defaulting to KSH (Kenyan Shilling) as the primary business locale.
 * * @param amount - The numeric value to format
 * @param currencyCode - Optional ISO currency code (default: 'KES')
 * @returns Formatted currency string
 */
export const formatCurrency = (
  amount: number | string, 
  currencyCode: string = 'KES'
): string => {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  // Ensure consistent 2-decimal point precision for financial records
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
};