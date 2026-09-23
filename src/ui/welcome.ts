/**
 * Welcome screen, shown before any file is open.
 *
 * Deliberately modelled on the kind of "new session" landing page a launcher
 * shows: one centred card, a handful of large options, no toolbar chrome. The
 * editor shell takes over as soon as a file (or the sample) is opened.
 */
import type { MessageKey } from './i18n.ts';
import { t } from './i18n.ts';
import { el } from './dom.ts';

export interface WelcomeHooks {
  onOpenFile(): void;
  onSample(): void;
  onLanguage(): void;
  onAbout(): void;
}

export function renderWelcome(host: HTMLElement, hooks: WelcomeHooks): void {
  while (host.firstChild) host.removeChild(host.firstChild);

  const options: {
    icon: string;
    labelKey: MessageKey;
    descKey: MessageKey;
    action: () => void;
  }[] = [
    {
      icon: '📂',
      labelKey: 'welcome.open',
      descKey: 'welcome.openDesc',
      action: hooks.onOpenFile,
    },
    {
      icon: '📄',
      labelKey: 'welcome.sample',
      descKey: 'welcome.sampleDesc',
      action: hooks.onSample,
    },
    {
      icon: '🌐',
      labelKey: 'welcome.language',
      descKey: 'welcome.languageDesc',
      action: hooks.onLanguage,
    },
    {
      icon: 'ℹ️',
      labelKey: 'welcome.about',
      descKey: 'welcome.aboutDesc',
      action: hooks.onAbout,
    },
  ];

  const grid = el('div', { class: 'welcome-grid' });
  for (const option of options) {
    const card = el('button', { class: 'welcome-option', type: 'button' }, [
      el('span', { class: 'welcome-option-icon', text: option.icon }),
      el('span', { class: 'welcome-option-text' }, [
        el('span', { class: 'welcome-option-label', text: t(option.labelKey) }),
        el('span', { class: 'welcome-option-desc', text: t(option.descKey) }),
      ]),
    ]);
    card.addEventListener('click', () => option.action());
    grid.append(card);
  }

  host.append(
    el('div', { class: 'welcome' }, [
      el('div', { class: 'welcome-mark', text: 'CSV' }),
      el('h1', { class: 'welcome-title', text: 'Beluga CSV Editor' }),
      el('p', { class: 'welcome-tagline', text: t('app.tagline') }),
      grid,
      el('p', {
        class: 'welcome-foot',
        text: `${t('welcome.version', { v: '0.1.1' })} · ${t('app.dropHint')}`,
      }),
    ]),
  );
}
