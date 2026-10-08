import type { PlayerInfo } from '../../../shared/protocol.ts';
import type { Interaction, Mode } from '../game/localPlayer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function showHud(roomCode: string): void {
  $('hud').hidden = false;
  $('hud-code').textContent = roomCode;

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

export function renderPlayerList(players: PlayerInfo[], localId: string): void {
  const list = $('hud-players');
  list.replaceChildren(
    ...players.map((p) => {
      const li = document.createElement('li');
      li.style.setProperty('--dot', p.color);
      li.textContent = p.id === localId ? `${p.name} (you)` : p.name;
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

/** Shows the speedometer and driving help in the car, walking help on foot. */
export function renderMode(mode: Mode, pointerLocked: boolean): void {
  $('help-car').hidden = mode !== 'car';
  const foot = $('help-foot');
  foot.hidden = mode !== 'foot';
  const look = pointerLocked ? 'Mouse or arrows look' : 'Click to look with the mouse';
  foot.textContent = `WASD walk · Shift run · Space jump · ${look} · E interact · M mute`;
  document.querySelector<HTMLElement>('.hud-speed')!.hidden = mode !== 'car';
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
