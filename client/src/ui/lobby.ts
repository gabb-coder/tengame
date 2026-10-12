import { CIRCUITS, isNightRace } from '../../../shared/circuits.ts';
import { type GameMode, ROOM_CODE_LENGTH } from '../../../shared/protocol.ts';
import { BOT_CHOICES, type Difficulty, LAP_CHOICES, type RaceSetup } from '../../../shared/racing.ts';

const NAME_KEY = 'tengame.name';
const RACE_KEY = 'tengame.race';

export interface LobbyChoice {
  name: string;
  /** Room to join; undefined means create a new one. */
  room?: string;
  /** Mode for a new room. */
  mode: GameMode;
  /** Racing: what the new room races. */
  race?: RaceSetup;
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
  const race = raceOptions(form);
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
      await onSubmit({ name, room: action === 'join' ? room : undefined, mode, race: mode === 'racing' ? race() : undefined });
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

/**
 * The racing options under the modes (shown when Racing is picked): which circuit (with its
 * outline drawn), how many laps, how many computer cars and how good they are. Remembers the
 * last choice. Returns a function reading the current setup.
 */
function raceOptions(form: HTMLFormElement): () => RaceSetup {
  const box = document.getElementById('race-options')!;
  const circuit = document.getElementById('race-circuit') as HTMLSelectElement;
  const laps = document.getElementById('race-laps') as HTMLSelectElement;
  const bots = document.getElementById('race-bots') as HTMLSelectElement;
  const difficulty = document.getElementById('race-difficulty') as HTMLSelectElement;
  const option = (value: string | number, text: string) => Object.assign(document.createElement('option'), { value: String(value), textContent: text });
  circuit.append(...CIRCUITS.map((c) => option(c.id, `${c.name}, ${c.country}`)));
  laps.append(...LAP_CHOICES.map((n) => option(n, `${n} laps`)));
  bots.append(...BOT_CHOICES.map((n) => option(n, n === 0 ? 'None' : String(n))));
  const saved = load();
  circuit.value = saved.circuit;
  laps.value = String(saved.laps);
  bots.value = String(saved.bots);
  difficulty.value = saved.difficulty;

  const read = (): RaceSetup => ({ circuit: circuit.value, laps: Number(laps.value), bots: Number(bots.value), difficulty: difficulty.value as Difficulty });
  const show = () => {
    const racing = form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === 'racing';
    box.hidden = !racing;
  };
  const describe = () => {
    const info = CIRCUITS.find((c) => c.id === circuit.value)!;
    const night = isNightRace(info) ? ' · night race under floodlights' : '';
    const street = info.style === 'street' ? ' · street circuit' : '';
    document.getElementById('race-track-meta')!.textContent = `${(info.length / 1000).toFixed(2)} km lap${street}${night}`;
    void drawOutline(info.id);
  };
  form.addEventListener('change', () => {
    show();
    describe();
    try {
      localStorage.setItem(RACE_KEY, JSON.stringify(read()));
    } catch {
      // Not remembered, that's all.
    }
  });
  show();
  describe();
  return read;
}

function load(): RaceSetup {
  const fallback: RaceSetup = { circuit: CIRCUITS[0].id, laps: 5, bots: 9, difficulty: 'normal' };
  try {
    const saved = JSON.parse(localStorage.getItem(RACE_KEY) ?? '{}') as Partial<RaceSetup>;
    return {
      circuit: CIRCUITS.some((c) => c.id === saved.circuit) ? saved.circuit! : fallback.circuit,
      laps: (LAP_CHOICES as readonly number[]).includes(saved.laps!) ? saved.laps! : fallback.laps,
      bots: (BOT_CHOICES as readonly number[]).includes(saved.bots!) ? saved.bots! : fallback.bots,
      difficulty: ['easy', 'normal', 'hard'].includes(saved.difficulty!) ? saved.difficulty! : fallback.difficulty,
    };
  } catch {
    return fallback;
  }
}

/** Draws a circuit's real outline, north up, with the start line marked. */
async function drawOutline(id: string): Promise<void> {
  const svg = document.getElementById('race-outline')!;
  svg.dataset.circuit = id;
  try {
    const data = (await (await fetch(`/media/circuits/${id}.json`)).json()) as { points: number[] };
    if (svg.dataset.circuit !== id) return;
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < data.points.length; i += 3 * 6) {
      xs.push(data.points[i]);
      zs.push(data.points[i + 2]);
    }
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const scale = 84 / Math.max(maxX - minX, maxZ - minZ);
    const px = (x: number) => (8 + (x - minX) * scale + (84 - (maxX - minX) * scale) / 2).toFixed(1);
    const pz = (z: number) => (8 + (z - minZ) * scale + (84 - (maxZ - minZ) * scale) / 2).toFixed(1);
    const d = xs.map((x, k) => `${k ? 'L' : 'M'}${px(x)} ${pz(zs[k])}`).join('') + 'Z';
    svg.innerHTML = `<path d="${d}"/><circle cx="${px(xs[0])}" cy="${pz(zs[0])}" r="3.2"/>`;
  } catch {
    svg.innerHTML = '';
  }
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
