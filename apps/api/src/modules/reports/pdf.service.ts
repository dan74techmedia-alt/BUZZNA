// apps/api/src/modules/reports/pdf.service.ts

import { logger } from '../../common/logging/logger';
import PDFDocument from 'pdfkit';
import { Writable } from 'stream';

/**
 * PDF Report Service
 *
 * Generates financial reports in PDF format
 * Uses pdfkit for low-footprint PDF generation
 */

export interface PDFReportOptions {
  title: string;
  subtitle?: string;
  data: Record<string, any>[];
  columns: {
    key: string;
    label: string;
    format?: 'currency' | 'number' | 'date' | 'text';
    width?: number;
  }[];
  totals?: Record<string, number>;
  generatedAt: Date;
  generatedBy: string;
}

/**
 * Format value based on type
 */
function formatValue(
  value: any,
  format?: string
): string {
  if (value === null || value === undefined) return '';

  switch (format) {
    case 'currency':
      return `KES ${parseFloat(value).toFixed(2)}`;
    case 'number':
      return parseFloat(value).toFixed(2);
    case 'date':
      return new Date(value).toLocaleDateString();
    default:
      return String(value);
  }
}

/**
 * Generate PDF report
 */
export async function generatePdfReport(
  options: PDFReportOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      const doc = new PDFDocument();

      // Pipe to buffer
      doc.pipe(stream);

      // Title
      doc.fontSize(20).font('Helvetica-Bold').text(options.title, { align: 'center' });

      if (options.subtitle) {
        doc.fontSize(12).text(options.subtitle, { align: 'center' });
      }

      // Metadata
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Generated: ${options.generatedAt.toLocaleDateString()}`, { align: 'right' })
        .text(`By: ${options.generatedBy}`, { align: 'right' });

      doc.moveDown();

      // Table header
      const tableTop = doc.y;
      const rowHeight = 25;
      const pageWidth = doc.page.width;
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;

      let y = tableTop;

      // Header row
      doc.fontSize(11).font('Helvetica-Bold');

      let x = margin;
      for (const column of options.columns) {
        const colWidth = column.width || contentWidth / options.columns.length;
        doc.text(column.label, x, y, {
          width: colWidth,
          height: rowHeight,
          align: 'left',
        });
        x += colWidth;
      }

      y += rowHeight;

      // Draw line under header
      doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke();
      y += 5;

      // Data rows
      doc.fontSize(10).font('Helvetica');

      for (const row of options.data) {
        // Check if we need a new page
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }

        x = margin;
        for (const column of options.columns) {
          const colWidth = column.width || contentWidth / options.columns.length;
          const value = formatValue(row[column.key], column.format);
          doc.text(value, x, y, {
            width: colWidth,
            height: rowHeight,
            align: column.format === 'currency' ? 'right' : 'left',
          });
          x += colWidth;
        }

        y += rowHeight;
      }

      // Totals section
      if (options.totals && Object.keys(options.totals).length > 0) {
        y += 20;

        doc.font('Helvetica-Bold').fontSize(11);

        for (const [label, value] of Object.entries(options.totals)) {
          doc.text(`${label}: KES ${parseFloat(value as any).toFixed(2)}`, margin, y);
          y += rowHeight;
        }
      }

      // End PDF
      doc.end();

      // When done, resolve with buffer
      stream.on('finish', () => {
        resolve(Buffer.concat(chunks));
      });

      stream.on('error', reject);
      doc.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

export const pdfService = {
  generatePdfReport,
};

export default pdfService;