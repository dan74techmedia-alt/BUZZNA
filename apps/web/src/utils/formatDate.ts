import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { enGB } from 'date-fns/locale';

/**
 * Standardized date formatting utility for BuzzNa D74.
 * Uses date-fns for locale-aware and robust parsing.
 */

export const formatDate = (date: string | Date, formatStr: string = 'dd/MM/yyyy HH:mm'): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatStr, { locale: enGB });
};

/**
 * Provides human-readable relative time (e.g., "5 minutes ago").
 * Useful for sync status updates and audit trails.
 */
export const formatRelativeTime = (date: string | Date): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(dateObj, { addSuffix: true, locale: enGB });
};