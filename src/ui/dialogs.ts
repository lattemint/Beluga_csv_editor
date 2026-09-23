/** Modal dialogs, context menu and toasts. All user-visible text goes through i18n. */
import type { Delimiter, Encoding, Eol } from '../core/model.ts';
import { DELIMITERS, encodingLabel, eolLabel } from '../core/model.ts';
import { t } from './i18n.ts';
import { el } from './dom.ts';

export interface DelimiterCandidate {
  value: Delimiter;
  glyph: string;
  label: string;
  columns: number;
  consistent: boolean;
  recommended: boolean;
  note: string;
}

export interface OpenDialogOptions {
  fileName: string;
  candidates: readonly DelimiterCandidate[];
  encoding: Encoding;
  eol: Eol;
  /** Raw sample lines; the dialog re-splits them live for preview. */
  previewLines: readonly string[];
  /** Explanation shown under the delimiter list. */
  note: string;
  /**
   * Quote-aware splitter for the preview. Falls back to a naive split, which is
   * fine for prose but miscounts delimiters that sit inside quoted fields.
   */
  splitLine?: (line: string, delimiter: Delimiter) => string[];
}

// --------------------------------------------------------------------- toast

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'ok' | 'warn' = 'info'): void {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const item = el('div', { class: `toast toast-${kind}`, text: message });
  toastHost.append(item);
  window.setTimeout(() => item.classList.add('toast-out'), 2600);
  window.setTimeout(() => item.remove(), 3100);
}

// -------------------------------------------------------------------- modal

interface ModalParts {
  overlay: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
  /**
   * What a backdrop click (or Escape) should do. Defaults to a plain close;
   * every dialog that returns a promise must override it, otherwise dismissing
   * the dialog would leave its promise pending forever.
   */
  onDismiss: () => void;
}

function buildModal(title: string, subtitle: string): ModalParts {
  const body = el('div', { class: 'modal-body' });
  const footer = el('div', { class: 'modal-footer' });
  const panel = el('div', { class: 'modal' }, [
    el('div', { class: 'modal-head' }, [
      el('div', { class: 'modal-title', text: title }),
      el('div', { class: 'modal-sub', text: subtitle }),
    ]),
    body,
    footer,
  ]);
  const overlay = el('div', { class: 'modal-overlay' }, [panel]);
  document.body.append(overlay);

  const close = () => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  };

  const parts: ModalParts = {
    overlay,
    body,
    footer,
    close,
    onDismiss: close,
  };

  // The overlay is not focusable, so Escape has to be caught on the window.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') parts.onDismiss();
  };
  window.addEventListener('keydown', onKey);

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) parts.onDismiss();
  });

  return parts;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', { class: cls, type: 'button', text: label });
  btn.addEventListener('click', onClick);
  return btn;
}

// ------------------------------------------------------- open / delimiter UI

/** Prototype-only naive splitter used purely for the dialog preview. */
function naiveSplit(line: string, delimiter: Delimiter): string[] {
  return line.split(delimiter).map((part) => {
    const trimmed = part.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  });
}

export function showOpenDialog(options: OpenDialogOptions): Promise<Delimiter | null> {
  return new Promise((resolve) => {
    const parts = buildModal(t('dialog.openTitle'), options.fileName);
    parts.onDismiss = () => {
      parts.close();
      resolve(null);
    };

    let chosen: Delimiter =
      options.candidates.find((c) => c.recommended)?.value ?? options.candidates[0]?.value ?? ',';

    parts.body.append(
      el('div', { class: 'field-label', text: t('dialog.detected') }),
      el('div', { class: 'hint', text: options.note }),
    );

    const list = el('div', { class: 'candidate-list' });

    const previewBox = el('div', { class: 'preview-box' });
    const splitLine = options.splitLine ?? naiveSplit;
    const renderPreview = () => {
      while (previewBox.firstChild) previewBox.removeChild(previewBox.firstChild);
      const table = el('table', { class: 'preview-table' });
      options.previewLines.slice(0, 6).forEach((line, index) => {
        const tr = el('tr');
        tr.append(el('td', { class: 'preview-num', text: String(index + 1) }));
        const cells = splitLine(line, chosen);
        const shown = Math.min(cells.length, 9);
        for (let i = 0; i < shown; i += 1) {
          tr.append(el('td', { class: 'preview-cell', text: cells[i], title: cells[i] }));
        }
        if (cells.length > shown) {
          tr.append(el('td', { class: 'preview-more', text: `+${cells.length - shown}` }));
        }
        table.append(tr);
      });
      previewBox.append(table);
    };

    for (const candidate of options.candidates) {
      const input = el('input', { type: 'radio', name: 'delimiter' });
      input.checked = candidate.value === chosen;
      input.addEventListener('change', () => {
        if (input.checked) {
          chosen = candidate.value;
          renderPreview();
        }
      });

      const row = el('label', { class: 'candidate' }, [
        input,
        el('span', { class: 'candidate-glyph', text: candidate.glyph }),
        el('span', { class: 'candidate-label', text: candidate.label }),
        el('span', {
          class: `candidate-stat${candidate.consistent ? ' ok' : ' bad'}`,
          text: `${candidate.columns} 列 · ${candidate.note}`,
        }),
      ]);
      if (candidate.recommended) row.classList.add('recommended');
      list.append(row);
    }

    parts.body.append(list);

    parts.body.append(
      el('div', { class: 'meta-grid' }, [
        el('div', { class: 'meta-key', text: t('dialog.encoding') }),
        el('div', { class: 'meta-val', text: encodingLabel(options.encoding) }),
        el('div', { class: 'meta-key', text: t('dialog.eol') }),
        el('div', { class: 'meta-val', text: eolLabel(options.eol) }),
        el('div', { class: 'meta-key', text: t('dialog.quoting') }),
        el('div', { class: 'meta-val', text: t('dialog.quotingValue') }),
      ]),
    );

    parts.body.append(el('div', { class: 'field-label', text: t('dialog.preview') }), previewBox);
    renderPreview();

    parts.footer.append(
      button(t('dialog.cancel'), 'btn', () => {
        parts.close();
        resolve(null);
      }),
      button(t('dialog.open'), 'btn btn-primary', () => {
        parts.close();
        resolve(chosen);
      }),
    );
  });
}

// -------------------------------------------------------------- multi-choice

export interface ChoiceOption {
  value: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

/** A modal with N labelled outcomes. Resolves null when dismissed. */
export function showChoice(
  title: string,
  message: string,
  options: readonly ChoiceOption[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const parts = buildModal(title, '');
    parts.onDismiss = () => {
      parts.close();
      resolve(null);
    };

    parts.body.append(el('div', { class: 'confirm-text', text: message }));
    for (const option of options) {
      const cls = option.primary ? 'btn btn-primary' : option.danger ? 'btn btn-danger' : 'btn';
      parts.footer.append(
        button(option.label, cls, () => {
          parts.close();
          resolve(option.value);
        }),
      );
    }
  });
}

export function showConfirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parts = buildModal(title, '');
    parts.onDismiss = () => {
      parts.close();
      resolve(false);
    };
    parts.body.append(el('div', { class: 'confirm-text', text: message }));
    parts.footer.append(
      button(t('dialog.cancel'), 'btn', () => {
        parts.close();
        resolve(false);
      }),
      button(confirmLabel, 'btn btn-primary', () => {
        parts.close();
        resolve(true);
      }),
    );
  });
}

/** Informational modal with a single close button (About, etc.). */
export function showInfo(title: string, body: string): void {
  const parts = buildModal(title, '');
  parts.body.append(el('div', { class: 'confirm-text about-body', text: body }));
  parts.footer.append(
    button(t('dialog.cancel'), 'btn btn-primary', () => {
      parts.close();
    }),
  );
}

// ------------------------------------------------------------ context menu

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Omitted for separators (label: '-') and other display-only entries. */
  action?: () => void;
}

let openMenu: HTMLElement | null = null;

export function showContextMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeContextMenu();
  const menu = el('div', { class: 'context-menu' });
  for (const item of items) {
    if (item.label === '-') {
      menu.append(el('div', { class: 'menu-sep' }));
      continue;
    }
    const entry = el('button', {
      class: `menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`,
      type: 'button',
    });
    entry.append(el('span', { class: 'menu-label', text: item.label }));
    if (item.hint) entry.append(el('span', { class: 'menu-hint', text: item.hint }));
    const run = item.action;
    if (!item.disabled && run) {
      entry.addEventListener('click', () => {
        closeContextMenu();
        run();
      });
    }
    menu.append(entry);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 10)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 10)}px`;
  openMenu = menu;

  const onDown = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) closeContextMenu();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeContextMenu();
  };
  window.setTimeout(() => {
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
  }, 0);
}

export function closeContextMenu(): void {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
}

export { DELIMITERS };
