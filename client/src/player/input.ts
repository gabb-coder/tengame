/** Tracks held keys. Ignores keys typed into form fields. */
export class Input {
  private held = new Set<string>();

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.held.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
  }

  /** -1..1 forward/back. */
  get throttle(): number {
    return this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
  }

  /** -1..1 left/right. */
  get steer(): number {
    return this.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
  }

  get jump(): boolean {
    return this.held.has('Space');
  }

  private axis(positive: string[], negative: string[]): number {
    const pos = positive.some((k) => this.held.has(k)) ? 1 : 0;
    const neg = negative.some((k) => this.held.has(k)) ? 1 : 0;
    return pos - neg;
  }
}
