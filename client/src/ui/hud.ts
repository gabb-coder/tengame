import type { PlayerInfo } from '../../../shared/protocol.ts';

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
