import { type GameMode, ROOM_CODE_LENGTH } from '../../../shared/protocol.ts';

const NAME_KEY = 'tengame.name';

export interface LobbyChoice {
  name: string;
  /** Room to join; undefined means create a new one. */
  room?: string;
  /** Mode for a new room. */
  mode: GameMode;
}

/**
 * Shows the title screen and calls `onSubmit` for each attempt. If it throws,
 * the error is shown and the player can try again.
 */
export function runLobby(onSubmit: (choice: LobbyChoice) => Promise<void>): void {
  const form = document.getElementById('lobby-form') as HTMLFormElement;
  const nameInput = document.getElementById('name') as HTMLInputElement;
  const codeInput = document.getElementById('room-code') as HTMLInputElement;
  const error = document.getElementById('lobby-error')!;
  const buttons = form.querySelectorAll('button');

  nameInput.value = loadName();
  const invited = new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, ROOM_CODE_LENGTH) ?? '';
  if (invited) {
    // Opened from an invite link: joining that room is the main action.
    codeInput.value = invited;
    form.classList.add('invited');
    document.getElementById('invite')!.hidden = false;
    document.getElementById('invite-code')!.textContent = invited;
  }
  document.getElementById('show-create')!.addEventListener('click', () => form.classList.add('creating'));
  (nameInput.value && invited ? document.getElementById('invite-join')! : nameInput).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Pressing Enter: join when invited (or a code was typed), otherwise create.
    const joining = invited ? !form.classList.contains('creating') : codeInput.value !== '';
    const action = (e.submitter as HTMLButtonElement | null)?.value ?? (joining ? 'join' : 'create');
    const name = nameInput.value.trim();
    const room = codeInput.value.trim().toUpperCase();

    if (action === 'join' && room.length !== ROOM_CODE_LENGTH) {
      error.textContent = `Room codes are ${ROOM_CODE_LENGTH} characters.`;
      codeInput.focus();
      return;
    }

    saveName(name);
    error.textContent = '';
    setLobbyStatus('Connecting…');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const mode = (form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? 'freeroam') as GameMode;
      await onSubmit({ name, room: action === 'join' ? room : undefined, mode });
      document.getElementById('lobby')!.hidden = true;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Something went wrong';
      // The invited room may be gone (e.g. everyone left): offer making a new one.
      if (invited) form.classList.add('creating');
    } finally {
      setLobbyStatus('');
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}

/** Progress text under the lobby buttons, with a spinner; empty hides it. */
export function setLobbyStatus(text: string): void {
  document.getElementById('lobby-status')!.hidden = !text;
  document.getElementById('lobby-status-text')!.textContent = text;
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
