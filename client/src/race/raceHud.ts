import type { RaceCar, RaceState } from '../../../shared/protocol.ts';
import { code, TEAMS } from '../../../shared/racing.ts';
import { fingerWords } from '../device.ts';
import { settings } from '../settings.ts';

/** One row of the timing tower. */
export interface Standing {
  car: RaceCar;
  /** Gap to the leader, as shown: "+1.234", "+1 lap", or the finishing time. */
  gap: string;
  me: boolean;
}

/** m:ss.mmm, or "-" for nothing. */
export function lapTime(seconds: number | null, digits = 3): string {
  if (seconds === null || !Number.isFinite(seconds)) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(digits).padStart(digits + 3, '0')}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
};

/**
 * The race's screens over the game, like a race broadcast: the timing tower down the left
 * (positions, three-letter names in team colors, gaps), the player's position, lap and lap
 * times at the top, the five red start lights, the DRS light by the speedometer, banners
 * (the countdown, "Lights out", the last lap), and the results when it's over.
 */
export class RaceHud {
  private tower = el('div', 'panel race-tower');
  private towerHead = el('div', 'tower-head');
  private towerList = el('ol', 'tower-list');
  private timing = el('div', 'panel race-timing');
  private pos = el('strong', 'race-pos');
  private lap = el('div', 'race-lap');
  private now = el('div', 'race-now');
  private times = el('div', 'race-times');
  private gaps = el('div', 'race-gaps');
  private lights = el('div', 'race-lights');
  private bulbs: HTMLElement[] = [];
  private banner = el('div', 'race-banner');
  private drs = el('div', 'race-drs', 'DRS');
  private results = el('div', 'overlay race-results');
  private resultsCard = el('div', 'panel results-card');
  private shown = '';
  private bannerUntil = 0;
  private resultsKey = '';
  private dismissed = -1;

  constructor() {
    const hud = document.getElementById('hud')!;
    document.body.classList.add('racing');
    this.tower.append(this.towerHead, this.towerList);
    this.timing.append(el('div', 'race-pos-row'), this.lap, this.now, this.times, this.gaps);
    this.timing.firstElementChild!.append(this.pos);
    for (let c = 0; c < 5; c++) {
      const col = el('div', 'light-col');
      for (let r = 0; r < 2; r++) {
        const bulb = el('span', 'bulb');
        col.append(bulb);
        this.bulbs.push(bulb);
      }
      this.lights.append(col);
    }
    this.lights.hidden = true;
    this.banner.hidden = true;
    this.results.hidden = true;
    this.results.append(this.resultsCard);
    hud.append(this.tower, this.timing, this.lights, this.banner);
    document.querySelector('.hud-speed')!.append(this.drs);
    document.body.append(this.results);
    // The free roam parts of the screen have nothing to do here.
    for (const id of ['hud-clock', 'hud-clock-hint', 'hud-players', 'hud-car', 'help-foot']) document.getElementById(id)?.setAttribute('hidden', '');
    document.getElementById('menu-open-journal')?.setAttribute('hidden', '');
    const help = document.getElementById('help-car')!;
    help.replaceChildren(
      ...fingerWords('W throttle|S brake|A D steer|Q open DRS|C camera|T back on track|Enter chat|Esc menu|H hide help')
        .split('|')
        .map((t) => el('span', '', t)),
    );
    help.dataset.items = 'race';
  }

  /** The help line follows the setting. */
  showHelp(): void {
    document.getElementById('help-car')!.hidden = !settings.showHelp;
  }

  /** The timing tower; shows the top three and the cars around the player when there are many. */
  renderTower(rows: Standing[], laps: number, lapsDone: number, phase: RaceState['phase']): void {
    // Just under the room's panel, however tall it is on this screen.
    const room = document.querySelector<HTMLElement>('.hud-room');
    const top = room ? `${room.offsetTop + room.offsetHeight + 8}px` : '';
    if (this.tower.style.top !== top) this.tower.style.top = top;
    const max = innerHeight < 400 ? 5 : innerHeight < 520 ? 6 : 12;
    const meAt = rows.findIndex((r) => r.me);
    let pick = rows.map((_, i) => i);
    if (rows.length > max) {
      const around = Math.max(3, Math.min(rows.length - (max - 3), meAt - Math.floor((max - 3) / 2)));
      pick = [0, 1, 2, ...Array.from({ length: max - 3 }, (_, k) => around + k)];
    }
    const head = phase === 'grid' || phase === 'lights' ? 'Starting grid' : phase === 'finished' ? 'Finished' : `Lap ${Math.min(laps, lapsDone + 1)}/${laps}`;
    const key = head + pick.map((i) => `${rows[i].car.id}${rows[i].gap}${rows[i].car.out}`).join(',');
    if (key === this.shown) return;
    this.shown = key;
    this.towerHead.textContent = head;
    this.towerList.replaceChildren(
      ...pick.map((i) => {
        const r = rows[i];
        const li = el('li', r.me ? 'me' : '');
        if (i > 0 && pick[pick.indexOf(i) - 1] !== i - 1) li.classList.add('skip');
        li.style.setProperty('--team', TEAMS[r.car.team].primary);
        li.append(el('span', 'p', String(i + 1)), el('span', 'team'), el('span', 'code', code(r.car.name)), el('span', 'gap', r.car.out ? 'OUT' : r.gap));
        li.title = `${r.car.name}, ${TEAMS[r.car.team].name}`;
        return li;
      }),
    );
  }

  /** The player's own position, lap and times; `null` while watching. */
  renderTiming(
    me: { position: number; of: number; lap: number; laps: number; current: number | null; last: number | null; best: number | null; ahead: string; behind: string } | null,
  ): void {
    this.timing.hidden = !me;
    if (!me) return;
    this.pos.innerHTML = `P${me.position}<small>/${me.of}</small>`;
    this.lap.textContent = `Lap ${Math.min(me.lap, me.laps)}/${me.laps}`;
    this.now.textContent = lapTime(me.current, 1);
    this.times.innerHTML = `<span><small>Last</small> ${lapTime(me.last)}</span><span><small>Best</small> ${lapTime(me.best)}</span>`;
    this.gaps.innerHTML = `${me.ahead ? `<span><small>Ahead</small> ${me.ahead}</span>` : ''}${me.behind ? `<span><small>Behind</small> ${me.behind}</span>` : ''}`;
  }

  /** The start lights: `lit` pairs of red (0..5); hidden when `null`. */
  renderLights(lit: number | null): void {
    this.lights.hidden = lit === null;
    this.bulbs.forEach((b, k) => b.classList.toggle('on', lit !== null && Math.floor(k / 2) < lit));
  }

  /** DRS: off (not allowed), armed (allowed in the next zone), or open. */
  renderDrs(state: 'off' | 'armed' | 'ready' | 'open'): void {
    this.drs.dataset.state = state;
  }

  /** A big line across the screen; `ms` keeps it up that long, 0 until replaced. */
  say(text: string, ms = 0): void {
    this.banner.textContent = text;
    this.banner.hidden = !text;
    this.bannerUntil = ms ? performance.now() + ms : Infinity;
  }

  /** Clears a timed banner once its time is up. */
  tick(): void {
    if (!this.banner.hidden && performance.now() > this.bannerUntil) this.banner.hidden = true;
  }

  /** The results table for race `race`, or hides it (`null`). Hidden by the player, it stays hidden for that race. */
  renderResults(rows: Standing[] | null, best: { name: string; time: number } | null, nextIn: number, race: number): void {
    if (!rows || this.dismissed === race) {
      this.results.hidden = true;
      return;
    }
    this.results.hidden = false;
    const key = `${race}|${Math.ceil(nextIn)}|${rows.map((r) => r.car.id + r.gap).join(',')}`;
    if (key === this.resultsKey) return;
    this.resultsKey = key;
    const table = el('table', 'results-table');
    table.innerHTML = '<thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time</th><th>Best lap</th></tr></thead>';
    const body = el('tbody', '');
    rows.forEach((r, i) => {
      const tr = el('tr', r.me ? 'me' : '');
      tr.style.setProperty('--team', TEAMS[r.car.team].primary);
      const name = el('td', 'driver');
      name.append(el('span', 'team'), document.createTextNode(r.car.name + (r.me ? ' (you)' : '')));
      tr.append(el('td', 'p', i === 0 ? '1' : String(i + 1)), name, el('td', 'muted', TEAMS[r.car.team].name), el('td', 'num', r.car.out ? 'Out' : r.gap), el('td', 'num', lapTime(r.car.best)));
      body.append(tr);
    });
    table.append(body);
    const podium = rows.slice(0, 3).map((r) => r.car.name);
    this.resultsCard.replaceChildren(
      el('h2', '', 'Race results'),
      el('p', 'menu-note', `${podium[0] ?? ''} wins${podium[1] ? `, ahead of ${podium.slice(1).join(' and ')}` : ''}.`),
      table,
      el('p', 'menu-note', `${best ? `Fastest lap: ${best.name}, ${lapTime(best.time)}. ` : ''}Next race lines up in ${Math.max(0, Math.ceil(nextIn))} s.`),
    );
    const close = el('button', 'secondary', 'Hide');
    close.type = 'button';
    close.onclick = () => {
      this.dismissed = race;
      this.results.hidden = true;
    };
    this.resultsCard.append(close);
  }
}
