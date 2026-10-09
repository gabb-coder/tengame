import type { GameMode, PlayerInfo } from '../../../shared/protocol.ts';
import type { Interaction, Mode } from '../game/localPlayer.ts';
import { type Settings, settings, updateSettings } from '../settings.ts';

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
  $('hud-speed').textContent = String(Math.round(Math.abs(speed) * (settings.units === 'mph' ? 2.23694 : 3.6)));
  $('hud-gear').textContent = gear < 0 ? 'R' : String(gear);
  const bar = $('hud-rpm');
  bar.style.width = `${Math.round(rpm * 100)}%`;
  bar.classList.toggle('redline', rpm > 0.88);
}

/** H shows or hides the key help line (a setting, so it's remembered). */
export function toggleHelp(): void {
  updateSettings({ showHelp: !settings.showHelp });
}

/** Shows or hides HUD parts per the settings. */
export function applyHudSettings(s: Settings): void {
  document.querySelector<HTMLElement>('.hud-map')!.hidden = !s.showMinimap;
  document.body.classList.toggle('hide-names', !s.showNames);
  $('hud-fps').hidden = !s.showFps;
  $('hud-speed-unit').textContent = s.units === 'mph' ? 'mph' : 'km/h';
}

let fpsFrames = 0;
let fpsSince = performance.now();

/** Counts frames; shows frames per second about twice a second. */
export function renderFps(now: number): void {
  fpsFrames++;
  if (now - fpsSince < 500) return;
  $('hud-fps').textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} FPS`;
  fpsFrames = 0;
  fpsSince = now;
}

const CAR_HELP = ['W accelerate', 'S brake/reverse', 'A D steer', 'Space handbrake', 'E get out', 'R flip upright', 'T respawn'];
const COMMON_HELP = ['M mute', 'F fullscreen', 'Enter chat', 'Esc menu', 'H hide help'];

/** Shows the speedometer and driving help in the car, walking help on foot. */
export function renderMode(mode: Mode, pointerLocked: boolean): void {
  const car = $('help-car');
  car.hidden = !settings.showHelp || mode !== 'car';
  const foot = $('help-foot');
  foot.hidden = !settings.showHelp || mode !== 'foot';
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
export function renderPrompt(i: Interaction, remote: { on: boolean } | null = null): void {
  let html = '';
  if (i?.kind === 'enter-car') html = '<kbd>E</kbd>Get in';
  else if (i?.kind === 'door') html = `<kbd>E</kbd>${i.open ? 'Close' : 'Open'} door<small>${escapeHtml(i.address)}</small>`;
  else if (i?.kind === 'sit') html = `<kbd>E</kbd>Sit down<small>${i.seat.label}</small>`;
  else if (i?.kind === 'stand') html = `<kbd>E</kbd>Stand up${remote ? `<kbd class="second">R</kbd>TV ${remote.on ? 'off' : 'on'}` : '<small>or move</small>'}`;
  else if (i?.kind === 'switch' && i.appliance === 'fire') html = `<kbd>E</kbd>${i.on ? 'Put out' : 'Light'} the fire`;
  else if (i?.kind === 'switch') html = `<kbd>E</kbd>Turn ${i.on ? 'off' : 'on'} the ${i.appliance === 'tv' ? 'TV' : i.appliance}`;
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

let bannerZone = '';
let bannerTimer = 0;

/**
 * Announces the zone the player has arrived in, once they've been there a moment (so
 * driving along a border doesn't flash names back and forth).
 */
export function renderZone(name: string, theme: string, dt: number): void {
  if (name === bannerZone) {
    bannerTimer = 0;
    return;
  }
  bannerTimer += dt;
  if (bannerTimer < 0.8) return;
  const first = bannerZone === '';
  bannerZone = name;
  bannerTimer = 0;
  if (first) return;
  const el = document.getElementById('zone-banner')!;
  el.querySelector('.zone-theme')!.textContent = theme;
  el.querySelector('.zone-name')!.textContent = name;
  // Restart the fade animation.
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
}

/** Tints the screen while the camera is under water. */
export function renderUnderwater(submerged: boolean): void {
  const el = document.getElementById('underwater')!;
  if (el.hidden === submerged) el.hidden = !submerged;
}

/** The Arctic warmth bar (shown while it matters) and frost on the screen's edges. */
export function renderWarmth(value: number, cold: boolean): void {
  const panel = $('hud-warmth');
  const show = cold || value < 100;
  if (panel.hidden === show) panel.hidden = !show;
  const bar = $('hud-warmth-bar');
  bar.style.width = `${Math.round(value)}%`;
  bar.classList.toggle('cold', value < 25);
  const frost = $('frost');
  const amount = Math.max(0, (40 - value) / 40);
  frost.hidden = amount <= 0;
  if (amount > 0) frost.style.opacity = amount.toFixed(2);
}
