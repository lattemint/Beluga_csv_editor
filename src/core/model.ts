/**
 * Core data model for the CSV editor.
 *
 * Design notes (why it looks like this):
 *  - Fidelity first. Starsector CSVs are byte-sensitive: rows are ragged, fields
 *    may be quoted even when quoting is not strictly required, whitespace inside
 *    quotes is data, some files mix line-ending styles per row, and some real
 *    files even contain improperly escaped quotes.
 *  - So a cell remembers the VERBATIM source text of its field (`raw`) and a row
 *    remembers the exact terminator that followed it (`eol`). As long as nothing
 *    was edited, the serializer replays those bytes. Round-trip fidelity is then
 *    structural — it cannot be broken by an unusual field we failed to predict.
 *  - Editing a cell clears `raw`, and from then on the canonical quoting rules
 *    apply to that cell only.
 */

/** Delimiters we can auto-detect or that the user can force. */
export type Delimiter = ',' | ';' | '\t' | '|';

/** Text encodings we can preserve on write-back. */
export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';

/** Line ending styles we can preserve on write-back. */
export type Eol = '\r\n' | '\n' | '\r';

/**
 * Row classification.
 *  - header : first row, used as column titles
 *  - data   : regular row
 *  - comment: Starsector section marker, first field starts with '#'
 *  - blank  : every field empty (used as a visual spacer in mod CSVs)
 */
export type RowKind = 'header' | 'data' | 'comment' | 'blank';

export interface Cell {
  /** Decoded value: quotes removed, `""` turned back into one quote. */
  value: string;
  /** Whether the source file wrapped this field in double quotes. */
  quoted: boolean;
  /** Edited since load / last save. */
  dirty: boolean;
  /**
   * Verbatim source text of the field, surrounding quotes included, or null for
   * a cell that was created or edited in memory.
   */
  raw: string | null;
}

export interface Row {
  kind: RowKind;
  cells: Cell[];
  /** Field count as found in the source file. Never invent trailing fields. */
  origFieldCount: number;
  dirty: boolean;
  /** 1-based line number in the source file, for diagnostics. */
  sourceLine: number;
  /**
   * The exact terminator that followed this record in the source file, or null
   * when the file ended without one / the row was created in the editor.
   * Per row, because real files mix styles.
   */
  eol: Eol | null;
}

export interface CsvDocument {
  /** Display name (basename) of the file. */
  fileName: string;
  /** Absolute path when known (File System Access handles / server mode). */
  filePath: string | null;
  delimiter: Delimiter;
  encoding: Encoding;
  /** Dominant line ending; used for rows that have no terminator of their own. */
  eol: Eol;
  /** True when the file ended with a line terminator. */
  trailingEol: boolean;
  rows: Row[];
}

export interface DelimiterChoice {
  value: Delimiter;
  label: string;
  /** Human-readable glyph for the toolbar, e.g. "," or "Tab". */
  glyph: string;
}

export const DELIMITERS: readonly DelimiterChoice[] = [
  { value: ',', label: '逗号 comma', glyph: ',' },
  { value: ';', label: '分号 semicolon', glyph: ';' },
  { value: '\t', label: '制表符 tab', glyph: 'Tab' },
  { value: '|', label: '竖线 pipe', glyph: '|' },
];

export function delimiterGlyph(d: Delimiter): string {
  const found = DELIMITERS.find((item) => item.value === d);
  return found ? found.glyph : d;
}

export function encodingLabel(e: Encoding): string {
  switch (e) {
    case 'utf-8':
      return 'UTF-8';
    case 'utf-8-bom':
      return 'UTF-8 (BOM)';
    case 'utf-16le':
      return 'UTF-16 LE';
    case 'utf-16be':
      return 'UTF-16 BE';
    default:
      return e;
  }
}

export function eolLabel(e: Eol): string {
  switch (e) {
    case '\r\n':
      return 'CRLF';
    case '\n':
      return 'LF';
    case '\r':
      return 'CR';
    default:
      return e;
  }
}

/** A field needs quoting when it contains the delimiter, a quote, or a newline. */
export function needsQuoting(value: string, delimiter: Delimiter): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  );
}

/** True when every field of the row is empty. */
export function isBlankRow(cells: readonly Cell[]): boolean {
  return cells.every((cell) => cell.value.trim() === '');
}

/** Classify a row the way Starsector's CSVs are written in practice. */
export function classifyRow(cells: readonly Cell[], isFirst: boolean): RowKind {
  if (isFirst) return 'header';
  if (cells.length > 0 && cells[0].value.trimStart().startsWith('#')) return 'comment';
  if (isBlankRow(cells)) return 'blank';
  return 'data';
}

export function makeCell(value: string, delimiter: Delimiter, quoted?: boolean): Cell {
  return {
    value,
    quoted: quoted === undefined ? needsQuoting(value, delimiter) : quoted,
    dirty: false,
    raw: null,
  };
}

export function makeRow(
  values: readonly string[],
  delimiter: Delimiter,
  sourceLine: number,
  isFirst: boolean,
): Row {
  const cells = values.map((value) => makeCell(value, delimiter));
  return {
    kind: classifyRow(cells, isFirst),
    cells,
    origFieldCount: values.length,
    dirty: false,
    sourceLine,
    eol: null,
  };
}

/**
 * Change a cell's value the canonical way: recompute quoting and drop the
 * verbatim source form, so the serializer will re-emit this field from scratch.
 * Callers that must preserve byte fidelity use the cell's `raw` untouched.
 */
export function setCellValue(cell: Cell, value: string, delimiter: Delimiter): void {
  cell.value = value;
  cell.quoted = needsQuoting(value, delimiter);
  cell.raw = null;
  cell.dirty = true;
}

/**
 * Forget every verbatim source form.
 *
 * `raw` is tied to the delimiter and encoding the file was parsed with. If the
 * document is ever reinterpreted with a different delimiter without re-parsing,
 * call this so the fields get re-serialized canonically instead of replaying
 * slices that no longer mean what they meant.
 */
export function clearRawForms(doc: CsvDocument): void {
  for (const row of doc.rows) {
    for (const cell of row.cells) cell.raw = null;
  }
}

/** Widest row decides how many columns the grid shows. */
export function columnCount(doc: CsvDocument): number {
  let max = 0;
  for (const row of doc.rows) {
    if (row.cells.length > max) max = row.cells.length;
  }
  return max;
}

/**
 * Column titles from the header row. Empty slots come back as '' and callers
 * fill them with a localized placeholder.
 */
export function columnNames(doc: CsvDocument): string[] {
  const count = columnCount(doc);
  const header = doc.rows.length > 0 && doc.rows[0].kind === 'header' ? doc.rows[0] : null;
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    names.push(header && header.cells[i] ? header.cells[i].value.trim() : '');
  }
  return names;
}

export function countDirty(doc: CsvDocument): number {
  let dirty = 0;
  for (const row of doc.rows) {
    for (const cell of row.cells) {
      if (cell.dirty) dirty += 1;
    }
  }
  return dirty;
}
