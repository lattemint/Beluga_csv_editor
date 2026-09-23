/**
 * Theme selection.
 *
 * `auto` is resolved here and never reaches CSS: the inline script in
 * index.html performs the same resolution before first paint, so a dark-theme
 * user never sees a white flash. This module keeps things in sync afterwards and
 * remembers the choice.
 */

export type ThemeChoice = 'auto' | 'light' | 'dark' | 'nord' | 'nord-light';
export type ResolvedTheme = Exclude<ThemeChoice, 'auto'>;

export interface ThemeOption {
  id: ThemeChoice;
  /** i18n keys; resolved by the caller so the picker can be relabelled live. */
  labelKey: 'theme.auto' | 'theme.light' | 'theme.dark' | 'theme.nord' | 'theme.nordLight';
  hintKey: 'theme.autoHint' | 'theme.lightHint' | 'theme.darkHint' | 'theme.nordHint' | 'theme.nordLightHint';
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'auto', labelKey: 'theme.auto', hintKey: 'theme.autoHint' },
  { id: 'light', labelKey: 'theme.light', hintKey: 'theme.lightHint' },
  { id: 'dark', labelKey: 'theme.dark', hintKey: 'theme.darkHint' },
  { id: 'nord', labelKey: 'theme.nord', hintKey: 'theme.nordHint' },
  { id: 'nord-light', labelKey: 'theme.nordLight', hintKey: 'theme.nordLightHint' },
];

/** Must match the inline script in index.html. */
const STORAGE_KEY = 'csv-editor.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const prefersDark = window.matchMedia(DARK_QUERY);

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'auto') return choice;
  return prefersDark.matches ? 'dark' : 'light';
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeChoice = choice;
  return resolved;
}

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null && THEMES.some((option) => option.id === stored)) {
      return stored as ThemeChoice;
    }
  } catch {
    // Private mode / storage disabled: fall through to the default.
  }
  return 'auto';
}

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not being able to persist the choice is not worth interrupting the user.
  }
}

/** Re-resolve when the OS flips light/dark while "auto" is selected. */
export function watchSystemTheme(): void {
  prefersDark.addEventListener('change', () => {
    if (readThemeChoice() === 'auto') applyTheme('auto');
  });
}
