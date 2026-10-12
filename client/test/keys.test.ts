// Players can put each action on the key they like, and the keys never clash.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTION_IDS, changedKeys, DEFAULT_KEYS, keyLabel, keyOf, keysWord, keyWords, normalizeCode, rebind, refusal, resolveKeys, useCustomKeys } from '../src/keys.ts';
import { settings, updateSettings } from '../src/settings.ts';

test('every action starts on its own key, never sharing one with something it can happen alongside', () => {
  // Walking and driving can share keys (W walks, and accelerates), but nothing else can.
  const together = (a: string, b: string) => {
    const group = (x: string) => (['accelerate', 'brake', 'steerLeft', 'steerRight', 'handbrake', 'getOut', 'flip', 'newCar'].includes(x) ? 'car' : ['journal', 'map', 'chat', 'mute', 'fullscreen', 'help', 'skipTime'].includes(x) ? 'any' : 'foot');
    return group(a) === group(b) || group(a) === 'any' || group(b) === 'any';
  };
  for (const a of ACTION_IDS) for (const b of ACTION_IDS) if (a < b && together(a, b)) assert.notEqual(DEFAULT_KEYS[a], DEFAULT_KEYS[b], `${a} and ${b}`);
  assert.equal(DEFAULT_KEYS.punch, 'Mouse0', 'left click punches');
  assert.equal(DEFAULT_KEYS.kick, 'Mouse2', 'right click kicks');
});

test('putting an action on a taken key swaps the two, so nothing is lost', () => {
  // Dance onto E: "use" takes dance's old G.
  const { keys, moved } = rebind(DEFAULT_KEYS, 'dance', 'KeyE');
  assert.equal(keys.dance, 'KeyE');
  assert.equal(keys.use, 'KeyG');
  assert.deepEqual(moved, [{ action: 'use', to: 'KeyG' }]);
  // Driving's E (get out) never happens on foot, so it stays where it was.
  assert.equal(keys.getOut, 'KeyE');

  // Something for any time clashes with both: both move.
  const journal = rebind(DEFAULT_KEYS, 'journal', 'KeyW');
  assert.equal(journal.keys.forward, 'KeyJ');
  assert.equal(journal.keys.accelerate, 'KeyJ');
  assert.equal(journal.moved.length, 2);

  // The same key again: nothing changes.
  assert.deepEqual(rebind(DEFAULT_KEYS, 'jump', 'Space').moved, []);
});

test('a swap that would clash again leaves the other action without a key instead', () => {
  // Kick onto Q, then punch onto Q too: they trade, and kick gets Left click.
  const first = rebind(DEFAULT_KEYS, 'kick', 'KeyQ').keys;
  const second = rebind(first, 'punch', 'KeyQ');
  assert.equal(second.keys.kick, 'Mouse0');
  // Chat (a keyboard-only action) can't take a mouse button in a swap: it's left without a key.
  const chatOnF = rebind(DEFAULT_KEYS, 'chat', 'KeyF').keys;
  const punchOnF = rebind(chatOnF, 'punch', 'KeyF');
  assert.equal(punchOnF.keys.punch, 'KeyF');
  assert.equal(punchOnF.keys.chat, '');
  assert.deepEqual(punchOnF.moved, [{ action: 'chat', to: '' }]);
  // Fullscreen took Enter in the first swap; punch's old key is free.
  assert.equal(chatOnF.fullscreen, 'Enter');
});

test('Esc stays for the menu, and chat and the map need a keyboard key', () => {
  assert.ok(refusal('jump', 'Escape'));
  assert.ok(refusal('chat', 'Mouse1'));
  assert.ok(refusal('map', 'Mouse4'));
  assert.equal(refusal('jump', 'Mouse1'), null);
  assert.equal(refusal('chat', 'KeyT'), null);
});

test('saved keys are read carefully, and only changes are saved', () => {
  const keys = resolveKeys({ jump: 'KeyK', dance: 'Escape', chat: 'Mouse0', nonsense: 'KeyZ', kick: 42, run: '' });
  assert.equal(keys.jump, 'KeyK');
  assert.equal(keys.dance, 'KeyG', 'Esc is refused');
  assert.equal(keys.chat, 'Enter', 'a mouse button for chat is refused');
  assert.equal(keys.kick, 'Mouse2');
  assert.equal(keys.run, '', 'no key at all is allowed');
  assert.ok(!('nonsense' in keys));
  assert.deepEqual(changedKeys(keys), { jump: 'KeyK', run: '' });
  assert.deepEqual(resolveKeys('garbage'), DEFAULT_KEYS);
});

test('keys are named as they are printed, and left and right Shift count as one', () => {
  assert.equal(normalizeCode('ShiftRight'), 'Shift');
  assert.equal(normalizeCode('ControlLeft'), 'Control');
  assert.equal(normalizeCode('KeyQ'), 'KeyQ');
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit7'), '7');
  assert.equal(keyLabel('Mouse0'), 'Left click');
  assert.equal(keyLabel('Mouse2'), 'Right click');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('Numpad5'), 'Num 5');
  assert.equal(keyLabel('PrintScreen'), 'Print Screen');
  assert.equal(keyLabel(''), '');
});

test('free roam uses the player’s own keys, in the game’s words too; racing keeps the usual ones', () => {
  const saved = settings.keys;
  try {
    updateSettings({ keys: { journal: 'KeyU', newCar: 'KeyY', forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } });
    useCustomKeys(false);
    assert.equal(keyOf('journal'), 'KeyJ');
    assert.equal(keyWords('Press J to read your journal.'), 'Press J to read your journal.');
    useCustomKeys(true);
    assert.equal(keyOf('journal'), 'KeyU');
    assert.equal(keyWords('Press J to read your journal.'), 'Press U to read your journal.');
    assert.equal(keyWords('Your car is wrecked! Press T for a new one'), 'Your car is wrecked! Press Y for a new one');
    assert.equal(keyWords('hold Space to fly'), 'hold Space to fly');
    assert.equal(keysWord('forward', 'left', 'back', 'right'), '↑ ← ↓ →');
    updateSettings({ keys: {} });
    assert.equal(keysWord('forward', 'left', 'back', 'right'), 'WASD');
    assert.equal(keysWord('steerLeft', 'steerRight'), 'A D');
  } finally {
    updateSettings({ keys: saved });
    useCustomKeys(false);
  }
});
