import { ACTION_IDS, ACTIONS, type Action, changedKeys, currentKeys, DEFAULT_KEYS, GROUPS, keyLabel, normalizeCode, onKeys, rebind, refusal } from '../keys.ts';
import { updateSettings } from '../settings.ts';

/** A click that sets a mouse button also ends in a click on the box: not a new start. */
const AFTER_MOUSE_MS = 500;

/**
 * The menu's Keys page: what every key does, each key in a box. Click a box, then press
 * the key you want (or click the box with the mouse button you want); Esc cancels.
 */
export class KeysPage {
  private note = document.getElementById('keys-note')!;
  private buttons = new Map<Action, HTMLButtonElement>();
  /** The box waiting for a key, if any. */
  private listening: Action | null = null;
  private setByMouseAt = -Infinity;

  constructor() {
    const list = document.getElementById('keys-list')!;
    for (const { group, title } of GROUPS) {
      const heading = document.createElement('h3');
      heading.textContent = title;
      const rows = document.createElement('div');
      rows.className = 'keys-list';
      for (const action of ACTION_IDS.filter((a) => ACTIONS[a].group === group)) {
        const row = document.createElement('div');
        row.className = 'key-row';
        const name = document.createElement('span');
        name.id = `key-name-${action}`;
        name.textContent = ACTIONS[action].label;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `key-${action}`;
        button.setAttribute('aria-describedby', name.id);
        button.addEventListener('click', () => {
          if (performance.now() - this.setByMouseAt > AFTER_MOUSE_MS) this.listen(action);
        });
        // Any mouse button on the waiting box is the one it gets.
        button.addEventListener('mousedown', (e) => {
          if (this.listening !== action) return;
          e.preventDefault();
          this.setByMouseAt = performance.now();
          this.assign(action, `Mouse${e.button}`);
        });
        button.addEventListener('contextmenu', (e) => e.preventDefault());
        row.append(name, button);
        rows.append(row);
        this.buttons.set(action, button);
      }
      list.append(heading, rows);
    }
    document.getElementById('keys-reset')!.addEventListener('click', () => {
      this.stop();
      updateSettings({ keys: {} });
      this.say('All keys are back to how they started.');
    });

    // While a box waits, the next key is for it, not for the game or the menu.
    addEventListener(
      'keydown',
      (e) => {
        if (!this.listening) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') this.stop();
        else if (!e.repeat) this.assign(this.listening, normalizeCode(e.code));
      },
      { capture: true },
    );
    // Clicking anywhere else stops waiting.
    addEventListener(
      'mousedown',
      (e) => {
        if (this.listening && e.target !== this.buttons.get(this.listening)) this.stop();
      },
      { capture: true },
    );
    onKeys(() => this.render());
  }

  /** Stops waiting for a key (leaving the page, say). */
  stop(): void {
    this.listening = null;
    this.render();
  }

  /** Clears the note (on opening the page). */
  reset(): void {
    this.stop();
    this.say('');
  }

  private listen(action: Action): void {
    this.listening = action;
    this.say('');
    this.render();
  }

  private assign(action: Action, code: string): void {
    const no = refusal(action, code);
    if (no) {
      this.say(`${no}. Try another, or press Esc.`);
      return;
    }
    const { keys, moved } = rebind(currentKeys(), action, code);
    this.listening = null;
    updateSettings({ keys: changedKeys(keys) });
    const lines = [`${ACTIONS[action].label} is on ${keyLabel(code)} now.`];
    for (const m of moved) {
      lines.push(m.to ? `${ACTIONS[m.action].label} moved to ${keyLabel(m.to)}.` : `${ACTIONS[m.action].label} has no key now: pick one for it.`);
      this.flash(m.action);
    }
    this.flash(action);
    this.say(lines.join(' '));
  }

  private render(): void {
    const keys = currentKeys();
    for (const [action, button] of this.buttons) {
      const waiting = this.listening === action;
      const code = keys[action];
      button.textContent = waiting ? 'Press a key…' : keyLabel(code) || 'Not set';
      button.classList.toggle('listening', waiting);
      button.classList.toggle('unset', !waiting && !code);
      button.classList.toggle('changed', !waiting && code !== DEFAULT_KEYS[action]);
      button.title = waiting ? 'Press a key, or click here with a mouse button. Esc cancels.' : `Change the key for ${ACTIONS[action].label.toLowerCase()}`;
    }
  }

  private flash(action: Action): void {
    const button = this.buttons.get(action);
    if (!button) return;
    button.classList.remove('flash');
    void button.offsetWidth;
    button.classList.add('flash');
  }

  private say(text: string): void {
    this.note.textContent = text;
  }
}
