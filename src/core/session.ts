/**
 * One open CSV file, plus every piece of state that belongs to it.
 *
 * Before multi-tab, App owned a single document and all of this state directly.
 * Splitting it out is what makes several files open at once possible without the
 * tabs trampling each other: selection, search, undo history, the byte-fidelity
 * baseline and the file handles are all per file.
 *
 * Global (deliberately NOT here): theme, the .bak preference, the granted source
 * directory — those are user preferences, not per-file state.
 */
import type { CsvDocument } from './model.ts';
import { columnCount } from './model.ts';

/** Untouched state of a cell, so undo can restore its verbatim source form. */
export interface CellSnapshot {
  value: string;
  quoted: boolean;
  raw: string | null;
}

export interface EditRecord {
  row: number;
  col: number;
  before: string;
  after: string;
}

export class DocumentSession {
  readonly id: number;

  doc: CsvDocument;

  /** Write-back target; null for the built-in sample document. */
  fileHandle: FileSystemFileHandle | null = null;
  /** Where the .bak goes — asked once per file, then reused silently. */
  backupHandle: FileSystemFileHandle | null = null;
  /** Decoded text of the opened file, kept so a delimiter change can re-parse. */
  loadedText: string | null = null;

  /**
   * On-disk identity as loaded. The File System Access API exposes no path, so
   * these two are the only real signals to tell same-named files apart.
   * Deliberately NOT refreshed on save, so tab labels stay stable.
   */
  mtime: number | null = null;
  size: number | null = null;

  /**
   * Size/mtime of what we believe is on disk right now. Used to notice that the
   * file was changed by something other than this tab, before we overwrite it.
   */
  diskSize: number | null = null;
  diskMtime: number | null = null;

  /** Relative path — only known after the user grants a source directory. */
  sourcePath: string | null = null;

  /** User-given tab name; overrides every automatic disambiguator. */
  alias: string | null = null;

  /** Stable colour-dot index, shown only when basenames collide. */
  accentIndex: number;

  baseline = new Map<string, CellSnapshot>();
  undoStack: EditRecord[] = [];
  redoStack: EditRecord[] = [];

  selectedRow = 0;
  selectedCol = 0;
  editorRow = 0;
  editorCol = 0;

  searchValue = '';
  filterValue = 'all';

  scrollTop = 0;
  scrollLeft = 0;

  constructor(id: number, doc: CsvDocument, accentIndex: number) {
    this.id = id;
    this.doc = doc;
    this.accentIndex = accentIndex;
  }

  get dirtyCount(): number {
    let count = 0;
    for (const row of this.doc.rows) {
      for (const cell of row.cells) {
        if (cell.dirty) count += 1;
      }
    }
    return count;
  }

  /** Clear the dirty bookkeeping once the bytes on disk match the document. */
  markSaved(): void {
    for (const row of this.doc.rows) {
      row.dirty = false;
      for (const cell of row.cells) cell.dirty = false;
    }
    // A fresh baseline makes the next edit snapshot what is now on disk, so
    // undoing that edit restores exactly the bytes that were written.
    this.baseline.clear();
  }

  resetHistory(): void {
    this.baseline.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** True when this session holds the built-in sample rather than a real file. */
  get isSample(): boolean {
    return this.loadedText === null;
  }

  get canWriteInPlace(): boolean {
    return this.fileHandle !== null;
  }
}

// ------------------------------------------------------------ tab labelling

export interface TabLabel {
  /** What the tab shows. */
  text: string;
  /** One-line summary for the tooltip. */
  detail: string;
  /** True when another open tab shares this file's basename. */
  collides: boolean;
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function marker(n: number): string {
  return n <= CIRCLED.length ? CIRCLED[n - 1] : `(${n})`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatStamp(mtime: number | null): string {
  if (mtime === null) return '';
  const date = new Date(mtime);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatSize(size: number | null): string {
  if (size === null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** Last two path segments, e.g. "procgen/rules.csv". */
export function shortPath(path: string | null): string {
  if (path === null) return '';
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts.slice(-2).join('/');
}

/** Language-dependent bits of the tab detail line, injected by the UI layer. */
export interface TabStrings {
  sample: string;
  readOnly: string;
  rows: (rows: number, cols: number) => string;
}

const DEFAULT_TAB_STRINGS: TabStrings = {
  sample: '示例数据',
  readOnly: '只读',
  rows: (rows, cols) => `${rows} 行 × ${cols} 列`,
};

/**
 * Work out what each tab should say.
 *
 * Only colliding tabs get a disambiguator, so the common case stays a plain file
 * name. When a source directory has been granted and every colliding tab has a
 * relative path, the path wins; otherwise we fall back to on-disk metadata
 * (mtime + size), and finally to a circled index if even that is identical.
 */
export function computeTabLabels(
  sessions: readonly DocumentSession[],
  strings: TabStrings = DEFAULT_TAB_STRINGS,
): TabLabel[] {
  const labels: TabLabel[] = sessions.map((session) => ({
    text: session.alias ?? session.doc.fileName,
    detail: '',
    collides: false,
  }));

  // Group by the *final* text, so giving one of two same-named files an alias
  // removes the need for a disambiguator on either of them.
  const groups = new Map<string, number[]>();
  labels.forEach((label, index) => {
    const bucket = groups.get(label.text);
    if (bucket) bucket.push(index);
    else groups.set(label.text, [index]);
  });

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    for (const index of indices) labels[index].collides = true;

    const pathAvailable = indices.every((i) => sessions[i].sourcePath !== null);
    for (const index of indices) {
      const session = sessions[index];
      const suffix = pathAvailable
        ? shortPath(session.sourcePath)
        : [formatStamp(session.mtime), formatSize(session.size)]
            .filter((part) => part.length > 0)
            .join(' · ');
      if (suffix.length > 0) labels[index].text = `${labels[index].text} · ${suffix}`;
    }

    // Identical name AND identical metadata: fall back to an ordinal.
    const seen = new Map<string, number>();
    for (const index of indices) {
      const text = labels[index].text;
      const count = (seen.get(text) ?? 0) + 1;
      seen.set(text, count);
      if (count > 1) labels[index].text = `${text} ${marker(count)}`;
    }
  }

  sessions.forEach((session, index) => {
    const bits: string[] = [session.doc.fileName];
    if (session.sourcePath !== null) bits.push(shortPath(session.sourcePath));
    const size = formatSize(session.size);
    if (size.length > 0) bits.push(size);
    const stamp = formatStamp(session.mtime);
    if (stamp.length > 0) bits.push(stamp);
    bits.push(strings.rows(session.doc.rows.length, columnCount(session.doc)));
    bits.push(`${session.doc.encoding} / ${JSON.stringify(session.doc.delimiter)}`);
    if (session.isSample) bits.push(strings.sample);
    else if (!session.canWriteInPlace) bits.push(strings.readOnly);
    labels[index].detail = bits.join(' · ');
  });

  return labels;
}
