import { ROOM_CODE_LENGTH } from '../../../shared/protocol.ts';

const NAME_KEY = 'tengame.name';

export interface LobbyChoice {
  name: string;
  /** Room to join; undefined means create a new one. */
  room?: string;
}

/**
 * Shows the lobby and calls `onSubmit` for each attempt. If it throws,
 * the error is shown and the player can try again.
 */
export function runLobby(onSubmit: (choice: LobbyChoice) => Promise<void>): void {
  const form = document.getElementById('lobby-form') as HTMLFormElement;
  const nameInput = document.getElementById('name') as HTMLInputElement;
  const codeInput = document.getElementById('room-code') as HTMLInputElement;
  const error = document.getElementById('lobby-error')!;
  const buttons = form.querySelectorAll('button');

  nameInput.value = loadName();
  codeInput.value = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  (codeInput.value ? document.getElementById('join')! : nameInput).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = (e.submitter as HTMLButtonElement | null)?.value ?? (codeInput.value ? 'join' : 'create');
    const name = nameInput.value.trim();
    const room = codeInput.value.trim().toUpperCase();

    if (action === 'join' && room.length !== ROOM_CODE_LENGTH) {
      error.textContent = `Room codes are ${ROOM_CODE_LENGTH} characters.`;
      return;
    }

    saveName(name);
    error.textContent = '';
    buttons.forEach((b) => (b.disabled = true));
    try {
      await onSubmit({ name, room: action === 'join' ? room : undefined });
      document.getElementById('lobby')!.hidden = true;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage unavailable (private mode); the name just won't be remembered.
  }
}
