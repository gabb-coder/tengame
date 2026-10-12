import { labelOf, onKeys } from '../keys.ts';
import { DEFAULT_SETTINGS, onSettings, type Settings, settings, updateSettings } from '../settings.ts';
import { KeysPage } from './keysPage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SECTIONS = ['main', 'settings', 'keys', 'journal', 'confirm'] as const;
type Section = (typeof SECTIONS)[number];

/** How each slider's value reads next to it. */
const FORMAT: Partial<Record<keyof Settings, (v: number) => string>> = {
  volume: (v) => `${Math.round(v * 100)}%`,
  ambience: (v) => `${Math.round(v * 100)}%`,
  mouseSensitivity: (v) => `${v.toFixed(2)}×`,
  fov: (v) => `${v}°`,
};

/**
 * The in-game menu (Esc or the Menu button): resume, settings, and leaving the room
 * for the main menu. The game keeps running underneath, since others are still playing.
 */
export class Menu {
  private root = $('menu');
  /** Which page of the menu is showing. */
  section: Section = 'main';
  /** Called when the menu opens or closes. */
  onToggle: (open: boolean) => void = () => {};

  /** The Keys page, where the game has one (free roam and missions, on a computer). */
  private keys: KeysPage | null = null;

  constructor(roomCode: string, opts: { keys?: boolean } = {}) {
    $('menu-room').textContent = roomCode;
    if (opts.keys) {
      this.keys = new KeysPage();
      $('settings-keys').hidden = false;
      $('settings-keys').addEventListener('click', () => this.show('keys'));
      $('keys-back').addEventListener('click', () => this.show('settings'));
      onKeys(() => ($('menu-journal-key').textContent = labelOf('journal') ? `(${labelOf('journal')})` : ''));
    }
    $('menu-button').addEventListener('click', () => this.open());
    $('menu-resume').addEventListener('click', () => this.close());
    $('menu-open-settings').addEventListener('click', () => this.show('settings'));
    $('menu-open-journal').addEventListener('click', () => this.show('journal'));
    $('journal-back').addEventListener('click', () => this.close());
    $('settings-back').addEventListener('click', () => this.show('main'));
    // Keys have their own reset, on their page.
    $('settings-reset').addEventListener('click', () => updateSettings({ ...DEFAULT_SETTINGS, keys: settings.keys }));
    $('menu-leave').addEventListener('click', () => this.show('confirm'));
    $('leave-cancel').addEventListener('click', () => this.show('main'));
    // Back to the title screen: a fresh page without the room in the address.
    $('leave-confirm').addEventListener('click', () => (location.href = location.pathname));
    // Clicking the dimmed background closes it.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.bindSettings();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(section: Section = 'main'): void {
    if (!this.isOpen) {
      this.root.hidden = false;
      document.exitPointerLock?.();
      this.onToggle(true);
    }
    this.show(section);
  }

  close(): void {
    if (!this.isOpen) return;
    this.keys?.stop();
    this.root.hidden = true;
    this.onToggle(false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private show(section: Section): void {
    for (const s of SECTIONS) $(`menu-${s}`).hidden = s !== section;
    if (section === 'keys') this.keys?.reset();
    else this.keys?.stop();
    this.section = section;
    const focus = { main: 'menu-resume', settings: 'set-volume', keys: 'key-forward', journal: 'journal-tab-relics', confirm: 'leave-cancel' }[section];
    $(focus).focus();
    this.root.querySelector('.menu-card')!.scrollTop = 0;
  }

  /** Each control with id "set-<name>" edits that setting. */
  private bindSettings(): void {
    const controls = [...this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[id^="set-"]')];
    for (const el of controls) {
      const key = el.id.slice(4) as keyof Settings;
      el.addEventListener('input', () => {
        const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
        updateSettings({ [key]: value } as Partial<Settings>);
      });
    }
    onSettings((s) => {
      for (const el of controls) {
        const key = el.id.slice(4) as keyof Settings;
        const value = s[key];
        if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(value);
        else el.value = String(value);
        const out = el.parentElement?.querySelector('output');
        if (out) out.textContent = FORMAT[key]?.(Number(value)) ?? String(value);
      }
    });
  }
}
