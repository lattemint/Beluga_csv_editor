/**
 * Application shell: welcome screen, toolbar, tab bar, search bar, grid, cell
 * editor, status bar.
 *
 * The app owns a list of DocumentSession objects — one per open CSV — and renders
 * whichever is active. All per-file state (document, handles, undo history,
 * selection, search, scroll) lives on the session; only preferences (theme,
 * language, the .bak toggle, the granted source directory) are global.
 *
 * The welcome screen is shown until the first file (or the sample) is opened,
 * and returns whenever the last tab is closed.
 *
 * Saving stays byte-faithful: untouched fields replay their verbatim source
 * slices, so writing a file back without edits reproduces it exactly.
 *
 * Keyboard note: Ctrl+W / Ctrl+Tab / Ctrl+1..9 are reserved by browsers and
 * cannot be intercepted, so tab shortcuts are Alt-based (Alt+W, Alt+PgUp/PgDn,
 * Alt+1..9). Ctrl+Shift+S works because it is not reserved.
 */
import type { LoadedFile } from '../core/fileio.ts';
import {
  canWriteInPlace,
  downloadBytes,
  ensureWritable,
  isStaleHandleError,
  pickBackupTarget,
  pickFileToOpen,
  pickSaveTarget,
  pickSourceDirectory,
  readBytes,
  readHandle,
  resolveWithin,
  statFile,
  writeBytesResilient,
} from '../core/fileio.ts';
import { makeSampleDocument } from '../core/mock.ts';
import type { CsvDocument, Delimiter, Row } from '../core/model.ts';
import {
  clearRawForms,
  columnCount,
  columnNames,
  delimiterGlyph,
  encodingLabel,
  eolLabel,
  makeCell,
  makeRow,
  needsQuoting,
} from '../core/model.ts';
import type { ParsedCsv } from '../core/parse.ts';
import { detectDelimiter, parseCsvBytes, parseCsvText, tokenizeRecords } from '../core/parse.ts';
import { serializeCsvBytes, serializeRow } from '../core/serialize.ts';
import type { CellSnapshot, EditRecord } from '../core/session.ts';
import {
  DocumentSession,
  computeTabLabels,
  formatStamp,
  type TabStrings,
} from '../core/session.ts';
import type { DelimiterCandidate, MenuItem } from './dialogs.ts';
import {
  closeContextMenu,
  showChoice,
  showConfirm,
  showContextMenu,
  showInfo,
  showOpenDialog,
  toast,
} from './dialogs.ts';
import { el } from './dom.ts';
import { GridView, lineCount } from './grid.ts';
import type { MessageKey } from './i18n.ts';
import {
  getLanguage,
  initLanguage,
  onLanguageChange,
  setLanguage,
  t,
} from './i18n.ts';
import type { ThemeChoice } from './theme.ts';
import { THEMES, applyTheme, readThemeChoice, storeThemeChoice, watchSystemTheme } from './theme.ts';
import { renderWelcome } from './welcome.ts';

/** Tauri 2 exposes its JS bridge on window when `withGlobalTauri` is enabled. */
interface TauriBridge {
  event?: { listen?: (name: string, handler: () => void) => unknown };
  window?: { getCurrentWindow?: () => { destroy?: () => void } | null };
}
type WindowWithTauri = Window & { __TAURI__?: TauriBridge };

/** Dummy document the grid holds while the welcome screen is up. */
const EMPTY_DOC: CsvDocument = {
  fileName: '',
  filePath: null,
  delimiter: ',',
  encoding: 'utf-8',
  eol: '\r\n',
  trailingEol: true,
  rows: [],
};

interface UiRefs {
  fileName: HTMLElement;
  dirtyChip: HTMLElement;
  openBtn: HTMLButtonElement;
  openLabel: HTMLElement;
  saveBtn: HTMLButtonElement;
  saveLabel: HTMLElement;
  saveAsBtn: HTMLButtonElement;
  backupToggle: HTMLInputElement;
  backupToggleLabel: HTMLElement;
  delimiterSelect: HTMLSelectElement;
  delimiterLabel: HTMLElement;
  encodingLabel: HTMLElement;
  eolLabel: HTMLElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  matchInfo: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  tabbar: HTMLElement;
  tabsHost: HTMLElement;
  tabAddBtn: HTMLButtonElement;
  subbar: HTMLElement;
  gridHost: HTMLElement;
  welcomeHost: HTMLElement;
  cellEditor: HTMLElement;
  editorTitle: HTMLElement;
  editorFlags: HTMLElement;
  editorArea: HTMLTextAreaElement;
  editorApply: HTMLButtonElement;
  editorRevert: HTMLButtonElement;
  editorHint: HTMLElement;
  status: HTMLElement;
  saveState: HTMLElement;
  langBtn: HTMLButtonElement;
  channelBadge: HTMLElement;
  themeSelect: HTMLSelectElement;
}

function buildUi(root: HTMLElement): UiRefs {
  const fileName = el('span', { class: 'file-name' });
  const dirtyChip = el('span', { class: 'chip chip-dirty hidden', text: t('chip.unsaved') });

  const openLabel = el('span', { text: t('toolbar.open') });
  const openBtn = el('button', { class: 'btn', type: 'button', title: t('toolbar.openTitle') }, [
    el('span', { class: 'btn-key', text: 'Ctrl+O' }),
    openLabel,
  ]);
  const saveLabel = el('span', { text: t('toolbar.save') });
  const saveBtn = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    title: t('toolbar.saveTitle'),
  }, [
    el('span', { class: 'btn-key', text: 'Ctrl+S' }),
    saveLabel,
  ]);
  const saveAsBtn = el('button', { class: 'btn', type: 'button', text: t('toolbar.saveAs') });

  const backupToggle = el('input', { class: 'toggle-input', type: 'checkbox' });
  backupToggle.checked = true;
  const backupToggleLabel = el('span', { class: 'toggle-label', text: t('toolbar.backup') });

  const delimiterSelect = el('select', { class: 'select', title: t('toolbar.delimiterTitle') });
  const delimiterLabel = el('span', { class: 'field-inline', text: t('toolbar.delimiter') });
  const encodingLabelEl = el('span', { class: 'meta-chip' });
  const eolLabelEl = el('span', { class: 'meta-chip' });

  const undoBtn = el('button', { class: 'btn btn-icon', type: 'button', text: t('toolbar.undo'), title: 'Ctrl+Z' });
  const redoBtn = el('button', { class: 'btn btn-icon', type: 'button', text: t('toolbar.redo'), title: 'Ctrl+Y' });
  undoBtn.disabled = true;
  redoBtn.disabled = true;

  const channelBadge = el('span', { class: 'proto-badge' });
  const themeSelect = el('select', { class: 'select', title: t('toolbar.themeTitle') });

  const toolbar = el('header', { class: 'toolbar' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'brand-mark', text: 'CSV' })]),
    el('div', { class: 'file-block' }, [fileName, dirtyChip]),
    el('div', { class: 'sep' }),
    el('div', { class: 'group' }, [openBtn, saveBtn, saveAsBtn]),
    el('label', { class: 'toggle', title: t('toolbar.backupTitle') }, [
      backupToggle,
      backupToggleLabel,
    ]),
    el('div', { class: 'sep' }),
    el('div', { class: 'group' }, [
      delimiterLabel,
      delimiterSelect,
      encodingLabelEl,
      eolLabelEl,
    ]),
    el('div', { class: 'sep' }),
    el('div', { class: 'group' }, [undoBtn, redoBtn]),
    el('div', { class: 'spacer' }),
    channelBadge,
    themeSelect,
  ]);

  const tabsHost = el('div', { class: 'tabs' });
  const tabAddBtn = el('button', {
    class: 'tab-add',
    type: 'button',
    text: '+',
    title: t('tab.addTitle'),
  });
  const tabbar = el('div', { class: 'tabbar' }, [tabsHost, tabAddBtn]);

  const searchInput = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: t('search.placeholder'),
    spellcheck: 'false',
  });
  const filterSelect = el('select', { class: 'select' }, [
    el('option', { value: 'all', text: t('filter.all') }),
    el('option', { value: 'data', text: t('filter.data') }),
    el('option', { value: 'comment', text: t('filter.comment') }),
    el('option', { value: 'blank', text: t('filter.blank') }),
    el('option', { value: 'dirty', text: t('filter.dirty') }),
  ]);
  const matchInfo = el('span', { class: 'match-info' });
  const prevBtn = el('button', { class: 'btn btn-mini', type: 'button', text: t('search.prev') });
  const nextBtn = el('button', { class: 'btn btn-mini', type: 'button', text: t('search.next') });

  const subbar = el('div', { class: 'subbar' }, [
    searchInput,
    filterSelect,
    matchInfo,
    el('div', { class: 'spacer' }),
    prevBtn,
    nextBtn,
  ]);

  const gridHost = el('main', { class: 'grid-host' });
  const welcomeHost = el('div', { class: 'welcome-host hidden' });

  const editorTitle = el('span', { class: 'editor-title' });
  const editorFlags = el('span', { class: 'editor-flags' });
  const editorArea = el('textarea', {
    class: 'editor-area',
    spellcheck: 'false',
    placeholder: t('editor.placeholder'),
  });
  const editorApply = el('button', { class: 'btn btn-primary', type: 'button', text: t('editor.apply') });
  const editorRevert = el('button', { class: 'btn', type: 'button', text: t('editor.revert') });
  const editorHint = el('span', { class: 'editor-hint' });

  const cellEditor = el('section', { class: 'cell-editor' }, [
    el('div', { class: 'editor-head' }, [editorTitle, editorFlags]),
    el('div', { class: 'editor-body' }, [editorArea]),
    el('div', { class: 'editor-foot' }, [editorApply, editorRevert, editorHint]),
  ]);

  const status = el('span', { class: 'status-text' });
  const saveState = el('span', { class: 'chip chip-saved hidden' });
  const langBtn = el('button', {
    class: 'btn btn-mini',
    type: 'button',
    text: getLanguage() === 'zh' ? 'EN' : '中文',
    title: t('lang.title'),
  });
  const statusbar = el('footer', { class: 'statusbar' }, [
    status,
    el('div', { class: 'spacer' }),
    langBtn,
    saveState,
  ]);

  const shell = el('div', { class: 'app' }, [
    toolbar,
    tabbar,
    subbar,
    gridHost,
    welcomeHost,
    cellEditor,
    statusbar,
  ]);
  root.append(shell);

  return {
    fileName,
    dirtyChip,
    openBtn,
    openLabel,
    saveBtn,
    saveLabel,
    saveAsBtn,
    backupToggle,
    backupToggleLabel,
    delimiterSelect,
    delimiterLabel,
    encodingLabel: encodingLabelEl,
    eolLabel: eolLabelEl,
    undoBtn,
    redoBtn,
    searchInput,
    filterSelect,
    matchInfo,
    prevBtn,
    nextBtn,
    tabbar,
    tabsHost,
    tabAddBtn,
    subbar,
    gridHost,
    welcomeHost,
    cellEditor,
    editorTitle,
    editorFlags,
    editorArea,
    editorApply,
    editorRevert,
    editorHint,
    status,
    saveState,
    langBtn,
    channelBadge,
    themeSelect,
  };
}

// --------------------------------------------------------------- file helpers

const DELIMITER_GLYPHS: Record<string, string> = { ',': ',', ';': ';', '\t': 'Tab', '|': '|' };
const DELIMITER_LABEL_KEYS: Record<string, MessageKey> = {
  ',': 'delim.label.comma',
  ';': 'delim.label.semi',
  '\t': 'delim.label.tab',
  '|': 'delim.label.pipe',
};
const DELIMITER_OPTION_KEYS: Record<string, MessageKey> = {
  ',': 'delim.opt.comma',
  ';': 'delim.opt.semi',
  '\t': 'delim.opt.tab',
  '|': 'delim.opt.pipe',
};

/** Real delimiter verdicts, scored on the text that was actually loaded. */
function delimiterCandidates(text: string): DelimiterCandidate[] {
  return detectDelimiter(text).map((verdict) => {
    const percent = Math.round(verdict.noteRatio * 100);
    const note =
      verdict.noteKey === 'ok'
        ? t('delim.noteOk', { p: percent })
        : verdict.noteKey === 'noHit'
          ? t('delim.noteNoHit')
          : t('delim.noteFew', { p: percent });
    return {
      value: verdict.delimiter,
      glyph: DELIMITER_GLYPHS[verdict.delimiter] ?? verdict.delimiter,
      label: t(DELIMITER_LABEL_KEYS[verdict.delimiter] ?? 'delim.label.comma'),
      columns: verdict.columns,
      consistent: verdict.consistent,
      recommended: verdict.recommended,
      note,
    };
  });
}

/** Verbatim source lines for the preview — raw replay, not a re-print. */
function previewLinesOf(parsed: ParsedCsv, count: number): string[] {
  const lines: string[] = [];
  const rows = parsed.doc.rows;
  for (let i = 0; i < Math.min(count, rows.length); i += 1) {
    lines.push(serializeRow(rows[i].cells, parsed.doc.delimiter));
  }
  return lines;
}

/** Quote-aware preview split, so quoted delimiters do not fake extra columns. */
function splitPreviewLine(line: string, delimiter: Delimiter): string[] {
  const { rows } = tokenizeRecords(line, delimiter);
  const first = rows[0];
  return first ? first.cells.map((cell) => cell.value) : [line];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class App {
  private root: HTMLElement;
  private ui: UiRefs;
  private grid: GridView;

  private sessions: DocumentSession[] = [];
  private activeIndex = 0;
  private nextSessionId = 1;
  private nextAccent = 0;

  /** Transient: whether the bottom editor holds uncommitted text. */
  private editorDirty = false;
  private visibleIndices: number[] = [];
  /** Tabs are only re-rendered when their visible text actually changes. */
  private lastTabSignature = '';

  /** Granted read-only directory, used only to recover relative paths. */
  private sourceDirectory: FileSystemDirectoryHandle | null = null;

  constructor(root: HTMLElement, initialDoc?: CsvDocument) {
    this.root = root;
    initLanguage();
    onLanguageChange(() => this.relabel());
    this.ui = buildUi(root);

    if (initialDoc) {
      this.sessions.push(new DocumentSession(this.nextSessionId, initialDoc, this.nextAccent));
      this.nextSessionId += 1;
      this.nextAccent += 1;
    }

    this.grid = new GridView(this.ui.gridHost, EMPTY_DOC, {
      onSelect: (row, col) => this.handleSelect(row, col),
      onActivate: (row, col) => this.openInlineEditor(row, col),
      onContextMenu: (row, col, x, y) => this.openCellMenu(row, col, x, y),
      onTypeToEdit: (row, col, initial) => this.openInlineEditor(row, col, initial),
    });

    this.wireEvents();
    this.buildDelimiterOptions();
    this.buildThemeOptions();
    this.registerTauriCloseHandler();
    this.updateWelcomeState();
    if (this.sessions.length > 0) {
      // The grid was constructed with the empty placeholder doc; point it at the
      // real initial document now (main.ts passes none, so this is for probes).
      this.grid.reset(this.session.doc);
      this.renderTabs();
      this.applyFilter();
      this.loadEditorPanel();
      this.updateStatus();
      this.grid.scrollerElement.focus();
    }
  }

  // ------------------------------------------------ active-session accessors

  private get session(): DocumentSession {
    return this.sessions[this.activeIndex];
  }

  private get doc(): CsvDocument {
    return this.session.doc;
  }

  private set doc(value: CsvDocument) {
    this.session.doc = value;
  }

  private get loadedText(): string | null {
    return this.session.loadedText;
  }

  private get fileHandle(): FileSystemFileHandle | null {
    return this.session.fileHandle;
  }

  private get baseline(): Map<string, CellSnapshot> {
    return this.session.baseline;
  }

  private get undoStack(): EditRecord[] {
    return this.session.undoStack;
  }

  private get redoStack(): EditRecord[] {
    return this.session.redoStack;
  }

  private get selectedRow(): number {
    return this.session.selectedRow;
  }

  private set selectedRow(value: number) {
    this.session.selectedRow = value;
  }

  private get selectedCol(): number {
    return this.session.selectedCol;
  }

  private set selectedCol(value: number) {
    this.session.selectedCol = value;
  }

  private get editorRow(): number {
    return this.session.editorRow;
  }

  private set editorRow(value: number) {
    this.session.editorRow = value;
  }

  private get editorCol(): number {
    return this.session.editorCol;
  }

  private set editorCol(value: number) {
    this.session.editorCol = value;
  }

  private get searchValue(): string {
    return this.session.searchValue;
  }

  private set searchValue(value: string) {
    this.session.searchValue = value;
  }

  private get filterValue(): string {
    return this.session.filterValue;
  }

  private set filterValue(value: string) {
    this.session.filterValue = value;
  }

  private tabStrings(): TabStrings {
    return {
      sample: t('tab.detailSample'),
      readOnly: t('tab.detailReadOnly'),
      rows: (rows, cols) => t('tab.detailRows', { n: rows, m: cols }),
    };
  }

  private columnNamesDisplay(): string[] {
    return columnNames(this.doc).map((name, index) =>
      name.length > 0 ? name : t('col.placeholder', { n: index + 1 }),
    );
  }

  // ------------------------------------------------------------------ wiring

  private wireEvents(): void {
    this.ui.openBtn.addEventListener('click', () => void this.doOpen());
    this.ui.saveBtn.addEventListener('click', () => void this.saveActive());
    this.ui.saveAsBtn.addEventListener('click', () => void this.doSaveAs());
    this.ui.tabAddBtn.addEventListener('click', () => void this.doOpen());
    this.ui.undoBtn.addEventListener('click', () => this.undo());
    this.ui.redoBtn.addEventListener('click', () => this.redo());
    this.ui.editorApply.addEventListener('click', () => this.commitEditorPanel());
    this.ui.editorRevert.addEventListener('click', () => this.loadEditorPanel());
    this.ui.prevBtn.addEventListener('click', () => this.gotoMatch(-1));
    this.ui.nextBtn.addEventListener('click', () => this.gotoMatch(1));
    this.ui.langBtn.addEventListener('click', () => {
      setLanguage(getLanguage() === 'zh' ? 'en' : 'zh');
    });

    this.ui.searchInput.addEventListener('input', () => {
      this.searchValue = this.ui.searchInput.value;
      this.applyFilter();
    });
    this.ui.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.gotoMatch(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        this.ui.searchInput.value = '';
        this.searchValue = '';
        this.applyFilter();
      }
    });
    this.ui.filterSelect.addEventListener('change', () => {
      this.filterValue = this.ui.filterSelect.value;
      this.applyFilter();
    });

    this.ui.delimiterSelect.addEventListener('change', () => {
      void this.switchDelimiter(this.ui.delimiterSelect.value as Delimiter);
    });
    this.ui.themeSelect.addEventListener('change', () => {
      const choice = this.ui.themeSelect.value as ThemeChoice;
      storeThemeChoice(choice);
      applyTheme(choice);
    });
    this.ui.backupToggle.addEventListener('change', () => {
      toast(this.ui.backupToggle.checked ? t('backup.on') : t('backup.off'), 'info');
    });

    this.ui.editorArea.addEventListener('input', () => {
      this.editorDirty = true;
    });
    this.ui.editorArea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.commitEditorPanel();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.loadEditorPanel();
      }
    });
    this.ui.editorArea.addEventListener('blur', () => {
      if (this.editorDirty) this.commitEditorPanel();
    });

    document.addEventListener('keydown', (event) => this.handleGlobalKey(event));

    // Browsers: losing edits to a stray reload would be worse than a dialog.
    // Inside Tauri this is handled by the close-requested bridge below, because
    // WebView2 does not show the beforeunload dialog.
    window.addEventListener('beforeunload', (event) => {
      if (!this.anyDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      void this.handleDrop(event);
    });
  }

  private registerTauriCloseHandler(): void {
    const bridge = (window as WindowWithTauri).__TAURI__;
    if (!bridge || !bridge.event || typeof bridge.event.listen !== 'function') return;
    void bridge.event.listen('close-requested', () => {
      void this.handleWindowCloseRequest();
    });
  }

  private handleGlobalKey(event: KeyboardEvent): void {
    const target = event.target;
    const inTextField =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveAll();
      return;
    }
    if (mod && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveActive();
      return;
    }
    if (mod && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void this.doOpen();
      return;
    }
    if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.ui.searchInput.focus();
      this.ui.searchInput.select();
      return;
    }
    if (this.sessions.length === 0) return;
    if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      if (inTextField) return;
      event.preventDefault();
      this.undo();
      return;
    }
    if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      if (inTextField) return;
      event.preventDefault();
      this.redo();
      return;
    }

    // Tab shortcuts. Ctrl+W / Ctrl+Tab / Ctrl+1..9 belong to the browser and
    // cannot be intercepted, so these are Alt-based.
    if (event.altKey && !mod) {
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        void this.closeSession(this.activeIndex);
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        this.cycleTab(1);
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        this.cycleTab(-1);
        return;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        event.preventDefault();
        if (digit <= this.sessions.length) this.activateSession(digit - 1);
        return;
      }
    }

    if (event.key === 'Escape') closeContextMenu();
    if (inTextField) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.grid.scrollerElement.focus();
    }
  }

  private buildDelimiterOptions(): void {
    while (this.ui.delimiterSelect.firstChild) this.ui.delimiterSelect.removeChild(this.ui.delimiterSelect.firstChild);
    for (const value of [',', ';', '\t', '|'] as Delimiter[]) {
      this.ui.delimiterSelect.append(
        el('option', { value, text: t(DELIMITER_OPTION_KEYS[value] ?? 'delim.opt.comma') }),
      );
    }
    if (this.sessions.length > 0) this.ui.delimiterSelect.value = this.doc.delimiter;
  }

  private buildThemeOptions(): void {
    const select = this.ui.themeSelect;
    while (select.firstChild) select.removeChild(select.firstChild);
    for (const theme of THEMES) {
      select.append(
        el('option', { value: theme.id, text: t(theme.labelKey), title: t(theme.hintKey) }),
      );
    }
    const choice = readThemeChoice();
    select.value = choice;
    applyTheme(choice);
    // Only one App exists per page, so registering the listener here is safe.
    watchSystemTheme();
  }

  /** Re-label every static string after a language switch. */
  private relabel(): void {
    const ui = this.ui;
    ui.openLabel.textContent = t('toolbar.open');
    ui.openBtn.title = t('toolbar.openTitle');
    ui.saveLabel.textContent = t('toolbar.save');
    ui.saveBtn.title = t('toolbar.saveTitle');
    ui.saveAsBtn.textContent = t('toolbar.saveAs');
    ui.backupToggleLabel.textContent = t('toolbar.backup');
    ui.backupToggleLabel.closest('label')?.setAttribute('title', t('toolbar.backupTitle'));
    ui.delimiterLabel.textContent = t('toolbar.delimiter');
    ui.delimiterSelect.title = t('toolbar.delimiterTitle');
    ui.undoBtn.textContent = t('toolbar.undo');
    ui.redoBtn.textContent = t('toolbar.redo');
    ui.themeSelect.title = t('toolbar.themeTitle');
    ui.searchInput.placeholder = t('search.placeholder');
    const filterKeys: Record<string, MessageKey> = {
      all: 'filter.all',
      data: 'filter.data',
      comment: 'filter.comment',
      blank: 'filter.blank',
      dirty: 'filter.dirty',
    };
    for (const option of Array.from(ui.filterSelect.options)) {
      const key = filterKeys[option.value];
      if (key) option.textContent = t(key);
    }
    ui.prevBtn.textContent = t('search.prev');
    ui.nextBtn.textContent = t('search.next');
    ui.editorApply.textContent = t('editor.apply');
    ui.editorRevert.textContent = t('editor.revert');
    ui.editorArea.placeholder = t('editor.placeholder');
    ui.langBtn.textContent = getLanguage() === 'zh' ? 'EN' : '中文';
    ui.langBtn.title = t('lang.title');

    this.buildDelimiterOptions();
    this.buildThemeOptions();
    this.lastTabSignature = '';
    if (this.sessions.length > 0) {
      this.renderTabs();
      this.loadEditorPanel();
      this.updateStatus();
    }
    this.updateWelcomeState();
  }

  // ------------------------------------------------------------------ welcome

  private welcomeHooks(): {
    onOpenFile(): void;
    onSample(): void;
    onLanguage(): void;
    onAbout(): void;
  } {
    return {
      onOpenFile: () => void this.doOpen(),
      onSample: () => this.openSample(),
      onLanguage: () => void this.chooseLanguage(),
      onAbout: () => this.showAbout(),
    };
  }

  private updateWelcomeState(): void {
    const welcome = this.sessions.length === 0;
    this.ui.gridHost.classList.toggle('hidden', welcome);
    this.ui.cellEditor.classList.toggle('hidden', welcome);
    this.ui.subbar.classList.toggle('hidden', welcome);
    this.ui.tabbar.classList.toggle('hidden', welcome);
    this.ui.saveBtn.disabled = welcome;
    this.ui.saveAsBtn.disabled = welcome;
    this.ui.welcomeHost.classList.toggle('hidden', !welcome);
    if (welcome) {
      renderWelcome(this.ui.welcomeHost, this.welcomeHooks());
      this.ui.fileName.textContent = '';
      this.ui.dirtyChip.classList.add('hidden');
      this.ui.saveState.classList.add('hidden');
      this.ui.undoBtn.disabled = true;
      this.ui.redoBtn.disabled = true;
      this.ui.status.textContent = t('app.tagline');
    }
  }

  private openSample(): void {
    const session = new DocumentSession(this.nextSessionId, makeSampleDocument(420), this.nextAccent);
    this.nextSessionId += 1;
    this.nextAccent += 1;
    this.sessions.push(session);
    this.activeIndex = this.sessions.length - 1;
    this.lastTabSignature = '';
    this.updateWelcomeState();
    this.syncActiveSession(true);
  }

  private async chooseLanguage(): Promise<void> {
    const answer = await showChoice(t('lang.title'), t('welcome.languageDesc'), [
      { value: 'zh', label: '中文', primary: getLanguage() === 'zh' },
      { value: 'en', label: 'English', primary: getLanguage() === 'en' },
    ]);
    if (answer === 'zh' || answer === 'en') setLanguage(answer);
  }

  private showAbout(): void {
    showInfo(t('about.title'), t('about.body'));
  }

  /** Tauri: the shell's close button was pressed. Decide before really closing. */
  private async handleWindowCloseRequest(): Promise<void> {
    if (this.editorDirty && this.sessions.length > 0) this.commitEditorPanel();
    const dirty = this.sessions.filter((s) => s.dirtyCount > 0).length;
    if (dirty === 0) {
      this.destroyWindow();
      return;
    }
    const answer = await showChoice(t('windowClose.title'), t('windowClose.msg', { n: dirty }), [
      { value: 'save', label: t('windowClose.saveQuit'), primary: true },
      { value: 'discard', label: t('windowClose.quit'), danger: true },
      { value: 'cancel', label: t('dialog.cancel') },
    ]);
    if (answer === null || answer === 'cancel') return;
    if (answer === 'save') {
      await this.saveAll();
      if (this.anyDirty()) return;
    }
    this.destroyWindow();
  }

  private destroyWindow(): void {
    const bridge = (window as WindowWithTauri).__TAURI__;
    const current = bridge?.window?.getCurrentWindow?.();
    if (current && typeof current.destroy === 'function') {
      current.destroy();
      return;
    }
    window.close();
  }

  // -------------------------------------------------------------------- tabs

  private anyDirty(): boolean {
    return this.sessions.some((session) => session.dirtyCount > 0);
  }

  private renderTabs(): void {
    if (this.sessions.length === 0) return;
    const labels = computeTabLabels(this.sessions, this.tabStrings());
    const signature =
      `${this.activeIndex}|` +
      this.sessions
        .map((session, index) => `${labels[index].text}${session.dirtyCount > 0 ? '*' : ''}`)
        .join('|');
    if (signature === this.lastTabSignature) return;
    this.lastTabSignature = signature;

    const host = this.ui.tabsHost;
    while (host.firstChild) host.removeChild(host.firstChild);

    this.sessions.forEach((session, index) => {
      const label = labels[index];
      const tab = el('div', {
        class: `tab${index === this.activeIndex ? ' active' : ''}`,
        'data-index': index,
        title: t('tab.title', { detail: label.detail }),
      });

      const dot = el('span', { class: `tab-dot${label.collides ? '' : ' hidden-dot'}` });
      dot.style.setProperty('--tab-dot', `var(--dot-${session.accentIndex % 8})`);
      tab.append(dot);
      tab.append(el('span', { class: 'tab-label', text: label.text }));
      if (session.dirtyCount > 0) {
        tab.append(el('span', { class: 'tab-dirty', text: '●', title: t('tab.dirty') }));
      }

      const close = el('button', {
        class: 'tab-close',
        type: 'button',
        text: '×',
        title: t('tab.closeTitle'),
      });
      tab.append(close);

      tab.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          void this.closeSession(index);
          return;
        }
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('.tab-close')) return;
        this.activateSession(index);
      });
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.closeSession(index);
      });
      tab.addEventListener('dblclick', () => this.startRename(index));
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.openTabMenu(index, event.clientX, event.clientY);
      });

      host.append(tab);
    });

    const active = host.querySelector('.tab.active');
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private activateSession(index: number): void {
    if (index < 0 || index >= this.sessions.length) return;
    if (this.editorDirty) this.commitEditorPanel();
    if (index === this.activeIndex) return;
    this.saveScroll();
    this.activeIndex = index;
    this.syncActiveSession(false);
  }

  private cycleTab(direction: number): void {
    if (this.sessions.length < 2) return;
    const next = (this.activeIndex + direction + this.sessions.length) % this.sessions.length;
    this.activateSession(next);
  }

  private saveScroll(): void {
    const scroller = this.grid.scrollerElement;
    this.session.scrollTop = scroller.scrollTop;
    this.session.scrollLeft = scroller.scrollLeft;
  }

  /** Point the whole UI at the active session. */
  private syncActiveSession(resetView: boolean): void {
    if (this.sessions.length === 0) {
      this.updateWelcomeState();
      return;
    }
    const session = this.session;
    this.ui.searchInput.value = session.searchValue;
    this.ui.filterSelect.value = session.filterValue;
    this.ui.delimiterSelect.value = session.doc.delimiter;

    this.grid.reset(session.doc);
    if (!resetView) {
      const scroller = this.grid.scrollerElement;
      scroller.scrollTop = session.scrollTop;
      scroller.scrollLeft = session.scrollLeft;
    }

    this.applyFilter();
    this.editorDirty = false;
    this.grid.select(session.selectedRow, session.selectedCol);
    this.lastTabSignature = '';
    this.renderTabs();
    this.loadEditorPanel();
    this.updateStatus();
  }

  private startRename(index: number): void {
    const session = this.sessions[index];
    const tab = this.ui.tabsHost.querySelector(`.tab[data-index="${index}"]`);
    if (!session || !(tab instanceof HTMLElement)) return;
    const labelEl = tab.querySelector('.tab-label');
    if (!(labelEl instanceof HTMLElement)) return;

    const input = el('input', { class: 'tab-rename', type: 'text', spellcheck: 'false' });
    input.value = session.alias ?? session.doc.fileName;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (apply: boolean): void => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      session.alias = apply && value.length > 0 && value !== session.doc.fileName ? value : null;
      this.lastTabSignature = '';
      this.renderTabs();
      if (session.alias !== null) toast(t('tab.renameToast', { name: session.alias }), 'ok');
    };

    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener('blur', () => commit(true));
  }

  private openTabMenu(index: number, x: number, y: number): void {
    const labels = computeTabLabels(this.sessions, this.tabStrings());
    const items: MenuItem[] = [
      { label: t('tabMenu.rename'), hint: t('tabMenu.renameHint'), action: () => this.startRename(index) },
      {
        label: t('tabMenu.copyInfo'),
        action: () => {
          void navigator.clipboard?.writeText(labels[index].detail);
          toast(t('tabMenu.copyInfoDone'), 'ok');
        },
      },
      {
        label: t('tabMenu.markSource'),
        hint: t('tabMenu.markSourceHint'),
        action: () => void this.markSourceDirectory(),
      },
      { label: '-' },
      { label: t('tabMenu.close'), hint: t('hint.altW'), action: () => void this.closeSession(index) },
      {
        label: t('tabMenu.closeOthers'),
        disabled: this.sessions.length < 2,
        action: () => void this.closeOthers(index),
      },
      { label: t('tabMenu.closeAll'), danger: true, action: () => void this.closeAll() },
      { label: '-' },
      {
        label: t('tabMenu.saveAll'),
        hint: t('hint.ctrlShiftS'),
        disabled: !this.anyDirty(),
        action: () => void this.saveAll(),
      },
    ];
    showContextMenu(x, y, items);
  }

  private async closeSession(index: number): Promise<void> {
    const session = this.sessions[index];
    if (!session) return;
    if (index === this.activeIndex && this.editorDirty) this.commitEditorPanel();

    if (session.dirtyCount > 0) {
      const answer = await showChoice(
        t('closeTab.title'),
        t('closeTab.msg', { name: session.doc.fileName, n: session.dirtyCount }),
        [
          { value: 'save', label: t('choice.saveClose'), primary: true },
          { value: 'discard', label: t('choice.discardClose'), danger: true },
          { value: 'cancel', label: t('dialog.cancel') },
        ],
      );
      if (answer === null || answer === 'cancel') return;
      if (answer === 'save') {
        const ok = await this.saveSession(session);
        if (!ok) return; // save failed or was cancelled: keep the tab
      }
    }

    this.sessions.splice(index, 1);
    if (this.sessions.length === 0) {
      this.activeIndex = 0;
      this.lastTabSignature = '';
      this.updateWelcomeState();
      toast(t('tab.closed', { name: session.doc.fileName }), 'info');
      return;
    }
    if (index < this.activeIndex) {
      this.activeIndex -= 1;
    } else if (this.activeIndex >= this.sessions.length) {
      this.activeIndex = this.sessions.length - 1;
    }
    this.lastTabSignature = '';
    this.syncActiveSession(false);
    toast(t('tab.closed', { name: session.doc.fileName }), 'info');
  }

  private async closeOthers(keepIndex: number): Promise<void> {
    const keep = this.sessions[keepIndex];
    if (!keep) return;
    for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
      if (this.sessions[index] === keep) continue;
      const session = this.sessions[index];
      if (session && session.dirtyCount > 0) {
        const answer = await showChoice(
          t('closeOthers.title'),
          t('closeOthers.msg', { name: session.doc.fileName, n: session.dirtyCount }),
          [
            { value: 'save', label: t('choice.saveClose'), primary: true },
            { value: 'discard', label: t('choice.discardOther'), danger: true },
            { value: 'stop', label: t('choice.stopOthers') },
          ],
        );
        if (answer === null || answer === 'stop') return;
        if (answer === 'save' && !(await this.saveSession(session))) continue;
      }
      const at = this.sessions.indexOf(session);
      if (at >= 0) this.sessions.splice(at, 1);
    }
    this.activeIndex = Math.max(0, this.sessions.indexOf(keep));
    this.lastTabSignature = '';
    this.syncActiveSession(false);
  }

  private async closeAll(): Promise<void> {
    for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
      const session = this.sessions[index];
      if (!session) continue;
      if (session.dirtyCount > 0) {
        const answer = await showChoice(
          t('closeAll.title'),
          t('closeOthers.msg', { name: session.doc.fileName, n: session.dirtyCount }),
          [
            { value: 'save', label: t('choice.saveClose'), primary: true },
            { value: 'discard', label: t('choice.discardOther'), danger: true },
            { value: 'stop', label: t('choice.stop') },
          ],
        );
        if (answer === null || answer === 'stop') return;
        if (answer === 'save' && !(await this.saveSession(session))) continue;
      }
      const at = this.sessions.indexOf(session);
      if (at >= 0) this.sessions.splice(at, 1);
    }
    this.activeIndex = 0;
    this.lastTabSignature = '';
    if (this.sessions.length === 0) {
      this.updateWelcomeState();
      return;
    }
    this.syncActiveSession(true);
  }

  // ------------------------------------------------------------------ filter

  private applyFilter(): void {
    if (this.sessions.length === 0) return;
    const needle = this.searchValue.trim().toLowerCase();
    const kind = this.filterValue;
    const indices: number[] = [];

    this.doc.rows.forEach((row, index) => {
      if (kind === 'dirty') {
        if (!this.rowIsDirty(row)) return;
      } else if (kind !== 'all' && row.kind !== kind) {
        return;
      }
      if (needle.length > 0) {
        const hit = row.cells.some((cell) => cell.value.toLowerCase().includes(needle));
        if (!hit) return;
      }
      indices.push(index);
    });

    this.visibleIndices = indices;
    const isEverything = kind === 'all' && needle.length === 0;
    this.grid.setVisible(isEverything ? null : indices);
    this.ui.matchInfo.textContent = isEverything
      ? t('match.all', { n: this.doc.rows.length })
      : t('match.some', { a: indices.length, b: this.doc.rows.length });
  }

  private rowIsDirty(row: Row): boolean {
    return row.cells.some((cell) => cell.dirty);
  }

  private gotoMatch(direction: number): void {
    if (this.visibleIndices.length === 0) return;
    const currentPos = this.visibleIndices.indexOf(this.selectedRow);
    const start = currentPos < 0 ? 0 : currentPos + direction;
    const nextPos =
      ((start % this.visibleIndices.length) + this.visibleIndices.length) %
      this.visibleIndices.length;
    this.grid.select(this.visibleIndices[nextPos], this.selectedCol);
  }

  // --------------------------------------------------------------- selection

  private handleSelect(row: number, col: number): void {
    if (this.sessions.length === 0) return;
    if (this.editorDirty && (this.editorRow !== row || this.editorCol !== col)) {
      this.commitEditorPanel();
    }
    this.selectedRow = row;
    this.selectedCol = col;
    this.loadEditorPanel();
    this.updateStatus();
  }

  private loadEditorPanel(): void {
    if (this.sessions.length === 0) return;
    const row = this.doc.rows[this.selectedRow];
    const cell = row ? row.cells[this.selectedCol] : undefined;
    const name = this.columnNamesDisplay()[this.selectedCol] ?? t('col.placeholder', { n: this.selectedCol + 1 });

    this.editorRow = this.selectedRow;
    this.editorCol = this.selectedCol;
    this.editorDirty = false;
    this.ui.editorArea.value = cell ? cell.value : '';

    this.ui.editorTitle.textContent = t('editor.title', {
      r: this.selectedRow + 1,
      c: this.selectedCol + 1,
      name,
    });

    const flags: string[] = [];
    if (!cell) {
      flags.push(t('editor.flagMissing', { n: row ? row.origFieldCount : 0 }));
    } else {
      const lines = lineCount(cell.value);
      if (lines > 1) flags.push(t('editor.flagLines', { n: lines }));
      if (cell.quoted) flags.push(t('editor.flagQuoted'));
      if (cell.dirty) flags.push(t('editor.flagDirty'));
      if (cell.value.length === 0) flags.push(t('editor.flagEmpty'));
    }
    this.ui.editorFlags.textContent = flags.join(' · ');
    this.ui.editorHint.textContent = cell ? t('editor.hint') : t('editor.hintMissing');
  }

  private commitEditorPanel(): void {
    const value = this.ui.editorArea.value;
    this.editorDirty = false;
    this.editCell(this.editorRow, this.editorCol, value);
  }

  private openInlineEditor(row: number, col: number, initial?: string): void {
    this.grid.openEditor(row, col, (value) => this.editCell(row, col, value), initial);
  }

  // ------------------------------------------------------------------ editing

  private cellKey(row: number, col: number): string {
    return `${row}:${col}`;
  }

  /**
   * Apply a value to a cell while keeping the byte-fidelity bookkeeping honest:
   * an edit drops the cell's verbatim source form (so it re-serializes
   * canonically), and returning to the value the cell had when the file was
   * loaded restores that verbatim form (so an undone edit is byte-identical).
   */
  private writeCell(row: number, col: number, value: string): boolean {
    const target = this.doc.rows[row];
    if (!target) return false;

    let cell = target.cells[col];
    let extended = false;
    if (!cell) {
      while (target.cells.length < col) target.cells.push(makeCell('', this.doc.delimiter));
      cell = makeCell('', this.doc.delimiter);
      target.cells.push(cell);
      target.origFieldCount = target.cells.length;
      extended = true;
    }

    const key = this.cellKey(row, col);
    if (!this.baseline.has(key)) {
      this.baseline.set(key, { value: cell.value, quoted: cell.quoted, raw: cell.raw });
    }
    const snapshot = this.baseline.get(key);
    if (!snapshot) return false;
    if (cell.value === value && !extended) return false;

    if (!extended && value === snapshot.value) {
      cell.value = snapshot.value;
      cell.quoted = snapshot.quoted;
      cell.raw = snapshot.raw;
      cell.dirty = false;
    } else {
      cell.value = value;
      cell.quoted = needsQuoting(value, this.doc.delimiter);
      cell.raw = null;
      cell.dirty = true;
    }
    return true;
  }

  private editCell(row: number, col: number, value: string): void {
    const existing = this.doc.rows[row] ? this.doc.rows[row].cells[col] : undefined;
    const before = existing ? existing.value : '';
    const changed = this.writeCell(row, col, value);

    if (changed) {
      this.undoStack.push({ row, col, before, after: value });
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    this.afterCellChange(row);
    this.loadEditorPanel();
    this.updateStatus();
  }

  /** Row 1 is the header, so it needs a header rebuild rather than a repaint. */
  private afterCellChange(row: number): void {
    if (row === 0) this.grid.refreshHeader();
    else this.grid.refresh();
  }

  private undo(): void {
    if (this.sessions.length === 0) return;
    const record = this.undoStack.pop();
    if (!record) return;
    this.applyRecord(record, record.before);
    this.redoStack.push(record);
  }

  private redo(): void {
    if (this.sessions.length === 0) return;
    const record = this.redoStack.pop();
    if (!record) return;
    this.applyRecord(record, record.after);
    this.undoStack.push(record);
  }

  private applyRecord(record: EditRecord, value: string): void {
    this.writeCell(record.row, record.col, value);
    this.afterCellChange(record.row);
    this.loadEditorPanel();
    this.updateStatus();
  }

  // ------------------------------------------------------------------ context

  private openCellMenu(row: number, col: number, x: number, y: number): void {
    const cell = this.doc.rows[row]?.cells[col];
    const items: MenuItem[] = [
      { label: t('cellMenu.edit'), hint: t('hint.f2'), action: () => this.openInlineEditor(row, col) },
      {
        label: t('cellMenu.copy'),
        disabled: !cell || cell.value.length === 0,
        action: () => {
          if (!cell) return;
          void navigator.clipboard?.writeText(cell.value);
          toast(t('cellMenu.copyDone'), 'ok');
        },
      },
      {
        label: t('cellMenu.clear'),
        disabled: !cell || cell.value.length === 0,
        action: () => this.editCell(row, col, ''),
      },
      { label: '-' },
      { label: t('cellMenu.rowAbove'), action: () => this.insertRow(row) },
      { label: t('cellMenu.rowBelow'), action: () => this.insertRow(row + 1) },
      { label: t('cellMenu.dupRow'), action: () => this.duplicateRow(row) },
      { label: t('cellMenu.delRow'), danger: true, action: () => this.deleteRow(row) },
      { label: '-' },
      { label: t('cellMenu.colRight'), action: () => this.insertColumn(col + 1) },
      {
        label: t('cellMenu.delCol'),
        danger: true,
        disabled: columnCount(this.doc) <= 1,
        action: () => this.deleteColumn(col),
      },
    ];
    showContextMenu(x, y, items);
  }

  private insertRow(at: number): void {
    const reference = this.doc.rows[Math.max(0, Math.min(this.doc.rows.length - 1, at - 1))];
    const fieldCount = reference
      ? Math.max(reference.origFieldCount, reference.cells.length)
      : columnCount(this.doc);
    const values = new Array<string>(fieldCount).fill('');
    this.doc.rows.splice(at, 0, makeRow(values, this.doc.delimiter, 0, false));
    this.applyFilter();
    this.grid.select(at, this.selectedCol);
    this.updateStatus();
    toast(t('op.rowInserted'), 'ok');
  }

  private duplicateRow(at: number): void {
    const source = this.doc.rows[at];
    if (!source) return;
    const copy = makeRow(
      source.cells.map((cell) => cell.value),
      this.doc.delimiter,
      0,
      false,
    );
    this.doc.rows.splice(at + 1, 0, copy);
    this.applyFilter();
    this.grid.select(at + 1, this.selectedCol);
    this.updateStatus();
    toast(t('op.rowDuped'), 'ok');
  }

  private deleteRow(at: number): void {
    if (this.doc.rows.length <= 1) {
      toast(t('op.minOneRow'), 'warn');
      return;
    }
    this.doc.rows.splice(at, 1);
    this.applyFilter();
    this.grid.select(Math.min(at, this.doc.rows.length - 1), this.selectedCol);
    this.updateStatus();
    toast(t('op.rowDeleted'), 'warn');
  }

  private insertColumn(at: number): void {
    for (const row of this.doc.rows) {
      while (row.cells.length < at) row.cells.push(makeCell('', this.doc.delimiter));
      row.cells.splice(at, 0, makeCell('', this.doc.delimiter));
      row.origFieldCount = Math.max(row.origFieldCount, row.cells.length);
    }
    this.grid.reset(this.doc);
    this.applyFilter();
    this.updateStatus();
    toast(t('op.colInserted'), 'ok');
  }

  private deleteColumn(at: number): void {
    if (columnCount(this.doc) <= 1) return;
    for (const row of this.doc.rows) {
      if (at < row.cells.length) row.cells.splice(at, 1);
      row.origFieldCount = Math.min(row.origFieldCount, row.cells.length);
    }
    this.grid.reset(this.doc);
    this.applyFilter();
    this.updateStatus();
    toast(t('op.colDeleted'), 'warn');
  }

  // ------------------------------------------------------------------ file io

  private async doOpen(): Promise<void> {
    try {
      const loaded = await pickFileToOpen();
      if (loaded === null) return; // cancelled
      await this.applyLoaded(loaded);
    } catch (error) {
      toast(t('open.failed', { error: describeError(error) }), 'warn');
    }
  }

  private async handleDrop(event: DragEvent): Promise<void> {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const item = transfer.items[0];
    const getter = item ? item.getAsFileSystemHandle : undefined;

    // Preferred: a writable handle, so the dropped file can be saved in place.
    if (item && typeof getter === 'function') {
      try {
        const handle = await getter.call(item);
        if (handle && handle.kind === 'file') {
          if (this.editorDirty) this.commitEditorPanel();
          await this.applyLoaded(await readHandle(handle as FileSystemFileHandle));
          return;
        }
      } catch (error) {
        toast(t('drop.failed', { error: describeError(error) }), 'warn');
        return;
      }
    }

    // Fallback: a plain File without a write-back handle. WebView2 may not
    // expose getAsFileSystemHandle even though HTML5 drops reach the page; the
    // file still opens, and saving degrades to the Save As picker — the same
    // behaviour as browsers without File System Access.
    const plain = transfer.files[0];
    if (plain) {
      if (this.editorDirty) this.commitEditorPanel();
      await this.applyLoaded({
        handle: null,
        name: plain.name,
        bytes: new Uint8Array(await plain.arrayBuffer()),
        size: plain.size,
        mtime: plain.lastModified,
      });
      return;
    }

    toast(t('drop.file'), 'warn');
  }

  /** Parse freshly read bytes, confirm the delimiter, then open it in a new tab. */
  private async applyLoaded(loaded: LoadedFile): Promise<void> {
    const parsed = parseCsvBytes(loaded.bytes, loaded.name);

    const chosen = await showOpenDialog({
      fileName: loaded.name,
      candidates: delimiterCandidates(parsed.text),
      encoding: parsed.doc.encoding,
      eol: parsed.doc.eol,
      previewLines: previewLinesOf(parsed, 8),
      note: parsed.warnings.length > 0 ? parsed.warnings.join(' ／ ') : t('open.noteDefault'),
      splitLine: splitPreviewLine,
    });
    if (chosen === null) return; // cancelled: nothing changes

    const doc =
      chosen === parsed.doc.delimiter
        ? parsed.doc
        : parseCsvText(parsed.text, loaded.name, {
            delimiter: chosen,
            encoding: parsed.doc.encoding,
          }).doc;

    if (this.editorDirty) this.commitEditorPanel();

    const session = new DocumentSession(this.nextSessionId, doc, this.nextAccent);
    this.nextSessionId += 1;
    this.nextAccent += 1;
    session.loadedText = parsed.text;
    session.fileHandle = loaded.handle;
    session.mtime = loaded.mtime;
    session.size = loaded.size;
    // Baseline for outside-change detection, updated again after every save.
    session.diskMtime = loaded.mtime;
    session.diskSize = loaded.size;

    const current = this.sessions[this.activeIndex];
    const replaceSample =
      this.sessions.length === 1 &&
      current !== undefined &&
      current.isSample &&
      current.fileHandle === null;
    if (replaceSample) {
      // Do not leave the untouched welcome tab lying around.
      this.sessions[this.activeIndex] = session;
    } else {
      this.sessions.push(session);
      this.activeIndex = this.sessions.length - 1;
    }

    // Recover the relative path if a source directory has already been granted.
    if (this.sourceDirectory !== null && session.fileHandle !== null) {
      session.sourcePath = await resolveWithin(this.sourceDirectory, session.fileHandle);
    }

    this.lastTabSignature = '';
    this.updateWelcomeState();
    this.syncActiveSession(true);

    if (loaded.handle === null) {
      toast(t('open.readonly', { name: loaded.name }), 'warn');
    } else {
      toast(
        t('open.ok', {
          name: loaded.name,
          rows: this.doc.rows.length,
          cols: columnCount(this.doc),
          delim: delimiterGlyph(this.doc.delimiter),
        }),
        'ok',
      );
    }
    for (const warning of parsed.warnings) toast(warning, 'warn');
  }

  private async switchDelimiter(next: Delimiter): Promise<void> {
    if (this.sessions.length === 0) return;
    if (next === this.doc.delimiter) return;

    if (this.loadedText === null) {
      // Sample document: nothing to re-parse, but the stored source slices were
      // taken with the old delimiter and can no longer be replayed safely.
      this.doc.delimiter = next;
      clearRawForms(this.doc);
    } else {
      if (this.session.dirtyCount > 0) {
        const proceed = await showConfirm(
          t('reparse.title'),
          t('reparse.msg', { delim: delimiterGlyph(next), n: this.session.dirtyCount }),
          t('choice.reparse'),
        );
        if (!proceed) {
          this.ui.delimiterSelect.value = this.doc.delimiter;
          return;
        }
      }
      const reparsed = parseCsvText(this.loadedText, this.doc.fileName, {
        delimiter: next,
        encoding: this.doc.encoding,
      });
      reparsed.doc.filePath = this.doc.filePath;
      this.doc = reparsed.doc;
      this.session.resetHistory();
    }

    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.grid.reset(this.doc);
    this.applyFilter();
    this.editorDirty = false;
    this.grid.select(0, 0);
    toast(t('delim.switched', { delim: delimiterGlyph(next) }), 'info');
  }

  /** Save one specific session (not necessarily the visible one). */
  private async saveSession(session: DocumentSession): Promise<boolean> {
    if (session.fileHandle === null) {
      if (session.loadedText === null) {
        toast(t('sample.only'), 'warn');
        return false;
      }
      if (session !== this.session) this.activateSession(this.sessions.indexOf(session));
      return this.doSaveAs();
    }

    const handle = session.fileHandle;
    try {
      if (!(await ensureWritable(handle))) {
        toast(t('save.noPermission'), 'warn');
        return false;
      }

      // Re-read the file's state BEFORE anything else. getFile() is what
      // refreshes the snapshot Chromium caches per handle — without it,
      // createWritable() can refuse with "the state had changed since it was
      // read from disk". The same call also tells us whether something else
      // modified the file while we had it open.
      const before = await statFile(handle);
      const sizeChanged = session.diskSize !== null && before.size !== session.diskSize;
      const mtimeChanged = session.diskMtime !== null && before.mtime !== session.diskMtime;
      if (session.diskSize !== null && (sizeChanged || mtimeChanged)) {
        const detail = sizeChanged
          ? t('external.sizeChanged', { a: session.diskSize, b: before.size })
          : t('external.mtimeOnly', { size: before.size, stamp: formatStamp(before.mtime) });
        const answer = await showChoice(t('external.title'), t('external.msg', { name: handle.name, detail }), [
          { value: 'overwrite', label: t('choice.overwrite'), primary: true },
          { value: 'saveAs', label: t('choice.saveAs') },
          { value: 'cancel', label: t('dialog.cancel') },
        ]);
        if (answer === null || answer === 'cancel') return false;
        if (answer === 'saveAs') return this.doSaveAs();
      }

      const bytes = serializeCsvBytes(session.doc);
      const backupNote = await this.writeBackup(session, handle);
      // The backup picker can sit open for a while; the file may have changed
      // again in that window, so check once more before overwriting.
      const mid = await statFile(handle);
      if (mid.size !== before.size || mid.mtime !== before.mtime) {
        const answer = await showChoice(
          t('mid.title'),
          t('mid.msg', { name: handle.name, size: mid.size }),
          [
            { value: 'overwrite', label: t('choice.overwrite'), primary: true },
            { value: 'saveAs', label: t('choice.saveAs') },
            { value: 'cancel', label: t('dialog.cancel') },
          ],
        );
        if (answer === null || answer === 'cancel') return false;
        if (answer === 'saveAs') return this.doSaveAs();
      }
      await writeBytesResilient(handle, bytes);

      // Remember what is on disk now, so the next save can detect outside edits.
      const after = await statFile(handle);
      session.diskSize = after.size;
      session.diskMtime = after.mtime;
      session.markSaved();
      if (session === this.session) {
        this.lastTabSignature = '';
        this.renderTabs();
        this.updateStatus();
      }
      toast(
        t('save.ok', { name: handle.name, backup: backupNote }),
        backupNote.includes('未生成') ? 'warn' : 'ok',
      );
      return true;
    } catch (error) {
      if (isStaleHandleError(error)) {
        // Refreshing and retrying was not enough: something is actively
        // rewriting this file. Never trap the user's edits — offer a way out.
        const answer = await showChoice(t('stuck.title'), t('stuck.msg', { name: handle.name }), [
          { value: 'saveAs', label: t('choice.saveAs'), primary: true },
          { value: 'retry', label: t('choice.retry') },
          { value: 'cancel', label: t('dialog.cancel') },
        ]);
        if (answer === 'saveAs') {
          if (session !== this.session) this.activateSession(this.sessions.indexOf(session));
          return this.doSaveAs();
        }
        if (answer === 'retry') return this.saveSession(session);
        return false;
      }
      toast(t('save.failed', { error: describeError(error) }), 'warn');
      return false;
    }
  }

  private async saveActive(): Promise<boolean> {
    if (this.sessions.length === 0) {
      toast(t('save.nothingOpen'), 'info');
      return false;
    }
    return this.saveSession(this.session);
  }

  private async saveAll(): Promise<void> {
    let saved = 0;
    let skipped = 0;
    for (const session of [...this.sessions]) {
      if (session.dirtyCount === 0) continue;
      if (await this.saveSession(session)) saved += 1;
      else skipped += 1;
    }
    if (saved === 0 && skipped === 0) {
      toast(t('saveAll.none'), 'info');
      return;
    }
    toast(
      t('saveAll.done', { a: saved, skip: skipped > 0 ? t('saveAll.skip', { n: skipped }) : '' }),
      skipped > 0 ? 'warn' : 'ok',
    );
  }

  /**
   * Copy the file's CURRENT contents to the .bak before it is overwritten.
   * The destination is asked once per file (pre-filled with the same folder) and
   * then reused, so the steady-state flow is a silent write.
   */
  private async writeBackup(
    session: DocumentSession,
    handle: FileSystemFileHandle,
  ): Promise<string> {
    if (!this.ui.backupToggle.checked) return '';

    try {
      let target = session.backupHandle;
      if (target === null) {
        target = await pickBackupTarget(`${handle.name}.bak`, handle);
        if (target === null) return t('save.backupNone');
        session.backupHandle = target;
      }
      // Read what is on disk right now — that is the content worth backing up.
      // The resilient write also covers the .bak handle going stale, which
      // happens on every save after the first (we wrote it ourselves last time).
      const previous = await readBytes(handle);
      await writeBytesResilient(target, previous);
      return t('save.backupWith', { name: target.name });
    } catch (error) {
      // A batch "save all" has no fresh user gesture for the picker; skipping the
      // backup must not block the save itself.
      return t('save.backupFail', { error: describeError(error) });
    }
  }

  private async doSaveAs(): Promise<boolean> {
    if (this.sessions.length === 0) return false;
    const session = this.session;
    try {
      const bytes = serializeCsvBytes(session.doc);
      const suggested = session.doc.fileName.toLowerCase().endsWith('.csv')
        ? session.doc.fileName
        : `${session.doc.fileName}.csv`;

      const target = await pickSaveTarget(suggested, session.fileHandle ?? undefined);
      if (target === null) {
        if (canWriteInPlace()) return false; // user cancelled the picker
        downloadBytes(suggested, bytes);
        toast(t('open.readonly', { name: suggested }), 'warn');
        return false;
      }

      await writeBytesResilient(target, bytes);
      const saved = await statFile(target);
      session.diskSize = saved.size;
      session.diskMtime = saved.mtime;
      session.fileHandle = target;
      session.backupHandle = null;
      session.doc.fileName = target.name;
      session.doc.filePath = null;
      session.markSaved();
      this.lastTabSignature = '';
      this.renderTabs();
      this.updateStatus();
      toast(t('save.asOk', { name: target.name }), 'ok');
      return true;
    } catch (error) {
      toast(t('save.asFailed', { error: describeError(error) }), 'warn');
      return false;
    }
  }

  /**
   * Ask for a source directory and use it to recover relative paths.
   *
   * This is the only way to know where a file lives: a handle exposes just its
   * name. Nothing is browsed or written; the grant is read-only and only feeds
   * `resolve()`.
   */
  private async markSourceDirectory(): Promise<void> {
    if (typeof window.showDirectoryPicker !== 'function') {
      toast(t('source.unsupported'), 'warn');
      return;
    }
    try {
      const directory = await pickSourceDirectory();
      if (directory === null) return;

      this.sourceDirectory = directory;
      let resolved = 0;
      for (const session of this.sessions) {
        if (session.fileHandle === null) {
          session.sourcePath = null;
          continue;
        }
        session.sourcePath = await resolveWithin(directory, session.fileHandle);
        if (session.sourcePath !== null) resolved += 1;
      }

      this.lastTabSignature = '';
      this.renderTabs();
      toast(
        t('source.granted', {
          name: directory.name,
          n: resolved,
          extra: resolved < this.sessions.length ? t('source.outside') : '',
        }),
        resolved > 0 ? 'ok' : 'warn',
      );
    } catch (error) {
      toast(t('source.failed', { error: describeError(error) }), 'warn');
    }
  }

  // ------------------------------------------------------------------ status

  private channelText(): string {
    if (this.loadedText === null) return t('channel.sample');
    if (this.fileHandle === null || !canWriteInPlace()) return t('channel.readonly');
    return t('channel.writable');
  }

  private updateStatus(): void {
    if (this.sessions.length === 0) {
      this.updateWelcomeState();
      return;
    }
    const session = this.session;
    const dirty = session.dirtyCount;
    const columns = columnCount(this.doc);
    const name = this.columnNamesDisplay()[this.selectedCol] ?? t('col.placeholder', { n: this.selectedCol + 1 });
    const visibleNote =
      this.visibleIndices.length === this.doc.rows.length
        ? ''
        : t('status.visible', { n: this.visibleIndices.length });
    const tabNote =
      this.sessions.length > 1
        ? t('status.tabs', { i: this.activeIndex + 1, n: this.sessions.length })
        : '';

    this.ui.status.textContent = t('status.line', {
      rows: this.doc.rows.length,
      cols: columns,
      visible: visibleNote,
      tabs: tabNote,
      dirty,
      r: this.selectedRow + 1,
      c: this.selectedCol + 1,
      name,
      delim: delimiterGlyph(this.doc.delimiter),
      enc: encodingLabel(this.doc.encoding),
      eol: eolLabel(this.doc.eol),
    });

    this.ui.fileName.textContent = this.doc.fileName;
    this.ui.encodingLabel.textContent = encodingLabel(this.doc.encoding);
    this.ui.eolLabel.textContent = eolLabel(this.doc.eol);
    this.ui.channelBadge.textContent = this.channelText();
    this.ui.channelBadge.classList.toggle('proto-badge-muted', session.isSample);
    this.ui.undoBtn.disabled = this.undoStack.length === 0;
    this.ui.redoBtn.disabled = this.redoStack.length === 0;
    this.ui.dirtyChip.classList.toggle('hidden', dirty === 0);
    this.ui.saveState.classList.remove('hidden');
    this.ui.saveState.textContent = dirty === 0 ? t('chip.saved') : t('chip.unsavedN', { n: dirty });
    this.ui.saveState.className = dirty === 0 ? 'chip chip-saved' : 'chip chip-unsaved';

    // Keeps the tab strip in step with the dirty markers.
    this.renderTabs();
  }

  get document(): CsvDocument {
    return this.doc;
  }

  get sessionCount(): number {
    return this.sessions.length;
  }

  get rootElement(): HTMLElement {
    return this.root;
  }
}
