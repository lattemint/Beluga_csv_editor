/**
 * Virtualized spreadsheet grid.
 *
 * Only the visible row window lives in the DOM (the real rules.csv has ~11k
 * rows), the header row and the `#`/`id` columns are frozen, and every cell
 * carries the fidelity metadata from the model:
 *   - multiline cells get a `↵n` badge and are collapsed to one visual line
 *   - originally-quoted cells get a subtle left edge
 *   - fields absent from a short (ragged) row are hatched, not shown as empty
 *
 * The grid renders a *view* list of document row indices, so a search or filter
 * narrows the view without touching the document.
 */
import type { CsvDocument, Row } from '../core/model.ts';
import { columnNames } from '../core/model.ts';
import { t } from './i18n.ts';
import { el } from './dom.ts';

export const ROW_HEIGHT = 30;
const ROWNUM_WIDTH = 58;
const OVERSCAN = 8;
const MIN_COL_WIDTH = 90;
const MAX_COL_WIDTH = 460;

export interface GridHooks {
  onSelect(row: number, col: number): void;
  onActivate(row: number, col: number): void;
  onContextMenu(row: number, col: number, clientX: number, clientY: number): void;
  onTypeToEdit?: (row: number, col: number, initial: string) => void;
}

/** Rough display width in monospace cells; CJK counts as two. */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0x2e80 ? 2 : 1;
  }
  return width;
}

export function lineCount(value: string): number {
  if (value.length === 0) return 0;
  return value.split(/\r\n|\r|\n/).length;
}

function preview(value: string): string {
  const flattened = value.replace(/\r\n|\r|\n/g, ' ⏎ ');
  return flattened.length > 400 ? `${flattened.slice(0, 400)}…` : flattened;
}

export class GridView {
  private host: HTMLElement;
  private doc: CsvDocument;
  private hooks: GridHooks;
  private scroller: HTMLDivElement;
  private table: HTMLTableElement;
  private colgroup: HTMLTableColElement;
  private tbody: HTMLTableSectionElement;
  private widths: number[] = [];
  private visible: number[] = [];
  private posOf = new Map<number, number>();
  private selectedRow = 0;
  private selectedCol = 0;
  private renderedStart = -1;
  private renderedEnd = -1;
  private editor: HTMLTextAreaElement | null = null;
  private editorCommit: ((value: string) => void) | null = null;

  constructor(host: HTMLElement, doc: CsvDocument, hooks: GridHooks) {
    this.host = host;
    this.doc = doc;
    this.hooks = hooks;

    this.colgroup = el('colgroup');
    this.tbody = el('tbody');
    const thead = el('thead');
    this.table = el('table', { class: 'grid' }, [this.colgroup, thead, this.tbody]);
    this.scroller = el('div', { class: 'grid-scroll', tabindex: '0' }, [this.table]);
    this.host.append(this.scroller);

    this.scroller.addEventListener('scroll', () => {
      this.closeEditor(true);
      this.renderWindow();
    });
    this.scroller.addEventListener('mousedown', (event) => this.handleMouseDown(event));
    this.scroller.addEventListener('dblclick', (event) => this.handleDoubleClick(event));
    this.scroller.addEventListener('contextmenu', (event) => this.handleContextMenu(event));
    this.scroller.addEventListener('keydown', (event) => this.handleKeyDown(event));
    window.addEventListener('resize', () => this.refresh());

    this.setVisible(null);
    this.buildHeader();
  }

  // ---------------------------------------------------------------- geometry

  /** Column titles with a localized placeholder for unnamed columns. */
  private displayNames(): string[] {
    return columnNames(this.doc).map((name, index) =>
      name.length > 0 ? name : t('col.placeholder', { n: index + 1 }),
    );
  }

  private measureWidths(): void {
    const names = this.displayNames();
    const sampleRows = Math.min(this.doc.rows.length, 160);
    this.widths = names.map((name, col) => {
      let widest = displayWidth(name) + 4;
      for (let r = 0; r < sampleRows; r += 1) {
        const cell = this.doc.rows[r].cells[col];
        if (!cell) continue;
        const firstLine = cell.value.split(/\r\n|\r|\n/)[0];
        const w = displayWidth(firstLine) + 4;
        if (w > widest) widest = w;
      }
      return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(widest * 7.6 + 18)));
    });
  }

  private buildHeader(): void {
    this.measureWidths();

    const headRow = el('tr');
    headRow.append(el('th', { class: 'rownum frozen-0', text: '#' }));
    this.displayNames().forEach((name, col) => {
      const th = el('th', {
        class: `col-head${col === 0 ? ' frozen-1' : ''}`,
        'data-col': col,
        title: name,
      });
      th.append(el('span', { class: 'col-name', text: name }));
      th.append(this.makeResizer(col));
      headRow.append(th);
    });

    const thead = this.table.querySelector('thead');
    if (thead) {
      while (thead.firstChild) thead.removeChild(thead.firstChild);
      thead.append(headRow);
    }

    this.syncColgroup();
    this.invalidate();
  }

  private makeResizer(col: number): HTMLElement {
    const handle = el('span', { class: 'col-resizer', title: t('grid.resize') });
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = this.widths[col];
      const onMove = (move: MouseEvent) => {
        this.widths[col] = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (move.clientX - startX)));
        this.syncColgroup();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    return handle;
  }

  private syncColgroup(): void {
    while (this.colgroup.firstChild) this.colgroup.removeChild(this.colgroup.firstChild);
    this.colgroup.append(el('col', { style: `width:${ROWNUM_WIDTH}px` }));
    let total = ROWNUM_WIDTH;
    for (const width of this.widths) {
      this.colgroup.append(el('col', { style: `width:${width}px` }));
      total += width;
    }
    this.table.style.width = `${total}px`;
    this.table.style.setProperty('--frozen-1', `${ROWNUM_WIDTH}px`);
  }

  // ---------------------------------------------------------------- view list

  /** `null` shows every row; otherwise only the given document row indices. */
  setVisible(indices: number[] | null): void {
    if (indices === null || indices.length === this.doc.rows.length) {
      this.visible = this.doc.rows.map((_row, i) => i);
    } else {
      this.visible = indices.slice();
    }
    this.posOf.clear();
    this.visible.forEach((docIndex, pos) => this.posOf.set(docIndex, pos));
    if (!this.posOf.has(this.selectedRow)) {
      this.selectedRow = this.visible.length > 0 ? this.visible[0] : 0;
    }
    this.invalidate();
    this.renderWindow();
    this.paintSelection();
  }

  get visibleCount(): number {
    return this.visible.length;
  }

  // ---------------------------------------------------------------- rendering

  private invalidate(): void {
    this.renderedStart = -1;
    this.renderedEnd = -1;
  }

  refresh(): void {
    this.invalidate();
    this.renderWindow();
    this.paintSelection();
  }

  /** Column titles live in row 1, so editing that row must rebuild the header. */
  refreshHeader(): void {
    this.buildHeader();
    this.refresh();
  }

  /** Rebuild everything (column titles/widths changed or a new file loaded). */
  reset(doc: CsvDocument): void {
    this.doc = doc;
    this.selectedRow = 0;
    this.selectedCol = 0;
    this.scroller.scrollTop = 0;
    this.scroller.scrollLeft = 0;
    this.setVisible(null);
    this.buildHeader();
    this.refresh();
  }

  private renderWindow(): void {
    const total = this.visible.length;
    const scrollTop = this.scroller.scrollTop;
    const viewHeight = this.scroller.clientHeight || 600;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const span = Math.ceil(viewHeight / ROW_HEIGHT) + OVERSCAN * 2 + 1;
    const end = Math.min(total, start + span);

    if (start === this.renderedStart && end === this.renderedEnd) return;
    this.renderedStart = start;
    this.renderedEnd = end;

    const fragment = document.createDocumentFragment();
    const columnTotal = this.widths.length + 1;

    if (start > 0) {
      const spacer = el('tr', { class: 'spacer' });
      spacer.append(el('td', { colspan: columnTotal, style: `height:${start * ROW_HEIGHT}px` }));
      fragment.append(spacer);
    }

    for (let pos = start; pos < end; pos += 1) {
      fragment.append(this.renderRow(this.visible[pos]));
    }

    if (end < total) {
      const spacer = el('tr', { class: 'spacer' });
      spacer.append(
        el('td', { colspan: columnTotal, style: `height:${(total - end) * ROW_HEIGHT}px` }),
      );
      fragment.append(spacer);
    }

    while (this.tbody.firstChild) this.tbody.removeChild(this.tbody.firstChild);
    this.tbody.append(fragment);
  }

  private renderRow(docIndex: number): HTMLTableRowElement {
    const row = this.doc.rows[docIndex];
    const tr = el('tr', { class: `row row-${row.kind}`, 'data-row': docIndex });
    tr.append(el('td', { class: 'rownum frozen-0', text: String(docIndex + 1) }));
    this.widths.forEach((_width, col) => tr.append(this.renderCell(row, docIndex, col)));
    return tr;
  }

  private renderCell(row: Row, docIndex: number, col: number): HTMLTableCellElement {
    const cell = row.cells[col];
    const classes = ['cell'];
    if (col === 0) classes.push('frozen-1');

    if (!cell) {
      classes.push('cell-absent');
      const td = el('td', { class: classes.join(' '), 'data-row': docIndex, 'data-col': col });
      td.title = t('grid.absent', { n: row.origFieldCount });
      return td;
    }

    if (cell.value.length === 0) classes.push('cell-empty');
    if (cell.dirty) classes.push('cell-dirty');
    if (cell.quoted) classes.push('cell-quoted');
    if (col === this.selectedCol && docIndex === this.selectedRow) classes.push('selected');

    const lines = lineCount(cell.value);
    if (lines > 1) classes.push('cell-multiline');

    const td = el('td', { class: classes.join(' '), 'data-row': docIndex, 'data-col': col });
    td.append(el('span', { class: 'cell-text', text: preview(cell.value) }));
    if (lines > 1) {
      td.append(el('span', { class: 'ml-badge', text: `↵${lines}`, title: t('grid.mlBadge', { n: lines }) }));
    }

    const flags: string[] = [];
    if (cell.quoted) flags.push(t('grid.flagQuoted'));
    if (lines > 1) flags.push(t('grid.flagLines', { n: lines }));
    if (cell.dirty) flags.push(t('grid.flagDirty'));
    const flagsText = flags.length > 0 ? `\n\n[${flags.join(' / ')}]` : '';
    td.title = cell.value.length > 0 ? `${cell.value}${flagsText}` : flags.join(' / ');
    return td;
  }

  // ---------------------------------------------------------------- selection

  private cellElement(docIndex: number, col: number): HTMLTableCellElement | null {
    return this.tbody.querySelector<HTMLTableCellElement>(
      `td[data-row="${docIndex}"][data-col="${col}"]`,
    );
  }

  private paintSelection(): void {
    for (const td of this.tbody.querySelectorAll('td.selected')) td.classList.remove('selected');
    const td = this.cellElement(this.selectedRow, this.selectedCol);
    if (td) td.classList.add('selected');

    for (const th of this.table.querySelectorAll('th.col-head.current')) th.classList.remove('current');
    const th = this.table.querySelector(`th.col-head[data-col="${this.selectedCol}"]`);
    if (th) th.classList.add('current');
  }

  get selection(): { row: number; col: number } {
    return { row: this.selectedRow, col: this.selectedCol };
  }

  select(docIndex: number, col: number, notify = true): void {
    const maxCol = Math.max(0, this.widths.length - 1);
    this.selectedRow = docIndex;
    this.selectedCol = Math.max(0, Math.min(maxCol, col));
    if (this.posOf.has(this.selectedRow)) this.ensureVisible(this.selectedRow, this.selectedCol);
    this.paintSelection();
    if (notify) this.hooks.onSelect(this.selectedRow, this.selectedCol);
  }

  /** Move by view position, so arrow keys follow the filtered list. */
  moveSelection(rowDelta: number, colDelta: number): void {
    const currentPos = this.posOf.get(this.selectedRow) ?? 0;
    const nextPos = Math.max(0, Math.min(this.visible.length - 1, currentPos + rowDelta));
    const nextRow = this.visible[nextPos] ?? this.selectedRow;
    this.select(nextRow, this.selectedCol + colDelta);
  }

  moveToEdge(rowDelta: number): void {
    const nextPos = rowDelta < 0 ? 0 : this.visible.length - 1;
    this.select(this.visible[nextPos] ?? this.selectedRow, this.selectedCol);
  }

  private ensureVisible(docIndex: number, col: number): void {
    const pos = this.posOf.get(docIndex) ?? 0;
    const rowTop = pos * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const viewTop = this.scroller.scrollTop;
    const viewBottom = viewTop + this.scroller.clientHeight;
    if (rowTop < viewTop) this.scroller.scrollTop = rowTop;
    else if (rowBottom > viewBottom) this.scroller.scrollTop = rowBottom - this.scroller.clientHeight;

    let left = ROWNUM_WIDTH;
    for (let i = 0; i < col; i += 1) left += this.widths[i];
    const right = left + (this.widths[col] ?? MIN_COL_WIDTH);
    const frozenEdge = ROWNUM_WIDTH + (this.widths[0] ?? 0);
    const viewLeft = this.scroller.scrollLeft + frozenEdge;
    const viewRight = this.scroller.scrollLeft + this.scroller.clientWidth;
    if (left < viewLeft) this.scroller.scrollLeft = Math.max(0, left - frozenEdge);
    else if (right > viewRight) this.scroller.scrollLeft = right - this.scroller.clientWidth;

    this.renderWindow();
  }

  // ---------------------------------------------------------------- events

  private locate(target: EventTarget | null): { row: number; col: number } | null {
    if (!(target instanceof Element)) return null;
    const td = target.closest('td[data-row][data-col]');
    if (!td) return null;
    const row = Number(td.getAttribute('data-row'));
    const col = Number(td.getAttribute('data-col'));
    if (Number.isNaN(row) || Number.isNaN(col)) return null;
    return { row, col };
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest('.col-resizer')) return;
    const hit = this.locate(event.target);
    if (!hit) return;
    if (hit.row === this.selectedRow && hit.col === this.selectedCol) return;
    this.select(hit.row, hit.col);
  }

  private handleDoubleClick(event: MouseEvent): void {
    const hit = this.locate(event.target);
    if (!hit) return;
    this.select(hit.row, hit.col);
    this.hooks.onActivate(hit.row, hit.col);
  }

  private handleContextMenu(event: MouseEvent): void {
    const hit = this.locate(event.target);
    if (!hit) return;
    event.preventDefault();
    this.select(hit.row, hit.col);
    this.hooks.onContextMenu(hit.row, hit.col, event.clientX, event.clientY);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.isEditing) return;
    const key = event.key;
    const shift = event.shiftKey;

    if (key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1, 0);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1, 0);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      this.moveSelection(0, 1);
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      this.moveSelection(0, -1);
    } else if (key === 'Tab') {
      event.preventDefault();
      this.moveSelection(0, shift ? -1 : 1);
    } else if (key === 'PageDown') {
      event.preventDefault();
      this.moveSelection(20, 0);
    } else if (key === 'PageUp') {
      event.preventDefault();
      this.moveSelection(-20, 0);
    } else if (key === 'Home') {
      event.preventDefault();
      this.select((event.ctrlKey ? this.visible[0] : this.selectedRow) ?? 0, 0);
    } else if (key === 'End') {
      event.preventDefault();
      this.select(
        (event.ctrlKey ? this.visible[this.visible.length - 1] : this.selectedRow) ?? 0,
        this.widths.length - 1,
      );
    } else if (key === 'F2') {
      event.preventDefault();
      this.hooks.onActivate(this.selectedRow, this.selectedCol);
    } else if (key === 'Enter') {
      event.preventDefault();
      this.hooks.onActivate(this.selectedRow, this.selectedCol);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (this.hooks.onTypeToEdit) {
        event.preventDefault();
        this.hooks.onTypeToEdit(this.selectedRow, this.selectedCol, key);
      }
    }
  }

  // ---------------------------------------------------------------- inline editor

  openEditor(docIndex: number, col: number, commit: (value: string) => void, initial?: string): void {
    this.closeEditor(false);
    const td = this.cellElement(docIndex, col);
    if (!td) return;
    const cell = this.doc.rows[docIndex]?.cells[col];
    if (!cell) return;

    const rect = td.getBoundingClientRect();
    const width = Math.max(rect.width, 280);
    const area = el('textarea', {
      class: 'inline-editor',
      spellcheck: 'false',
      style: `left:${Math.min(rect.left, Math.max(8, window.innerWidth - width - 12))}px;top:${rect.top}px;width:${width}px;height:${Math.max(rect.height + 6, 34)}px`,
    });
    area.value = initial !== undefined ? initial : cell.value;

    const autosize = () => {
      area.style.height = 'auto';
      area.style.height = `${Math.min(Math.max(area.scrollHeight + 4, 34), 260)}px`;
    };

    area.addEventListener('input', autosize);
    area.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeEditor(false);
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.closeEditor(true);
      }
    });
    area.addEventListener('blur', () => this.closeEditor(true));

    document.body.append(area);
    this.editor = area;
    this.editorCommit = commit;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    autosize();
  }

  closeEditor(apply: boolean): void {
    const area = this.editor;
    const commit = this.editorCommit;
    this.editor = null;
    this.editorCommit = null;
    if (!area) return;
    const value = area.value;
    area.remove();
    if (apply && commit) commit(value);
  }

  get isEditing(): boolean {
    return this.editor !== null;
  }

  get scrollerElement(): HTMLElement {
    return this.scroller;
  }
}
