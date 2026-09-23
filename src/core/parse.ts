/**
 * RFC 4180 tokenizer + encoding / EOL / delimiter detection.
 *
 * Fidelity rules this parser obeys, because Starsector's files depend on them:
 *   - every field records the VERBATIM source slice it came from (`raw`), so the
 *     serializer can replay it byte for byte even when the field is malformed
 *     (real files contain improperly escaped quotes)
 *   - every record records its own terminator (`eol`), because real files mix
 *     CRLF and LF row by row
 *   - a field is quoted only if the source quoted it, and `""` decodes to one
 *     literal quote
 *   - newlines inside quotes belong to the field and are kept verbatim
 *   - whitespace is never trimmed (trailing spaces inside quotes are data)
 *   - rows keep their EXACT field count, so short (ragged) rows stay short
 *   - an all-empty line yields a one-field empty row, so blank spacer rows
 *     survive a write-back instead of collapsing
 */
import type { Cell, CsvDocument, Delimiter, Encoding, Eol, Row } from './model.ts';
import { classifyRow } from './model.ts';
import { decodeBytes } from './bytes.ts';

export interface RawCell {
  value: string;
  quoted: boolean;
  /** Verbatim source slice, quotes included. */
  raw: string;
}

export interface RawRow {
  cells: RawCell[];
  /** Physical line in the source file where the record starts (1-based). */
  line: number;
  /** The terminator that followed this record, or null at EOF without one. */
  eol: Eol | null;
}

export interface TokenizeResult {
  rows: RawRow[];
  warnings: string[];
  terminators: { crlf: number; lf: number; cr: number };
}

/** Split text into records and fields. Quote-aware; never trims. */
export function tokenizeRecords(text: string, delimiter: Delimiter): TokenizeResult {
  const rows: RawRow[] = [];
  const warnings: string[] = [];
  const terminators = { crlf: 0, lf: 0, cr: 0 };

  let cells: RawCell[] = [];
  let value = '';
  let quoted = false;
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let fieldStart = 0;
  let i = 0;

  const pushCell = (end: number): void => {
    cells.push({ value, quoted, raw: text.slice(fieldStart, end) });
    value = '';
    quoted = false;
  };

  const pushRow = (end: number, terminator: Eol | null): void => {
    pushCell(end);
    rows.push({ cells, line: rowLine, eol: terminator });
    cells = [];
    // `line` has already advanced past the terminator we just consumed.
    rowLine = line;
    fieldStart = terminator === null ? end : end + terminator.length;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
        continue;
      }
      if (ch === '\n') line += 1;
      else if (ch === '\r' && text[i + 1] !== '\n') line += 1;
      value += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && value.length === 0 && !quoted) {
      inQuotes = true;
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushCell(i);
      i += 1;
      fieldStart = i;
      continue;
    }
    if (ch === '\r') {
      const isCrlf = text[i + 1] === '\n';
      const terminator: Eol = isCrlf ? '\r\n' : '\r';
      if (isCrlf) terminators.crlf += 1;
      else terminators.cr += 1;
      line += 1;
      pushRow(i, terminator);
      i += isCrlf ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      terminators.lf += 1;
      line += 1;
      pushRow(i, '\n');
      i += 1;
      continue;
    }

    value += ch;
    i += 1;
  }

  if (inQuotes) warnings.push('文件结尾处有未闭合的引号，最后一条记录可能被吞并');

  // A pending field means the file did not end with a terminator.
  if (value.length > 0 || quoted || cells.length > 0) pushRow(text.length, null);

  return { rows, warnings, terminators };
}

export interface EolVerdict {
  eol: Eol;
  mixed: boolean;
  counts: { crlf: number; lf: number; cr: number };
}

export function detectEol(text: string): EolVerdict {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        crlf += 1;
        i += 1;
      } else {
        cr += 1;
      }
    } else if (ch === '\n') {
      lf += 1;
    }
  }
  const counts = { crlf, lf, cr };
  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  const eol: Eol = crlf >= lf && crlf >= cr ? '\r\n' : lf >= cr ? '\n' : '\r';
  return { eol, mixed: kinds > 1, counts };
}

export interface DelimiterVerdict {
  delimiter: Delimiter;
  /** Fields the first record splits into. */
  columns: number;
  /** Fraction of sampled records that split into more than one field. */
  multiFieldRatio: number;
  records: number;
  score: number;
  consistent: boolean;
  recommended: boolean;
  /** Language-neutral verdict; the UI layer renders it with i18n. */
  noteKey: 'ok' | 'noHit' | 'few';
  /** The fraction the note refers to (0..1). */
  noteRatio: number;
}

const DEFAULT_CANDIDATES: readonly Delimiter[] = [',', ';', '\t', '|'];
const DETECTION_SAMPLE_BYTES = 200_000;

/**
 * Score each candidate delimiter on a prefix of the file.
 *
 * Naive "do all lines have the same comma count" scoring breaks on real CSV:
 * quoted fields contain delimiters, and Starsector rows are ragged. So we score
 * quote-aware instead: a delimiter is good when it actually separates fields in
 * most records AND splits the header into the most columns.
 */
export function detectDelimiter(
  text: string,
  candidates: readonly Delimiter[] = DEFAULT_CANDIDATES,
): DelimiterVerdict[] {
  const sample = text.length > DETECTION_SAMPLE_BYTES ? text.slice(0, DETECTION_SAMPLE_BYTES) : text;

  const verdicts = candidates.map((delimiter) => {
    const { rows } = tokenizeRecords(sample, delimiter);
    const records = rows.length;
    let multiField = 0;
    for (const row of rows) {
      if (row.cells.length > 1) multiField += 1;
    }
    const multiFieldRatio = records > 0 ? multiField / records : 0;
    const columns = records > 0 ? rows[0].cells.length : 1;
    const score = multiFieldRatio * 100 + (columns >= 2 ? Math.min(columns, 40) : 0);
    const consistent = multiFieldRatio >= 0.85 && columns >= 2;

    const noteKey: DelimiterVerdict['noteKey'] =
      columns < 2 ? 'noHit' : consistent ? 'ok' : 'few';

    return {
      delimiter,
      columns,
      multiFieldRatio,
      records,
      score,
      consistent,
      recommended: false,
      noteKey,
      noteRatio: multiFieldRatio,
    };
  });

  const ranked = verdicts
    .map((verdict, index) => ({ verdict, index }))
    .sort((a, b) => b.verdict.score - a.verdict.score || a.index - b.index)
    .map((entry) => entry.verdict);

  if (ranked.length > 0) ranked[0].recommended = true;
  return ranked;
}

export interface ParseOptions {
  delimiter?: Delimiter;
  encoding?: Encoding;
}

export interface ParseStats {
  records: number;
  columns: number;
  embeddedNewlines: number;
  quotedCells: number;
  commentRows: number;
  blankRows: number;
  raggedRows: number;
}

export interface ParsedCsv {
  doc: CsvDocument;
  /** The decoded text this came from, so a caller can re-parse it (e.g. with a different delimiter) without reading the file again. */
  text: string;
  warnings: string[];
  stats: ParseStats;
}

function countBreaks(value: string): number {
  let breaks = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\r') {
      if (value[i + 1] === '\n') i += 1;
      breaks += 1;
    } else if (ch === '\n') {
      breaks += 1;
    }
  }
  return breaks;
}

export function parseCsvText(text: string, fileName: string, options: ParseOptions = {}): ParsedCsv {
  const delimiter = options.delimiter ?? detectDelimiter(text)[0].delimiter;
  const encoding = options.encoding ?? 'utf-8';
  const eolVerdict = detectEol(text);
  const tokenized = tokenizeRecords(text, delimiter);

  const warnings = [...tokenized.warnings];
  if (eolVerdict.mixed) {
    const { crlf, lf, cr } = eolVerdict.counts;
    warnings.push(
      `文件混用了换行风格（CRLF ${crlf} / LF ${lf} / CR ${cr}）；已有记录各自保留原样，` +
        `新增行使用主导风格`,
    );
  }

  const rows: Row[] = tokenized.rows.map((raw, index) => {
    const cells: Cell[] = raw.cells.map((cell) => ({
      value: cell.value,
      quoted: cell.quoted,
      dirty: false,
      raw: cell.raw,
    }));
    return {
      kind: classifyRow(cells, index === 0),
      cells,
      origFieldCount: cells.length,
      dirty: false,
      sourceLine: raw.line,
      eol: raw.eol,
    };
  });

  let columns = 0;
  let embeddedNewlines = 0;
  let quotedCells = 0;
  let commentRows = 0;
  let blankRows = 0;
  let raggedRows = 0;

  for (const row of rows) {
    if (row.cells.length > columns) columns = row.cells.length;
  }
  for (const row of rows) {
    if (row.cells.length !== columns) raggedRows += 1;
    if (row.kind === 'comment') commentRows += 1;
    if (row.kind === 'blank') blankRows += 1;
    for (const cell of row.cells) {
      if (cell.quoted) quotedCells += 1;
      embeddedNewlines += countBreaks(cell.value);
    }
  }

  const doc: CsvDocument = {
    fileName,
    filePath: null,
    delimiter,
    encoding,
    eol: eolVerdict.eol,
    trailingEol: text.length > 0 && text.endsWith(eolVerdict.eol),
    rows,
  };

  return {
    doc,
    text,
    warnings,
    stats: {
      records: rows.length,
      columns,
      embeddedNewlines,
      quotedCells,
      commentRows,
      blankRows,
      raggedRows,
    },
  };
}

export function parseCsvBytes(bytes: Uint8Array, fileName: string): ParsedCsv {
  const decoded = decodeBytes(bytes);
  const parsed = parseCsvText(decoded.text, fileName, { encoding: decoded.encoding });
  if (!decoded.validUtf8 && decoded.encoding === 'utf-8') {
    parsed.warnings.push('文件不是合法 UTF-8，可能使用了其他编码；写回可能无法保持逐字节一致');
  }
  return parsed;
}
