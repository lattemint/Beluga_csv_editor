/**
 * Byte-faithful serializer.
 *
 * Two mechanisms, in priority order:
 *
 *  1. Replay. A cell that still carries its verbatim source `raw` is written
 *     back exactly as found, and a row that still carries its own `eol` keeps
 *     that terminator. This makes round-trip fidelity structural: odd-but-real
 *     files (improperly escaped quotes, mixed CRLF/LF per row) survive even
 *     though no canonical rule could have reproduced them.
 *  2. Canonical form. A cell created or edited in memory has `raw === null` and
 *     is emitted with standard RFC 4180 quoting; a row without its own `eol`
 *     falls back to the document's dominant style.
 *
 * Nothing is ever trimmed, and rows are never padded to a common width.
 */
import type { Cell, CsvDocument, Delimiter } from './model.ts';
import { needsQuoting } from './model.ts';
import { encodeBytes } from './bytes.ts';

export function serializeCell(cell: Cell, delimiter: Delimiter): string {
  // Untouched field: replay the exact source bytes.
  if (cell.raw !== null) return cell.raw;

  // Edited or created field: emit canonical RFC 4180 form. `needsQuoting` is
  // checked here rather than trusting the caller's `quoted` flag, so a value
  // that gained a delimiter/newline can never be written out unquoted.
  if (cell.quoted || needsQuoting(cell.value, delimiter)) {
    return `"${cell.value.replace(/"/g, '""')}"`;
  }
  return cell.value;
}

export function serializeRow(cells: readonly Cell[], delimiter: Delimiter): string {
  return cells.map((cell) => serializeCell(cell, delimiter)).join(delimiter);
}

/** Terminator to emit after the row at `index`. */
export function terminatorFor(doc: CsvDocument, index: number): string {
  const row = doc.rows[index];
  if (row.eol !== null) return row.eol;
  const isLast = index === doc.rows.length - 1;
  if (!isLast) return doc.eol;
  return doc.trailingEol ? doc.eol : '';
}

export function serializeCsv(doc: CsvDocument): string {
  if (doc.rows.length === 0) return '';
  const parts: string[] = [];
  for (let index = 0; index < doc.rows.length; index += 1) {
    parts.push(serializeRow(doc.rows[index].cells, doc.delimiter));
    parts.push(terminatorFor(doc, index));
  }
  return parts.join('');
}

export function serializeCsvBytes(doc: CsvDocument): Uint8Array {
  return encodeBytes(serializeCsv(doc), doc.encoding);
}
