import type { ChatMessage } from '../../../shared/protocol.ts';

const VISIBLE_LINES = 8;
/** Lines fade after this long unless the chat box is open. */
const FADE_MS = 12_000;

/**
 * Text chat: Enter opens the box, Enter sends, Esc cancels. Recent lines show
 * bottom-left and fade out after a while.
 */
export class Chat {
  private log = document.getElementById('chat-log')!;
  private input = document.getElementById('chat-input') as HTMLInputElement;
  /** Called with the text to send. */
  onSend: (text: string) => void = () => {};
  /** Called when the box opens, so held keys can be released. */
  onOpen: () => void = () => {};

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' || this.isOpen || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.open();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend(text);
        this.close();
      } else if (e.code === 'Escape') {
        this.close();
      }
      e.stopPropagation();
    });
    this.input.addEventListener('blur', () => this.close());
  }

  get isOpen(): boolean {
    return !this.input.hidden;
  }

  open(): void {
    document.exitPointerLock?.();
    this.onOpen();
    this.input.hidden = false;
    this.log.classList.add('open');
    this.input.focus();
  }

  close(): void {
    this.input.value = '';
    this.input.hidden = true;
    this.log.classList.remove('open');
    this.input.blur();
  }

  add(msg: ChatMessage, color: string): void {
    const li = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = msg.name;
    name.style.color = color;
    // textContent, never innerHTML: chat is untrusted.
    li.append(name, document.createTextNode(` ${msg.text}`));
    this.push(li);
  }

  system(text: string): void {
    const li = document.createElement('li');
    li.className = 'system';
    li.textContent = text;
    this.push(li);
  }

  private push(li: HTMLLIElement): void {
    this.log.append(li);
    while (this.log.children.length > VISIBLE_LINES * 3) this.log.firstElementChild!.remove();
    setTimeout(() => li.classList.add('faded'), FADE_MS);
  }
}
