import { CIRCUITS, type CircuitData, type CircuitInfo, isNightRace, type Scenery } from '../../../shared/circuits.ts';
import type { PlayerInfo, RaceState, SetupStep, WelcomeMessage } from '../../../shared/protocol.ts';
import { BOT_CHOICES, type Difficulty, DIFFICULTIES, LAP_CHOICES, MAX_GRID, type RaceSetup } from '../../../shared/racing.ts';
import type { Connection } from '../net/connection.ts';

const RACE_KEY = 'tengame.race';
/** The track maps' drawing space (SVG units, square). */
const SIZE = 1000;
/** Map points are every this many of the circuit's points (4 m apart). */
const STRIDE = 3;
/** A rough average speed round a lap (m/s), for how long a race takes. */
const AVERAGE_SPEED = 58;
/** Seconds for the glowing car to lap the map. */
const MAP_LAP = 7;
/** The red lights come on this far apart (ms) when the Grand Prix is chosen. */
const LIGHT_MS = 380;
/** Drafts of the host's choice go out at most this often (ms). */
const DRAFT_MS = 120;

/** Each Grand Prix's colours: its country's flag (for the stripes) and a glow for the screen. */
const LOOK: Record<string, { flag: string[]; glow: string }> = {
  sepang: { flag: ['#cc0001', '#ffffff', '#010066', '#ffcc00'], glow: '#ffcc00' },
  'marina-bay': { flag: ['#ef3340', '#ffffff'], glow: '#ff3b4e' },
  silverstone: { flag: ['#012169', '#ffffff', '#c8102e'], glow: '#4f8cff' },
  monza: { flag: ['#009246', '#ffffff', '#ce2b37'], glow: '#22c55e' },
  spa: { flag: ['#202020', '#fdda24', '#ef3340'], glow: '#fdda24' },
  monaco: { flag: ['#ce1126', '#ffffff'], glow: '#ff2e47' },
  suzuka: { flag: ['#ffffff', '#bc002d', '#ffffff'], glow: '#ff3b6b' },
  interlagos: { flag: ['#009c3b', '#ffdf00', '#002776'], glow: '#16c784' },
  sakhir: { flag: ['#ffffff', '#ce1126'], glow: '#ff4040' },
  spielberg: { flag: ['#ed2939', '#ffffff', '#ed2939'], glow: '#ff5a5f' },
};

const SURROUNDINGS: Record<Scenery, string> = {
  temperate: 'Countryside',
  forest: 'Through the trees',
  alpine: 'In the mountains',
  tropical: 'Tropical heat',
  desert: 'In the desert',
  city: 'Through the city',
};

const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  easy: 'They brake early and leave you room.',
  normal: 'A fair fight, close to the limit.',
  hard: 'On the limit, every corner, every lap.',
};

/** A small Grand Prix car from above, nose to the right. */
const CAR_ICON =
  '<svg viewBox="0 0 40 18" aria-hidden="true"><rect x="1" y="2" width="3" height="14" rx="1"/><rect x="6" y="0.5" width="6" height="4.5" rx="1.2"/><rect x="6" y="13" width="6" height="4.5" rx="1.2"/><path d="M4 6.2h14l12 1.6h6v2.4h-6L18 11.8H4z"/><rect x="25" y="1.2" width="5" height="4" rx="1.2"/><rect x="25" y="12.8" width="5" height="4" rx="1.2"/><rect x="35" y="2" width="3" height="14" rx="1"/></svg>';

/** The host's last choice (remembered on this device), where a new room's choosing starts. */
export function savedSetup(): RaceSetup {
  const fallback: RaceSetup = { circuit: CIRCUITS[0].id, laps: 5, bots: 9, difficulty: 'normal' };
  try {
    const saved = JSON.parse(localStorage.getItem(RACE_KEY) ?? '{}') as Partial<RaceSetup>;
    return {
      circuit: CIRCUITS.some((c) => c.id === saved.circuit) ? saved.circuit! : fallback.circuit,
      laps: (LAP_CHOICES as readonly number[]).includes(saved.laps!) ? saved.laps! : fallback.laps,
      bots: (BOT_CHOICES as readonly number[]).includes(saved.bots!) ? saved.bots! : fallback.bots,
      difficulty: DIFFICULTIES.includes(saved.difficulty!) ? saved.difficulty! : fallback.difficulty,
    };
  } catch {
    return fallback;
  }
}

function remember(setup: RaceSetup): void {
  try {
    localStorage.setItem(RACE_KEY, JSON.stringify(setup));
  } catch {
    // Not remembered, that's all.
  }
}

/** A circuit drawn for the screen: its outline, how fast the little car goes round it, and a few facts. */
interface Shape {
  d: string;
  xs: Float32Array;
  ys: Float32Array;
  /** Relative speed (0..1) at each point: slow in the corners. */
  speed: Float32Array;
  /** Heights' range along the lap (m), and the longest straight (m). */
  climb: number;
  straight: number;
}

const shapes = new Map<string, Promise<Shape>>();

/** A circuit's map, north up, fitted to the drawing; fetched once. */
function shapeOf(id: string): Promise<Shape> {
  let shape = shapes.get(id);
  if (!shape) {
    shape = fetch(`/media/circuits/${id}.json`)
      .then((r) => r.json() as Promise<CircuitData>)
      .then(drawShape);
    shapes.set(id, shape);
  }
  return shape;
}

function drawShape(data: CircuitData): Shape {
  const p = data.points;
  const all = p.length / 3;
  const n = Math.floor(all / STRIDE);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const x = p[3 * k * STRIDE];
    const z = p[3 * k * STRIDE + 2];
    xs[k] = x;
    ys[k] = z;
    [minX, maxX, minZ, maxZ] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minZ, z), Math.max(maxZ, z)];
  }
  const pad = 80;
  const scale = (SIZE - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (SIZE - (maxX - minX) * scale) / 2;
  const oy = (SIZE - (maxZ - minZ) * scale) / 2;
  for (let k = 0; k < n; k++) {
    xs[k] = ox + (xs[k] - minX) * scale;
    ys[k] = oy + (ys[k] - minZ) * scale;
  }
  const d = Array.from(xs, (x, k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${ys[k].toFixed(1)}`).join('') + 'Z';

  // How sharply the lap turns at each of the circuit's points (radians per meter, smoothed).
  const heading = new Float32Array(all);
  for (let i = 0; i < all; i++) {
    const j = (i + 1) % all;
    heading[i] = Math.atan2(p[3 * j + 2] - p[3 * i + 2], p[3 * j] - p[3 * i]);
  }
  const bend = new Float32Array(all);
  for (let i = 0; i < all; i++) {
    let sum = 0;
    for (let o = -3; o <= 3; o++) {
      const a = (i + o + all) % all;
      const turn = heading[(a + 1) % all] - heading[a];
      sum += Math.atan2(Math.sin(turn), Math.cos(turn));
    }
    bend[i] = Math.abs(sum / 7 / 4);
  }
  // The little car: quicker where the lap is straighter.
  const speed = new Float32Array(n);
  for (let k = 0; k < n; k++) speed[k] = Math.max(0.3, Math.min(1, Math.sqrt(1 / Math.max(bend[k * STRIDE], 1e-4) / 600)));
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < n; k++) speed[k] = (speed[(k + n - 1) % n] + speed[k] + speed[(k + 1) % n]) / 3;

  let low = Infinity;
  let high = -Infinity;
  for (let i = 1; i < p.length; i += 3) [low, high] = [Math.min(low, p[i]), Math.max(high, p[i])];
  let straight = 0;
  let run = 0;
  for (let i = 0; i < 2 * all; i++) {
    run = bend[i % all] < 1 / 700 ? run + 4 : 0;
    straight = Math.max(straight, Math.min(run, all * 4));
  }
  return { d, xs, ys, speed, climb: Math.round((high - low) / 100), straight: Math.round(straight / 10) * 10 };
}

const html = (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((out, s, k) => out + s + (k < values.length ? String(values[k]) : ''), '');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Restarts an element's CSS animation by putting `className` back on. */
function replay(e: Element, className: string): void {
  e.classList.remove(className);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(className);
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export interface Chosen {
  race: RaceState;
  players: PlayerInfo[];
}

/**
 * The Grand Prix screen of a racing room: first the host chooses the Grand Prix (a map of
 * the circuit drawing itself, a car lapping it, its facts) and then its settings (laps,
 * computer cars, difficulty); everyone else in the room watches the choice being made. Once
 * it's chosen, five red lights come on and go out, and the screen stays up, with the map,
 * while the circuit loads.
 */
export class GrandPrixScreen {
  /** Resolves once the Grand Prix is chosen (and the lights are out): the race and who's in the room. */
  readonly chosen: Promise<Chosen>;
  private root = el('div', 'gp');
  private race: RaceState;
  private players: Map<string, PlayerInfo>;
  private readonly myId: string;
  private setup: RaceSetup;
  private step: SetupStep | 'start' | 'loading';
  private shown = -1;
  private shape: Shape | null = null;
  private car = 0;
  private frame = 0;
  private lastFrame = performance.now();
  private draftAt = 0;
  private draftTimer = 0;
  private off: () => void = () => {};
  private keys = (e: KeyboardEvent) => this.onKey(e);
  private resize = () => this.placePills();
  private resolve!: (chosen: Chosen) => void;
  private $ = <T extends HTMLElement = HTMLElement>(selector: string) => this.root.querySelector(selector) as T;

  constructor(
    private conn: Connection,
    welcome: WelcomeMessage,
    private audio?: AudioContext,
  ) {
    this.race = welcome.race!;
    this.myId = welcome.id;
    this.players = new Map(welcome.players.map((p) => [p.id, p]));
    this.setup = { ...this.race.setup };
    this.step = this.race.phase === 'setup' ? (this.race.choosing ?? 'gp') : 'loading';
    this.chosen = new Promise((done) => (this.resolve = done));
    this.build(welcome.room);
    document.body.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('gp-open'));
    this.showGp(this.indexOf(this.setup.circuit), 0);
    this.render();
    this.frame = requestAnimationFrame(this.animate);
    addEventListener('keydown', this.keys);
    addEventListener('resize', this.resize);
    // Every circuit's map, for the strip along the bottom.
    for (const [k, c] of CIRCUITS.entries()) void shapeOf(c.id).then((s) => this.root.querySelectorAll('.gp-thumb path')[k]?.setAttribute('d', s.d));

    if (this.race.phase !== 'setup') {
      // Joined once the Grand Prix was already chosen: straight on to loading it.
      this.resolve({ race: this.race, players: [...this.players.values()] });
      return;
    }
    this.off = conn.on((msg) => {
      if (msg.type === 'race') this.onRace(msg.race);
      else if (msg.type === 'player_joined') {
        this.players.set(msg.player.id, msg.player);
        this.renderDrivers();
        this.renderGrid();
      } else if (msg.type === 'player_left') {
        this.players.delete(msg.id);
        this.renderDrivers();
        this.renderGrid();
      }
    });
  }

  /** The loading screen's progress line. */
  status(text: string): void {
    this.$('.gp-status-text').textContent = text;
  }

  /** Fades away, the race showing through. */
  close(): void {
    this.off();
    removeEventListener('keydown', this.keys);
    removeEventListener('resize', this.resize);
    this.root.classList.add('gp-closing');
    setTimeout(() => {
      cancelAnimationFrame(this.frame);
      this.root.remove();
    }, 700);
  }

  private get isHost(): boolean {
    return this.race.host === this.myId;
  }

  private indexOf(id: string): number {
    return Math.max(0, CIRCUITS.findIndex((c) => c.id === id));
  }

  private build(room: string): void {
    this.root.innerHTML = html`
      <div class="gp-bg" aria-hidden="true"><i class="gp-lines"></i><i class="gp-glow"></i></div>
      <div class="gp-country" aria-hidden="true"></div>
      <header class="gp-top">
        <div class="gp-brand">TENGAME <b>Grand Prix</b></div>
        <ol class="gp-steps">
          <li data-for="gp"><span>1</span>Grand Prix</li>
          <li data-for="settings"><span>2</span>Race settings</li>
        </ol>
        <div class="gp-room">
          <span>Room <b>${room}</b></span>
          <button type="button" class="gp-invite">Copy invite link</button>
          <button type="button" class="gp-leave" title="Leave the room">Leave</button>
        </div>
      </header>
      <div class="gp-main">
        <div class="gp-stage">
          <svg class="gp-map" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">
            <defs>
              <pattern id="gp-chequer" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#fff" /><rect width="8" height="8" fill="#111" /><rect x="8" y="8" width="8" height="8" fill="#111" />
              </pattern>
            </defs>
            <g class="gp-track"></g>
          </svg>
          <div class="gp-swipe" aria-hidden="true"><span>‹</span><span>›</span></div>
        </div>
        <section class="gp-panel">
          <div class="gp-head">
            <div class="gp-round gp-in" style="--i:0"></div>
            <div class="gp-flag gp-in" style="--i:1"></div>
            <h1 class="gp-title gp-in" style="--i:2"></h1>
            <div class="gp-sub gp-in" style="--i:3"></div>
          </div>
          <div class="gp-facts">
            <dl class="gp-stats"></dl>
            <div class="gp-tags"></div>
          </div>
          <div class="gp-settings">
            <div class="gp-setting" style="--i:0">
              <h2>Race distance</h2>
              <div class="gp-seg" data-key="laps"></div>
              <p class="gp-note gp-distance"></p>
            </div>
            <div class="gp-setting" style="--i:1">
              <h2>Computer cars</h2>
              <div class="gp-seg" data-key="bots"></div>
              <div class="gp-grid" aria-hidden="true"></div>
              <p class="gp-note gp-grid-note"></p>
            </div>
            <div class="gp-setting" style="--i:2">
              <h2>Their pace</h2>
              <div class="gp-seg" data-key="difficulty"></div>
              <p class="gp-note gp-pace"><span class="gp-meter"><i></i><i></i><i></i></span><span class="gp-pace-text"></span></p>
            </div>
          </div>
          <div class="gp-loading">
            <div class="gp-status-text">Loading…</div>
            <div class="gp-bar"><i></i></div>
          </div>
        </section>
      </div>
      <footer class="gp-bottom">
        <div class="gp-strip" role="listbox" aria-label="Grand Prix"></div>
        <div class="gp-actions">
          <div class="gp-drivers"></div>
          <div class="gp-wait"><i></i><span></span></div>
          <button type="button" class="gp-back">‹ Change Grand Prix</button>
          <button type="button" class="gp-go"></button>
        </div>
      </footer>
      <div class="gp-lights" aria-hidden="true">
        <div class="gp-gantry">${'<div class="gp-pod"><i></i><i></i></div>'.repeat(5)}</div>
        <div class="gp-lights-out">Lights out</div>
      </div>`;

    const strip = this.$('.gp-strip');
    for (const [k, c] of CIRCUITS.entries()) {
      const b = el('button', 'gp-thumb');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.style.setProperty('--glow', LOOK[c.id].glow);
      b.innerHTML = html`<svg viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true"><path /></svg><span>${c.name.split('-')[0]}</span>`;
      b.title = `${c.grandPrix} · ${c.name}`;
      b.addEventListener('click', () => this.pick(k));
      strip.append(b);
    }
    this.segment('laps', LAP_CHOICES.map((n) => ({ value: n, label: String(n) })));
    this.segment('bots', BOT_CHOICES.map((n) => ({ value: n, label: n === 0 ? 'None' : String(n) })));
    this.segment('difficulty', DIFFICULTIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) })));

    this.$('.gp-go').addEventListener('click', () => this.forward());
    this.$('.gp-back').addEventListener('click', () => this.back());
    this.$('.gp-leave').addEventListener('click', () => (location.href = location.pathname));
    const invite = this.$<HTMLButtonElement>('.gp-invite');
    invite.addEventListener('click', async () => {
      const link = `${location.origin}${location.pathname}?room=${room}`;
      try {
        await navigator.clipboard.writeText(link);
        invite.textContent = 'Copied!';
      } catch {
        invite.textContent = link;
      }
      setTimeout(() => (invite.textContent = 'Copy invite link'), 2000);
    });
    // Swiping across the map changes the Grand Prix.
    const stage = this.$('.gp-stage');
    let downX: number | null = null;
    stage.addEventListener('pointerdown', (e) => (downX = e.clientX));
    stage.addEventListener('pointerup', (e) => {
      if (downX !== null && Math.abs(e.clientX - downX) > 40 && this.step === 'gp') this.pick(this.shown + (e.clientX < downX ? 1 : -1));
      downX = null;
    });
    for (const [k, b] of this.root.querySelectorAll('.gp-swipe span').entries()) b.addEventListener('click', () => this.step === 'gp' && this.pick(this.shown + (k ? 1 : -1)));
  }

  /** A row of choices with a pill sliding behind the chosen one. */
  private segment(key: 'laps' | 'bots' | 'difficulty', choices: { value: number | string; label: string }[]): void {
    const box = this.$(`.gp-seg[data-key="${key}"]`);
    box.append(el('i', 'gp-pill'));
    for (const c of choices) {
      const b = el('button', '', c.label);
      b.type = 'button';
      b.dataset.value = String(c.value);
      b.addEventListener('click', () => {
        if (!this.isHost || this.step !== 'settings') return;
        this.setup = { ...this.setup, [key]: c.value };
        this.changed();
      });
      box.append(b);
    }
  }

  // ---- the host's choosing ----

  private pick(k: number): void {
    if (!this.isHost || this.step !== 'gp') return;
    const n = CIRCUITS.length;
    const i = ((k % n) + n) % n;
    if (i === this.shown) return;
    this.setup = { ...this.setup, circuit: CIRCUITS[i].id };
    this.changed();
  }

  private forward(): void {
    if (!this.isHost) return;
    if (this.step === 'gp') {
      this.step = 'settings';
      this.changed();
    } else if (this.step === 'settings') {
      this.step = 'start';
      this.render();
      clearTimeout(this.draftTimer);
      this.conn.send({ type: 'race_setup', setup: this.setup, step: 'settings', final: true });
    }
  }

  private back(): void {
    if (!this.isHost || this.step !== 'settings') return;
    this.step = 'gp';
    this.changed();
  }

  /** The host changed something: show it, remember it, and tell everyone (not too often). */
  private changed(): void {
    remember(this.setup);
    this.render();
    clearTimeout(this.draftTimer);
    const send = () => {
      this.draftAt = performance.now();
      if (this.step === 'gp' || this.step === 'settings') this.conn.send({ type: 'race_setup', setup: this.setup, step: this.step });
    };
    const wait = DRAFT_MS - (performance.now() - this.draftAt);
    if (wait <= 0) send();
    else this.draftTimer = window.setTimeout(send, wait);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isHost || e.target instanceof HTMLInputElement) return;
    const key = e.code;
    if (this.step === 'gp' && (key === 'ArrowLeft' || key === 'KeyA')) this.pick(this.shown - 1);
    else if (this.step === 'gp' && (key === 'ArrowRight' || key === 'KeyD')) this.pick(this.shown + 1);
    else if (key === 'Enter' && (this.step === 'gp' || this.step === 'settings')) this.forward();
    else if ((key === 'Escape' || key === 'Backspace') && this.step === 'settings') this.back();
    else return;
    e.preventDefault();
  }

  // ---- everyone's view ----

  private onRace(race: RaceState): void {
    const before = this.race;
    this.race = race;
    if (race.phase !== 'setup') {
      this.setup = { ...race.setup };
      this.off();
      this.render();
      void this.lightsOut().then(() => this.resolve({ race: this.race, players: [...this.players.values()] }));
      return;
    }
    // Watching the host choose (or taking over when the host left).
    if (!this.isHost || before.host !== race.host) {
      this.setup = { ...race.setup };
      this.step = race.choosing ?? 'gp';
    }
    this.render();
  }

  /** Brings the screen up to date with the choice so far. */
  private render(): void {
    const i = this.indexOf(this.setup.circuit);
    if (i !== this.shown) this.showGp(i, i > this.shown ? 1 : -1);
    this.root.dataset.step = this.step;
    this.root.classList.toggle('gp-host', this.isHost);
    for (const li of this.root.querySelectorAll<HTMLElement>('.gp-steps li')) li.classList.toggle('on', li.dataset.for === this.step || (li.dataset.for === 'settings' && this.step !== 'gp'));
    const go = this.$<HTMLButtonElement>('.gp-go');
    go.textContent = this.step === 'gp' ? 'Choose this Grand Prix ›' : 'Start the Grand Prix';
    go.disabled = this.step === 'start';
    const hostName = this.players.get(this.race.host)?.name ?? 'The host';
    this.$('.gp-wait span').textContent = this.step === 'settings' ? `${hostName} is setting up the race…` : `${hostName} is choosing the Grand Prix…`;
    for (const box of this.root.querySelectorAll<HTMLElement>('.gp-seg')) {
      const value = String(this.setup[box.dataset.key as 'laps' | 'bots' | 'difficulty']);
      for (const b of box.querySelectorAll<HTMLButtonElement>('button')) {
        b.classList.toggle('on', b.dataset.value === value);
        b.disabled = !this.isHost;
      }
    }
    for (const [k, b] of this.root.querySelectorAll<HTMLButtonElement>('.gp-thumb').entries()) b.disabled = !this.isHost && k !== this.shown;
    const info = CIRCUITS[i];
    const km = (this.setup.laps * info.length) / 1000;
    this.$('.gp-distance').textContent = `${km.toFixed(1)} km · about ${Math.max(1, Math.round((this.setup.laps * info.length) / AVERAGE_SPEED / 60))} min`;
    this.$('.gp-pace').dataset.level = String(DIFFICULTIES.indexOf(this.setup.difficulty) + 1);
    this.$('.gp-pace-text').textContent = DIFFICULTY_TEXT[this.setup.difficulty];
    this.renderGrid();
    this.renderDrivers();
    requestAnimationFrame(() => this.placePills());
  }

  /** The chosen Grand Prix: its map drawing itself, its name and facts sliding in. */
  private showGp(i: number, direction: number): void {
    this.shown = i;
    const info = CIRCUITS[i];
    const look = LOOK[info.id];
    this.root.style.setProperty('--glow', look.glow);
    this.root.style.setProperty('--dir', String(direction || 1));

    const country = this.$('.gp-country');
    country.textContent = info.country.toUpperCase();
    replay(country, 'gp-slide');
    this.$('.gp-round').innerHTML = html`Round <b>${String(i + 1).padStart(2, '0')}</b><span>/ ${CIRCUITS.length}</span>`;
    this.$('.gp-flag').innerHTML = look.flag.map((c) => `<i style="background:${c}"></i>`).join('');
    const [place] = info.grandPrix.split(' Grand Prix');
    this.$('.gp-title').innerHTML = html`<span>${place}</span> Grand Prix`;
    this.$('.gp-sub').textContent = `${info.name} · ${info.country}`;
    for (const e of this.root.querySelectorAll('.gp-head .gp-in')) replay(e, 'gp-in');

    const stats = this.$('.gp-stats');
    stats.replaceChildren();
    const facts: [string, number, number, string][] = [
      ['Lap', info.length / 1000, 3, 'km'],
      ['Corners', info.corners, 0, ''],
      ['Height change', 0, 0, 'm'],
      ['Longest straight', 0, 0, 'm'],
      ['First Grand Prix', info.firstGp, 0, ''],
    ];
    const values: HTMLElement[] = [];
    for (const [k, [label, value, decimals, unit]] of facts.entries()) {
      const box = el('div', 'gp-stat gp-in');
      box.style.setProperty('--i', String(k + 2));
      const dd = el('dd');
      const num = el('b', '', value ? value.toFixed(decimals) : '–');
      dd.append(num, unit ? el('small', '', unit) : '');
      box.append(el('dt', '', label), dd);
      stats.append(box);
      values.push(num);
      if (value && label !== 'First Grand Prix') this.countUp(num, value, decimals);
    }
    const tags = this.$('.gp-tags');
    tags.replaceChildren(
      ...[
        info.style === 'street' ? 'Street circuit' : 'Permanent circuit',
        isNightRace(info) ? 'Night race' : null,
        info.bridge ? 'Figure of eight' : null,
        info.coast ? 'By the sea' : null,
        SURROUNDINGS[info.scenery],
      ]
        .filter((t) => t !== null)
        .map((t, k) => {
          const tag = el('span', 'gp-tag gp-in', t);
          tag.style.setProperty('--i', String(k + 7));
          return tag;
        }),
    );

    for (const [k, b] of this.root.querySelectorAll<HTMLElement>('.gp-thumb').entries()) {
      b.classList.toggle('on', k === i);
      b.setAttribute('aria-selected', String(k === i));
    }
    this.root.querySelectorAll<HTMLElement>('.gp-thumb')[i]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

    const track = this.$('.gp-track');
    track.replaceChildren();
    this.shape = null;
    void shapeOf(info.id).then((shape) => {
      if (this.shown !== i) return;
      this.shape = shape;
      this.car = 0;
      const n = shape.xs.length;
      const ns = 'http://www.w3.org/2000/svg';
      const path = (cls: string, length = SIZE) => {
        const e = document.createElementNS(ns, 'path');
        e.setAttribute('d', shape.d);
        e.setAttribute('class', cls);
        e.setAttribute('pathLength', String(length));
        return e;
      };
      // The start line: chequered, across the track.
      const angle = (Math.atan2(shape.ys[1] - shape.ys[0], shape.xs[1] - shape.xs[0]) * 180) / Math.PI;
      const start = document.createElementNS(ns, 'rect');
      start.setAttribute('class', 'gp-start');
      start.setAttribute('x', '-8');
      start.setAttribute('y', '-32');
      start.setAttribute('width', '16');
      start.setAttribute('height', '64');
      start.setAttribute('transform', `translate(${shape.xs[0].toFixed(1)} ${shape.ys[0].toFixed(1)}) rotate(${angle.toFixed(1)})`);
      const head = document.createElementNS(ns, 'circle');
      head.setAttribute('class', 'gp-car');
      head.setAttribute('r', '15');
      track.append(path('gp-road-glow'), path('gp-road'), path('gp-trail', n), start, head);
      values[3].textContent = '0';
      this.countUp(values[3], shape.straight, 0);
      if (shape.climb > 0) {
        values[2].textContent = '0';
        this.countUp(values[2], shape.climb, 0);
      } else {
        // Reclaimed land: dead flat.
        values[2].textContent = 'Flat';
        values[2].nextElementSibling?.remove();
      }
    });
  }

  /** A number counting up to `to`. */
  private countUp(e: HTMLElement, to: number, decimals: number): void {
    const begin = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - begin) / 900);
      e.textContent = (to * easeOut(t)).toFixed(decimals);
      if (t < 1 && e.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Who's in the room, the host marked. */
  private renderDrivers(): void {
    const box = this.$('.gp-drivers');
    box.replaceChildren(
      el('span', 'gp-drivers-label', 'In the room'),
      ...[...this.players.values()].map((p) => {
        const chip = el('span', 'gp-driver', p.id === this.myId ? `${p.name} (you)` : p.name);
        chip.style.setProperty('--dot', p.color);
        if (p.id === this.race.host) chip.append(el('em', '', 'host'));
        return chip;
      }),
    );
  }

  /** The grid as it will line up: you, your friends and the computer cars. */
  private renderGrid(): void {
    const humans = Math.max(1, this.players.size);
    const bots = Math.max(0, Math.min(this.setup.bots, MAX_GRID - humans));
    const grid = this.$('.gp-grid');
    const want = humans + bots;
    if (grid.childElementCount !== want || grid.dataset.humans !== String(humans)) {
      grid.dataset.humans = String(humans);
      const before = grid.childElementCount;
      grid.replaceChildren(
        ...Array.from({ length: want }, (_, k) => {
          const car = el('span', k === 0 ? 'gp-gridcar me' : k < humans ? 'gp-gridcar friend' : 'gp-gridcar');
          car.innerHTML = CAR_ICON;
          // New cars pop onto the grid one after another.
          if (k >= before) car.style.animationDelay = `${(k - before) * 35}ms`;
          else car.style.animation = 'none';
          return car;
        }),
      );
    }
    const friends = humans - 1;
    this.$('.gp-grid-note').textContent = [`${want} cars`, friends ? `${friends} friend${friends > 1 ? 's' : ''}` : null, bots ? `${bots} computer car${bots > 1 ? 's' : ''}` : 'no computer cars'].filter(Boolean).join(' · ');
  }

  /** Each row's pill behind its chosen button. */
  private placePills(): void {
    for (const box of this.root.querySelectorAll<HTMLElement>('.gp-seg')) {
      const on = box.querySelector<HTMLElement>('button.on');
      const pill = box.querySelector<HTMLElement>('.gp-pill')!;
      if (!on) continue;
      pill.style.width = `${on.offsetWidth}px`;
      pill.style.transform = `translateX(${on.offsetLeft}px)`;
    }
  }

  /** The car lapping the map, quicker on the straights, a streak of light behind it. */
  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const s = this.shape;
    if (!s) return;
    const n = s.xs.length;
    const k = Math.floor(this.car) % n;
    this.car = (this.car + (s.speed[k] * n * dt) / MAP_LAP / 0.62) % n;
    const a = Math.floor(this.car) % n;
    const b = (a + 1) % n;
    const t = this.car - Math.floor(this.car);
    const head = this.root.querySelector('.gp-car');
    head?.setAttribute('cx', (s.xs[a] + (s.xs[b] - s.xs[a]) * t).toFixed(1));
    head?.setAttribute('cy', (s.ys[a] + (s.ys[b] - s.ys[a]) * t).toFixed(1));
    const trail = this.root.querySelector<SVGPathElement>('.gp-trail');
    if (trail) {
      const length = n * 0.09;
      trail.style.strokeDasharray = `${length} ${n}`;
      trail.style.strokeDashoffset = String(length - this.car);
    }
  };

  /** Five red lights, one after another, then out: the Grand Prix is on. */
  private async lightsOut(): Promise<void> {
    if (this.step === 'loading') return;
    this.step = 'loading';
    this.root.classList.add('gp-lighting');
    const pods = [...this.root.querySelectorAll('.gp-pod')];
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    await wait(450);
    for (const pod of pods) {
      pod.classList.add('on');
      this.beep(false);
      await wait(LIGHT_MS);
    }
    await wait(650);
    for (const pod of pods) pod.classList.remove('on');
    this.root.classList.add('gp-out');
    this.beep(true);
    await wait(900);
    this.root.classList.remove('gp-lighting', 'gp-out');
    this.root.dataset.step = 'loading';
  }

  private beep(high: boolean): void {
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = high ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }
}
