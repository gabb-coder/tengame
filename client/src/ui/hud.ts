import type { GameMode, PlayerInfo } from '../../../shared/protocol.ts';
import type { Interaction, Mode } from '../game/localPlayer.ts';
import { type Action, keysWord, keyWords, labelOf } from '../keys.ts';
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

/** What each key does, as the help line puts it: one action, or several sharing a word ('WASD walk'). */
type Help = [Action[], string];
const CAR_HELP: Help[] = [
  [['accelerate'], 'accelerate'],
  [['brake'], 'brake/reverse'],
  [['steerLeft', 'steerRight'], 'steer'],
  [['handbrake'], 'handbrake'],
  [['getOut'], 'get out'],
  [['flip'], 'flip upright'],
  [['newCar'], 'new car'],
];
const FOOT_HELP: Help[] = [
  [['forward', 'left', 'back', 'right'], 'walk'],
  [['run'], 'run'],
  [['jump'], 'jump'],
  [['use'], 'interact'],
  [['punch'], 'punch'],
  [['kick'], 'kick'],
  [['dance'], 'dance'],
  [['journal'], 'journal'],
];
const RIDE_HELP: Help[] = [
  [['getOut'], 'get out'],
  [['changeSeat'], 'change seats'],
];
const COMMON_HELP: Help[] = [
  [['map'], 'map'],
  [['mute'], 'mute'],
  [['fullscreen'], 'fullscreen'],
  [['chat'], 'chat'],
];

/** The help line's words for `help`, leaving out actions without a key. */
function helpWords(help: Help[]): string[] {
  return help.map(([actions, what]) => [keysWord(...actions), what]).filter(([keys]) => keys).map(([keys, what]) => `${keys} ${what}`);
}

/** Shows the speedometer and driving help in the car, walking help on foot, and what to do riding along. */
export function renderMode(mode: Mode, pointerLocked: boolean): void {
  const car = $('help-car');
  car.hidden = !settings.showHelp || mode !== 'car';
  const foot = $('help-foot');
  foot.hidden = !settings.showHelp || mode !== 'foot';
  const ride = $('help-ride');
  ride.hidden = !settings.showHelp || mode !== 'passenger';
  const look = pointerLocked ? 'Mouse or arrows look' : 'Click to look with the mouse';
  const common = [...helpWords(COMMON_HELP), 'Esc menu', ...(labelOf('help') ? [`${labelOf('help')} hide help`] : [])];
  setHelp(car, [...helpWords(CAR_HELP), ...common]);
  setHelp(foot, [...helpWords(FOOT_HELP.slice(0, 3)), look, ...helpWords(FOOT_HELP.slice(3)), ...common]);
  setHelp(ride, [...helpWords(RIDE_HELP), look.replace('Mouse or arrows look', 'Mouse looks about'), ...common]);
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

/** The "press E to ..." hint for whatever is in reach (on a phone or tablet, tap it). */
export function renderPrompt(i: Interaction, remote: { on: boolean } | null = null): void {
  let html = '';
  if (i?.kind === 'enter-car') {
    // The wheel if nobody has it, else a seat beside whoever does.
    const whose = i.owner ? `${escapeHtml(i.owner)}'s car` : 'your car';
    if (i.seat.n === 0) html = action('use', i.owner ? `Drive ${whose}` : 'Get in');
    else html = action('use', i.driver ? `Ride with ${escapeHtml(i.driver)}` : 'Get in', i.driver && i.owner && i.driver !== i.owner ? `in ${whose}` : undefined);
  } else if (i?.kind === 'car-full') html = `<span class="waiting">${i.owner ? `${escapeHtml(i.owner)}'s car` : 'Your car'} is full</span>`;
  else if (i?.kind === 'exit-car' && i.moveOver) html = action('changeSeat', 'Move over', `let ${escapeHtml(i.moveOver)} drive`);
  else if (i?.kind === 'ride') {
    const where = i.owner ? `${escapeHtml(i.owner)}'s car` : 'your car';
    const riding = i.driver ? `Riding with ${escapeHtml(i.driver)}` : `In ${where}`;
    html = i.canExit ? action('getOut', 'Get out') + (i.takeWheel ? action('changeSeat', 'Take the wheel') : '') : `<span class="waiting">${riding}</span>`;
  } else if (i?.kind === 'door') html = action('use', `${i.open ? 'Close' : 'Open'} door`, escapeHtml(i.address));
  else if (i?.kind === 'sit') html = action('use', 'Sit down', i.seat.label);
  else if (i?.kind === 'stand') html = remote ? action('use', 'Stand up') + action('remote', `TV ${remote.on ? 'off' : 'on'}`) : action('use', 'Stand up', 'or move');
  else if (i?.kind === 'switch' && i.appliance === 'fire') html = action('use', `${i.on ? 'Put out' : 'Light'} the fire`);
  else if (i?.kind === 'switch') html = action('use', `Turn ${i.on ? 'off' : 'on'} the ${i.appliance === 'tv' ? 'TV' : i.appliance}`);
  else if (i?.kind === 'leave') html = i.blocked ? `<span class="waiting">${escapeHtml(i.blocked)}</span>` : action('use', 'Get off', escapeHtml(i.label));
  else if (i?.kind === 'activity') {
    const { action: label, waiting } = i.prompt;
    const detail = i.prompt.detail && escapeHtml(keyWords(i.prompt.detail));
    if (waiting) html = `<span class="waiting">${escapeHtml(label)}</span>${detail ? `<small>${detail}</small>` : ''}`;
    else html = action('use', escapeHtml(label), detail);
  }
  if (html === lastPrompt) return;
  lastPrompt = html;
  const el = $('hud-prompt');
  el.hidden = !html;
  el.innerHTML = html;
}

/** Something to do: press `does`'s key (`label`, then a word on what, if `detail`). Tapping it does it too. */
function action(does: Action, label: string, detail?: string): string {
  const key = labelOf(does);
  return `<span class="act" data-key="@${does}">${key ? `<kbd>${escapeHtml(key)}</kbd>` : ''}${label}${detail ? `<small>${detail}</small>` : ''}</span>`;
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
/** The jetpack's fuel gauge (null: no jetpack). */
export function renderFuel(fuel: number | null): void {
  const panel = $('hud-fuel');
  if (panel.hidden !== (fuel === null)) panel.hidden = fuel === null;
  if (fuel === null) return;
  const bar = $('hud-fuel-bar');
  bar.style.width = `${Math.round(fuel * 100)}%`;
  bar.classList.toggle('low', fuel < 0.2);
}

/** The car's condition under the speed (shown once it's taken damage): 0..1, and wrecked. */
export function renderCarHealth(health: number, show: boolean): void {
  const row = $('hud-car');
  if (row.hidden === show) row.hidden = !show;
  if (!show) return;
  const bar = $('hud-car-bar');
  bar.style.width = `${Math.round(health * 100)}%`;
  bar.classList.toggle('worn', health < 0.6 && health >= 0.3);
  bar.classList.toggle('bad', health < 0.3);
  $('hud-car-label').textContent = health <= 0 ? 'Wrecked · T' : 'Car';
}

/** The player's health (0..100), shown while hurt, and a red flash when hit (0..1). */
export function renderHealth(value: number, flash: number): void {
  const panel = $('hud-health');
  const show = value < 100;
  if (panel.hidden === show) panel.hidden = !show;
  $('hud-health-bar').style.width = `${Math.round(value)}%`;
  const hurt = $('hurt');
  const amount = Math.max(flash, value < 35 ? (35 - value) / 70 : 0);
  hurt.hidden = amount <= 0.01;
  if (amount > 0.01) hurt.style.opacity = amount.toFixed(2);
}

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
