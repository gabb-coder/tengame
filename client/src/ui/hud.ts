import type { GameMode, PlayerInfo } from '../../../shared/protocol.ts';
import type { Interaction, Mode } from '../game/localPlayer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function showHud(roomCode: string, mode: GameMode): void {
  $('hud').hidden = false;
  $('hud-code').textContent = roomCode;
  $('hud-mode').textContent = mode === 'missions' ? 'Missions' : 'Free roam';

  const copy = $<HTMLButtonElement>('copy-link');
  copy.onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Copied!';
    } catch {
      copy.textContent = link;
    }
    setTimeout(() => (copy.textContent = 'Copy invite link'), 2000);
  };
}

/** Players with their colors; in missions mode, sorted by score with points shown. */
export function renderPlayerList(players: PlayerInfo[], localId: string, scores?: Record<string, number>): void {
  const list = $('hud-players');
  const sorted = scores ? [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0)) : players;
  list.replaceChildren(
    ...sorted.map((p) => {
      const li = document.createElement('li');
      li.style.setProperty('--dot', p.color);
      const name = document.createElement('span');
      name.textContent = p.id === localId ? `${p.name} (you)` : p.name;
      li.append(name);
      if (scores) {
        const pts = document.createElement('span');
        pts.className = 'points';
        pts.textContent = String(scores[p.id] ?? 0);
        li.append(pts);
      }
      return li;
    }),
  );
}

export function showDisconnected(): void {
  $('disconnected').hidden = false;
}

/** `speed` in m/s, `gear` -1 for reverse, `rpm` as a 0..1 fraction of redline. */
export function renderGauges(speed: number, gear: number, rpm: number): void {
  $('hud-speed').textContent = String(Math.round(Math.abs(speed) * 3.6));
  $('hud-gear').textContent = gear < 0 ? 'R' : String(gear);
  const bar = $('hud-rpm');
  bar.style.width = `${Math.round(rpm * 100)}%`;
  bar.classList.toggle('redline', rpm > 0.88);
}

const HELP_KEY = 'tengame.hideHelp';
let helpHidden = load(HELP_KEY) === '1';

/** H shows or hides the key help line; remembered between visits. */
export function toggleHelp(): void {
  helpHidden = !helpHidden;
  save(HELP_KEY, helpHidden ? '1' : '0');
}

const CAR_HELP = ['W accelerate', 'S brake/reverse', 'A D steer', 'Space handbrake', 'E get out', 'R flip upright', 'T respawn'];
const COMMON_HELP = ['M mute', 'F fullscreen', 'Enter chat', 'H hide help'];

/** Shows the speedometer and driving help in the car, walking help on foot. */
export function renderMode(mode: Mode, pointerLocked: boolean): void {
  const car = $('help-car');
  car.hidden = helpHidden || mode !== 'car';
  const foot = $('help-foot');
  foot.hidden = helpHidden || mode !== 'foot';
  const look = pointerLocked ? 'Mouse or arrows look' : 'Click to look with the mouse';
  setHelp(car, [...CAR_HELP, ...COMMON_HELP]);
  setHelp(foot, ['WASD walk', 'Shift run', 'Space jump', look, 'E interact', ...COMMON_HELP]);
  document.querySelector<HTMLElement>('.hud-speed')!.hidden = mode !== 'car';
}

/** Fills a help line, letting it wrap only between items. */
function setHelp(el: HTMLElement, items: string[]): void {
  const key = items.join('|');
  if (el.dataset.items === key) return;
  el.dataset.items = key;
  el.replaceChildren(
    ...items.map((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    }),
  );
}

let lastPrompt = '';

/** The "press E to ..." hint for whatever is in reach. */
export function renderPrompt(i: Interaction): void {
  let html = '';
  if (i?.kind === 'enter-car') html = '<kbd>E</kbd>Get in';
  else if (i?.kind === 'door') html = `<kbd>E</kbd>${i.open ? 'Close' : 'Open'} door<small>${escapeHtml(i.address)}</small>`;
  if (html === lastPrompt) return;
  lastPrompt = html;
  const el = $('hud-prompt');
  el.hidden = !html;
  el.innerHTML = html;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let lastClock = '';

/** Time of day, e.g. "18:40". */
export function renderClock(hours: number): void {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (text === lastClock) return;
  lastClock = text;
  $('hud-clock').textContent = text;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode); the setting just won't be remembered.
  }
}
