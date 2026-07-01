// apps/api/src/modules/reports/csv.service.ts

import { logger } from '../../common/logging/logger';

/**
 * CSV Export Service
 *
 * Generates financial reports in CSV format
 * Handles proper escaping and NUMERIC precision
 */

export interface CSVExportOptions {
  headers: string[];
  data: Record<string, any>[];
  delimiter?: string;
  includeBOM?: boolean;
}

/**
 * Escape CSV field value
 */
function escapeCSVField(value: any): string {
  if (value === null || value === undefined) return '';

  const stringValue = String(value);

  // If contains delimiter, quotes, or newlines, wrap in quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Generate CSV from data
 */
export function generateCSV(options: CSVExportOptions): string {
  try {
    const { headers, data, delimiter = ',', includeBOM = false } = options;

    const rows: string[] = [];

    // Add BOM for Excel compatibility
    if (includeBOM) {
      rows.push('\ufeff');
    }

    // Header row
    rows.push(headers.map(escapeCSVField).join(delimiter));

    // Data rows
    for (const row of data) {
      const values = headers.map((header) =>
        escapeCSVField(row[header])
      );
      rows.push(values.join(delimiter));
    }

    return rows.join('\n');
  } catch (error) {
    logger.error('Failed to generate CSV', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Convert to CSV buffer
 */
export function toBuffer(csv: string, encoding: BufferEncoding = 'utf-8'): Buffer {
  return Buffer.from(csv, encoding);
}

export const csvService = {
  generateCSV,
  toBuffer,
};

export default csvService;