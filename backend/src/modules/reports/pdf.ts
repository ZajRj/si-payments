import PDFDocument from 'pdfkit';
import { BUSINESS_TIME_ZONE } from '../../lib/dates.js';
import { listSettings } from '../settings/settings.service.js';

// Utilidades comunes de los PDFs. Se usan las fuentes estándar (Helvetica), que incluyen
// los acentos y la ñ, así que no hace falta empaquetar archivos de fuentes.

export type Doc = PDFKit.PDFDocument;

const MARGIN = 50;
const MUTED = '#555555';
const LINE = '#999999';
const WATERMARK_SIZE = 90;

// USD 1.234,56, sin depender del ICU instalado en el servidor.
export function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const integer = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}USD ${integer},${String(abs % 100).padStart(2, '0')}`;
}

// AAAA-MM-DD -> DD/MM/AAAA.
export function dateOnly(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('es-VE', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function dateTime(value: Date | string): string {
  return dateTimeFormat.format(new Date(value));
}

export function documentNumber(id: number): string {
  return String(id).padStart(6, '0');
}

export async function companySettings() {
  const settings = new Map((await listSettings()).map((setting) => [setting.key, setting.value]));
  return {
    name: settings.get('company.name') ?? '',
    taxId: settings.get('company.taxId') ?? '',
    address: settings.get('company.address') ?? '',
    receiptsFooter: settings.get('receipts.footer') ?? '',
  };
}

export type Company = Awaited<ReturnType<typeof companySettings>>;

// Crea el documento, deja que `draw` lo llene y devuelve el PDF completo en memoria.
export function renderPdf(title: string, draw: (doc: Doc) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, bufferPages: true, info: { Title: title, Producer: 'si-payments' } });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      pageNumbers(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function contentWidth(doc: Doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc: Doc) {
  return doc.page.height - doc.page.margins.bottom;
}

// Si lo que sigue no cabe en la página, empieza una nueva.
export function ensureSpace(doc: Doc, height: number) {
  if (doc.y + height > bottomLimit(doc)) doc.addPage();
}

function pageNumbers(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Página ${i + 1} de ${range.count}`, MARGIN, doc.page.height - 35, { width: contentWidth(doc), align: 'right' });
    doc.page.margins.bottom = bottom;
  }
  doc.fillColor('black');
}

// Encabezado con los datos de la empresa a la izquierda y el título del documento a la derecha.
export function header(doc: Doc, company: Company, title: string, subtitle: string[]) {
  const top = doc.y;
  const half = contentWidth(doc) / 2;

  doc.font('Helvetica-Bold').fontSize(13).fillColor('black').text(company.name, MARGIN, top, { width: half });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`RIF: ${company.taxId}`, { width: half }).text(company.address, { width: half });
  const leftBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(13).fillColor('black').text(title, MARGIN + half, top, { width: half, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const line of subtitle) doc.text(line, { width: half, align: 'right' });

  doc.y = Math.max(leftBottom, doc.y) + 10;
  rule(doc);
  doc.fillColor('black');
}

export function rule(doc: Doc) {
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + contentWidth(doc), doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.moveDown(0.6);
}

export function sectionTitle(doc: Doc, text: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor('black').text(text, MARGIN, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.3);
}

// Pares etiqueta: valor en dos columnas.
export function fields(doc: Doc, pairs: [string, string][]) {
  const width = contentWidth(doc);
  const labelWidth = 120;
  for (const [label, value] of pairs) {
    ensureSpace(doc, 16);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(label, MARGIN, y, { width: labelWidth });
    doc.font('Helvetica').fillColor('black').text(value || '—', MARGIN + labelWidth, y, { width: width - labelWidth });
    doc.y = Math.max(doc.y, y + 12) + 2;
  }
}

export function paragraph(doc: Doc, text: string, options: { bold?: boolean; size?: number; color?: string } = {}) {
  ensureSpace(doc, 20);
  doc
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size ?? 9)
    .fillColor(options.color ?? 'black')
    .text(text, MARGIN, doc.y, { width: contentWidth(doc) });
  doc.fillColor('black');
}

export type Column = { header: string; width: number; align?: 'left' | 'right' | 'center' };

// Tabla simple: las anchuras son proporciones del ancho disponible. Repite el encabezado
// en cada página nueva. Las filas marcadas como `bold` se usan para totales.
export function table(doc: Doc, columns: Column[], rows: { cells: string[]; bold?: boolean; muted?: boolean }[]) {
  const totalWeight = columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map((column) => (column.width / totalWeight) * contentWidth(doc));
  const padding = 3;

  const drawRow = (cells: string[], font: string, color: string, fill?: string) => {
    doc.font(font).fontSize(8.5);
    const height = Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i]! - padding * 2 }))) + padding * 2;
    if (doc.y + height > bottomLimit(doc)) {
      doc.addPage();
      drawHeader();
      doc.font(font).fontSize(8.5);
    }
    const y = doc.y;
    if (fill) doc.rect(MARGIN, y, contentWidth(doc), height).fill(fill);
    let x = MARGIN;
    cells.forEach((cell, i) => {
      doc.fillColor(color).text(cell, x + padding, y + padding, { width: widths[i]! - padding * 2, align: columns[i]!.align ?? 'left' });
      x += widths[i]!;
    });
    doc.y = y + height;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + contentWidth(doc), doc.y).lineWidth(0.3).strokeColor(LINE).stroke();
  };

  const drawHeader = () => drawRow(columns.map((column) => column.header), 'Helvetica-Bold', 'black', '#eeeeee');

  ensureSpace(doc, 40);
  drawHeader();
  for (const row of rows) drawRow(row.cells, row.bold ? 'Helvetica-Bold' : 'Helvetica', row.muted ? MUTED : 'black');
  doc.x = MARGIN;
  doc.fillColor('black').moveDown(0.5);
}

// Líneas de firma una al lado de la otra.
export function signatures(doc: Doc, entries: { label: string; name: string; detail?: string }[]) {
  ensureSpace(doc, 90);
  doc.moveDown(3);
  const gap = 30;
  const width = (contentWidth(doc) - gap * (entries.length - 1)) / entries.length;
  const y = doc.y;
  entries.forEach((entry, i) => {
    const x = MARGIN + i * (width + gap);
    doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor('black').stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black').text(entry.label, x, y + 4, { width, align: 'center' });
    doc.font('Helvetica').text(entry.name, { width, align: 'center' });
    if (entry.detail) doc.fillColor(MUTED).text(entry.detail, { width, align: 'center' });
  });
  doc.x = MARGIN;
  doc.fillColor('black').moveDown(1);
}

// Marca de agua diagonal para documentos anulados o que todavía no son definitivos.
export function watermark(doc: Doc, text: string) {
  const maxWidth = doc.page.width * 0.85;
  doc.font('Helvetica-Bold').fontSize(WATERMARK_SIZE);
  const size = Math.min(WATERMARK_SIZE, (WATERMARK_SIZE * maxWidth) / doc.widthOfString(text));

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc
      .font('Helvetica-Bold')
      .fontSize(size)
      .fillColor('#cc0000')
      .fillOpacity(0.12)
      .text(text, 0, doc.page.height / 2 - size / 2, { width: doc.page.width, align: 'center', lineBreak: false });
    doc.restore();
  }
  doc.fillOpacity(1).fillColor('black');
}
