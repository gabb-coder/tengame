import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { type CircuitData, circuitInfo } from '../../../shared/circuits.ts';
import { type PlayerInfo, TICK_RATE, type WelcomeMessage } from '../../../shared/protocol.ts';
import { botSkill, GRID_MS, lightsLit, TEAMS } from '../../../shared/racing.ts';
import { mulberry32 } from '../../../shared/town.ts';
import type { Media, TextureSet } from '../assets/media.ts';
import { touchDevice } from '../device.ts';
import { serverNow, syncClock } from '../game/clock.ts';
import { Input } from '../input.ts';
import type { Connection } from '../net/connection.ts';
import { Labels } from '../render/labels.ts';
import { PostFX, type Quality } from '../render/postfx.ts';
import { onSettings, settings } from '../settings.ts';
import { Chat } from '../ui/chat.ts';
import { applyHudSettings, renderFps, renderGauges, showDisconnected, showHud, toggleHelp } from '../ui/hud.ts';
import { setLobbyStatus } from '../ui/lobby.ts';
import { Menu } from '../ui/menu.ts';
import { showNotice } from '../ui/notices.ts';
import { TouchControls } from '../ui/touchControls.ts';
import type { CarControls } from '../vehicles/carPhysics.ts';
import { AiDriver } from './ai.ts';
import { Drs, type Runner, towFor } from './drs.ts';
import { F1 } from './f1.ts';
import { RaceCamera } from './raceCamera.ts';
import { RaceCar } from './raceCar.ts';
import { RaceHud, type Standing } from './raceHud.ts';
import { RaceMap } from './raceMap.ts';
import { RIDE_HEIGHT } from './racer.ts';
import { RaceWorld } from './raceWorld.ts';
import { EnginePool, Rivals } from './rivals.ts';

const SEND_MS = 1000 / TICK_RATE;
const PHYSICS_STEP = 1 / 60;
/** Other cars further than this (m) from the camera are drawn simpler and cast no shadow. */
const NEAR = 80;
/** Timing points every this many meters, for the gaps between cars. */
const SPLIT = 100;
/** How much of the circuit's crowd and scenery to build, by graphics quality. */
const DETAIL: Record<Quality, { crowd: number; scenery: number }> = {
  low: { crowd: 0.3, scenery: 0.4 },
  medium: { crowd: 0.65, scenery: 0.75 },
  high: { crowd: 0.9, scenery: 1 },
};

/** Where a car has got to in the race: distance covered from the start line (m), laps, and times at each timing point. */
interface Progress {
  dist: number;
  lastS: number;
  laps: number;
  lapStart: number;
  splits: number[];
}

export interface RaceStart {
  conn: Connection;
  welcome: WelcomeMessage;
  listener: THREE.AudioListener;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  media: Media;
}

/**
 * The racing mode: builds the room's circuit and runs its races. The player drives their
 * own car; one player's game also drives the computer cars (and sends where they are);
 * everyone else's cars come over the network. Each game times its own laps and reports
 * them, and the server referees.
 */
export async function startRace({ conn, welcome, listener, renderer, container, media }: RaceStart): Promise<void> {
  syncClock(welcome.now);
  let race = welcome.race!;
  const info = circuitInfo(race.setup.circuit);
  setLobbyStatus(`Loading ${info.name}…`);
  const [data, textures] = await Promise.all([fetch(`/media/circuits/${info.id}.json`).then((r) => r.json() as Promise<CircuitData>), loadTextures(media)]);
  setLobbyStatus(`Building ${info.name}…`);
  await new Promise((done) => requestAnimationFrame(() => setTimeout(done)));
  const world = new RaceWorld(renderer, info, data, textures, DETAIL[settings.quality]);
  const { track, line, layout, scene, camera, physics } = world;
  const surfaceOf = (c: RAPIER.Collider | null) => world.circuit.surfaceOf(c);
  const myId = welcome.id;

  const labels = new Labels();
  container.appendChild(labels.domElement);
  const postfx = new PostFX(renderer, scene, camera);
  const resize = () => {
    world.resize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  resize();
  camera.add(listener);
  scene.add(camera);
  document.addEventListener('visibilitychange', () => void (document.hidden ? listener.context.suspend() : listener.context.resume()));
  let muted = false;
  const applyVolume = () => listener.setMasterVolume(muted ? 0 : settings.volume);
  onSettings((s) => {
    postfx.setQuality(s.quality);
    applyVolume();
    applyHudSettings(s);
  });

  showHud(welcome.room, 'racing');
  document.getElementById('hud-mode')!.textContent = `Racing · ${info.name}`;
  const hud = new RaceHud();
  const map = new RaceMap(document.getElementById('minimap') as HTMLCanvasElement, track);
  const input = new Input(renderer.domElement);
  input.capturePointer = false;
  const chat = new Chat();
  chat.onSend = (text) => conn.send({ type: 'chat', text });
  chat.onOpen = () => input.releaseAll();
  const touch = touchDevice ? new TouchControls(input, { chat: () => chat.open(), racing: true }) : null;
  const menu = new Menu(welcome.room);
  menu.onToggle = (open) => {
    input.enabled = !open;
    input.releaseAll();
  };
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || chat.isOpen || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    menu.toggle();
  });
  const raceCam = new RaceCamera(camera);
  const rivals = new Rivals(scene, physics, track);
  const engines = new EnginePool(scene, listener);
  const drs = new Drs(track, world.drs);
  const players = new Map<string, PlayerInfo>(welcome.players.map((p) => [p.id, p]));

  let mine: RaceCar | null = null;
  let myTeam = -1;
  const bots = new Map<string, { car: RaceCar; ai: AiDriver; team: number }>();
  const progress = new Map<string, Progress>();
  /** The player's request to open the rear wing, held until it closes. */
  let drsWanted = false;
  let watching = 0;
  let lastLit = 0;
  const isHost = () => race.host === myId;

  /** Where grid slot `k` is, with the car's height over the road. */
  const slotPlace = (k: number) => {
    const slot = layout.gridSlot(k);
    const p = track.pointAt(slot.s, slot.lateral, { x: 0, y: 0, z: 0 });
    return { position: { x: p.x, y: p.y + RIDE_HEIGHT + 0.05, z: p.z }, yaw: track.heading(slot.s), s: slot.s };
  };

  /** Everyone back on the grid for a new race (or the grid changed while forming). */
  const lineUp = () => {
    progress.clear();
    race.cars.forEach((c, k) => {
      const slot = slotPlace(k);
      progress.set(c.id, { dist: track.delta(0, slot.s), lastS: slot.s, laps: 0, lapStart: 0, splits: [] });
    });
    const k = race.cars.findIndex((c) => c.id === myId);
    if (k >= 0) {
      const team = race.cars[k].team;
      if (!mine || myTeam !== team) {
        mine?.dispose();
        const slot = slotPlace(k);
        mine = new RaceCar(physics, track, TEAMS[team], slot.position, slot.yaw, surfaceOf, listener);
        scene.add(mine.object);
        myTeam = team;
      }
      const slot = slotPlace(k);
      mine.racer.place(slot.position, slot.yaw);
    } else {
      mine?.dispose();
      mine = null;
    }
    syncBots(true);
    syncRivals();
    rivals.reset();
    drs.reset();
    drsWanted = false;
    raceCam.snap();
  };

  /** The computer cars this game drives (if it runs the race); `regrid` puts them on their slots. */
  const syncBots = (regrid: boolean) => {
    const want = new Set(isHost() ? race.cars.filter((c) => c.bot && !c.out).map((c) => c.id) : []);
    for (const [id, b] of bots) {
      if (!want.has(id)) {
        b.car.dispose();
        bots.delete(id);
      }
    }
    race.cars.forEach((c, k) => {
      if (!want.has(c.id)) return;
      let b = bots.get(c.id);
      const n = Number(c.id.split(':')[1]);
      if (!b || b.team !== c.team) {
        b?.car.dispose();
        // Taking over from another game mid-race: start where it was seen.
        const seen = rivals.cars.get(c.id);
        const slot = slotPlace(k);
        const at = seen?.seen ? { position: seen.model.root.position.clone(), yaw: new THREE.Euler().setFromQuaternion(seen.model.root.quaternion, 'YXZ').y } : slot;
        const car = new RaceCar(physics, track, TEAMS[c.team], at.position, at.yaw, surfaceOf);
        if (seen?.seen) {
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(seen.model.root.quaternion).multiplyScalar(seen.speed);
          car.racer.body.setLinvel(forward, true);
          rivals.remove(c.id);
        }
        scene.add(car.object);
        b = { car, ai: new AiDriver(line, botSkill(race.setup, n), mulberry32(race.number * 97 + n)), team: c.team };
        bots.set(c.id, b);
      } else if (regrid) {
        const slot = slotPlace(k);
        b.car.racer.place(slot.position, slot.yaw);
      }
    });
  };

  /** Cars other games drive: the other players', and the computer cars when another game runs them. */
  const syncRivals = () => {
    const keep = new Set<string>();
    for (const c of race.cars) {
      if (c.id === myId || c.out || (c.bot && isHost())) continue;
      rivals.ensure(c.id, c.team, c.bot ? null : c.name);
      keep.add(c.id);
    }
    rivals.keepOnly(keep);
  };

  const raceTime = () => (serverNow() - race.startAt) / 1000;
  const racing = () => race.phase === 'racing' || race.phase === 'finished';

  /**
   * Moves a car's race distance on from `s`; returns a lap time when it just completed a lap.
   * `theirs`: a car another game drives, which may first show up far round the lap.
   */
  const advance = (id: string, s: number, now: number, theirs = false): number | null => {
    const p = progress.get(id);
    if (!p || !racing()) return null;
    const d = track.delta(p.lastS, s);
    if (Math.abs(d) < 60) p.dist += d;
    else if (theirs) {
      // Seen for the first time mid-race (we joined late): go by the laps the referee counted.
      const done = race.cars.find((c) => c.id === id)?.laps ?? p.laps;
      let at = track.wrap(s);
      // Not yet over the line for the first time: still behind it, on the way from the grid.
      if (done === 0 && at > track.length - 400) at -= track.length;
      p.dist = done * track.length + at;
      p.laps = done;
      p.lapStart = now;
    }
    p.lastS = s;
    for (let k = p.splits.length; k <= Math.floor(p.dist / SPLIT) && p.dist >= 0; k++) p.splits[k] = now;
    const laps = Math.floor(p.dist / track.length);
    if (laps <= p.laps) return null;
    p.laps = laps;
    const time = now - p.lapStart;
    p.lapStart = now;
    return time;
  };

  /** The order now: finishers by their time, then everyone else by distance covered. */
  const standings = (): (Standing & { dist: number })[] => {
    const rows = race.cars.map((car) => ({ car, dist: progress.get(car.id)?.dist ?? -Infinity, me: car.id === myId, gap: '' }));
    rows.sort((a, b) => {
      if (!!a.car.out !== !!b.car.out) return a.car.out ? 1 : -1;
      if (a.car.finish !== null && b.car.finish !== null) return a.car.finish - b.car.finish;
      if (a.car.finish !== null || b.car.finish !== null) return a.car.finish !== null ? -1 : 1;
      return b.dist - a.dist;
    });
    const leader = rows[0];
    rows.forEach((r, i) => {
      if (!racing()) r.gap = '';
      else if (r.car.finish !== null) r.gap = i === 0 ? lapClock(r.car.finish) : `+${(r.car.finish - leader.car.finish!).toFixed(3)}`;
      else if (i === 0) r.gap = 'Leader';
      else r.gap = gapText(leader.car.id, r.car.id);
    });
    return rows;
  };

  /** The time between two cars at the last timing point both have passed. */
  const gapSeconds = (ahead: string, behind: string): number | null => {
    const a = progress.get(ahead);
    const b = progress.get(behind);
    if (!a || !b) return null;
    const k = Math.min(a.splits.length, b.splits.length) - 1;
    // Just after a pass the cars swapped since that timing point: call it level.
    return k >= 0 ? Math.max(0, b.splits[k] - a.splits[k]) : null;
  };
  const gapText = (ahead: string, behind: string): string => {
    const a = progress.get(ahead);
    const b = progress.get(behind);
    if (a && b && a.dist - b.dist > track.length) return `+${Math.floor((a.dist - b.dist) / track.length)} lap${a.dist - b.dist >= 2 * track.length ? 's' : ''}`;
    const g = gapSeconds(ahead, behind);
    return g === null ? '' : `+${g.toFixed(3)}`;
  };

  /** Somewhere clear on the racing line at or behind `s`, for a car put back on the track. */
  const clearSpot = (s: number, runners: Runner[], self: string) => {
    for (let back = 0; back < 200; back += 8) {
      const at = track.wrap(s - back);
      if (!runners.some((r) => r.id !== self && Math.abs(track.delta(at, r.s)) < 12)) return at;
    }
    return s;
  };

  lineUp();

  conn.on((msg) => {
    switch (msg.type) {
      case 'race': {
        const before = race;
        race = msg.race;
        if (race.number !== before.number || race.phase === 'grid') lineUp();
        else {
          if (race.host !== before.host) syncBots(false);
          syncRivals();
        }
        if (race.phase === 'racing' && before.phase === 'lights') hud.say('Lights out and away we go!', 2500);
        break;
      }
      case 'player_joined':
        players.set(msg.player.id, msg.player);
        chat.system(`${msg.player.name} joined${race.phase === 'grid' ? '' : ': they race from the next start'}`);
        break;
      case 'player_left':
        chat.system(`${players.get(msg.id)?.name ?? 'Someone'} left`);
        players.delete(msg.id);
        rivals.remove(msg.id);
        break;
      case 'chat':
        chat.add(msg, '#ffd24a');
        break;
      case 'notice':
        showNotice(msg.text);
        break;
      case 'snapshot': {
        const now = performance.now();
        for (const p of msg.players) if (p.id !== myId) rivals.push(p.id, p.p, p.q, p.car, now);
        if (!isHost()) for (const b of msg.bots ?? []) rivals.push(`bot:${b.n}`, b.p, b.q, b.car, now);
        break;
      }
    }
  });
  conn.onClose = showDisconnected;
  chat.system(`Racing at ${info.name}, ${info.country}: ${race.setup.laps} laps. Press Enter to chat.`);

  /** The beep of each red light coming on. */
  const beep = (high: boolean) => {
    const ctx = listener.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = high ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(listener.getInput());
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  };

  let accumulator = 0;
  let last = performance.now();
  let lastSend = 0;
  let towerAt = 0;

  const frame = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    accumulator += dt;
    last = now;
    const time = raceTime();
    const go = race.phase === 'racing' || race.phase === 'finished';

    if (input.wasPressed('KeyM')) {
      muted = !muted;
      applyVolume();
    }
    if (input.wasPressed('KeyH')) toggleHelp();
    if (input.wasPressed('KeyF')) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    }
    if (input.wasPressed('KeyC')) {
      if (mine) raceCam.toggle();
      else watching++;
    }
    if (race.phase === 'grid' && isHost() && input.wasPressed('Space')) conn.send({ type: 'race_start' });
    if (mine && go && input.wasPressed('KeyT')) {
      const runners = everyone();
      mine.racer.placeOnTrack(clearSpot(mine.racer.s, runners, myId), line.offsetAt(mine.racer.s));
      raceCam.snap();
      showNotice('Back on the track');
    }
    if (mine && input.wasPressed('KeyQ')) {
      if (drs.open(myId, mine.racer.s)) drsWanted = true;
      else if (!drs.armed(myId)) showNotice(drsWhy());
    }

    // Fixed-step physics: our car, and the computer cars if this game drives them.
    while (accumulator >= PHYSICS_STEP) {
      const runners = everyone();
      if (mine) {
        const r = mine.racer;
        const from = r.s;
        r.locate();
        drs.moved(myId, from, r.s, time, (progress.get(myId)?.laps ?? 0) >= 1);
        let c: CarControls = input.car;
        c = { throttle: c.throttle, brake: Math.max(c.brake, c.handbrake ? 1 : 0), steer: c.steer, handbrake: false };
        // Waiting on the grid (or chatting): the car sits still (the brake pedal would reverse it).
        if (!go || chat.isOpen) c = { throttle: 0, brake: 0, steer: 0, handbrake: false };
        r.tow = towFor(track, runners.find((x) => x.id === myId)!, runners);
        r.drsOpen = drsWanted && drs.open(myId, r.s) && c.brake < 0.1;
        if (!r.drsOpen) drsWanted = false;
        mine.step(c, PHYSICS_STEP);
      }
      for (const [id, b] of bots) {
        const r = b.car.racer;
        const from = r.s;
        r.locate();
        drs.moved(id, from, r.s, time, (progress.get(id)?.laps ?? 0) >= 1);
        const others = runners.filter((x) => x.id !== id && Math.abs(track.delta(r.s, x.s)) < 60);
        const c = b.ai.drive(r, others, go, PHYSICS_STEP);
        r.tow = towFor(track, runners.find((x) => x.id === id)!, runners);
        r.drsOpen = drs.open(id, r.s) && c.brake === 0;
        b.car.step(c, PHYSICS_STEP);
        if (go && b.ai.needsRescue(r)) {
          r.placeOnTrack(clearSpot(r.s, runners, id), line.offsetAt(r.s));
          b.ai.rescued();
        }
      }
      world.stepPhysics();
      accumulator -= PHYSICS_STEP;
    }

    // Laps: ours and the computer cars' (reported to the referee), and everyone's progress.
    if (mine) {
      const lap = advance(myId, mine.racer.s, time);
      if (lap !== null) {
        const p = progress.get(myId)!;
        conn.send({ type: 'lap', lap: p.laps, time: lap, at: time });
        const left = race.setup.laps - p.laps;
        hud.say(left === 1 ? `Final lap · ${lapClock(lap)}` : left <= 0 || race.flag ? `Finished · ${lapClock(lap)}` : `Lap ${p.laps + 1} · ${lapClock(lap)}`, 3000);
      }
    }
    for (const [id, b] of bots) {
      const lap = advance(id, b.car.racer.s, time);
      if (lap !== null) conn.send({ type: 'lap', car: id, lap: progress.get(id)!.laps, time: lap, at: time });
    }
    rivals.update(now, dt);
    for (const r of rivals.cars.values()) {
      if (!r.seen) continue;
      const p = progress.get(r.id);
      const from = p?.lastS ?? r.s;
      advance(r.id, r.s, time, true);
      drs.moved(r.id, from, r.s, time, false);
    }

    // Drawing.
    mine?.update(dt);
    for (const b of bots.values()) {
      b.car.update(dt);
      b.car.model.setNear(b.car.object.position.distanceToSquared(camera.position) < NEAR * NEAR);
    }
    for (const r of rivals.cars.values()) r.model.setNear(r.model.root.position.distanceToSquared(camera.position) < NEAR * NEAR);
    const order = standings();
    const followed = mine?.object ?? watched(order);
    if (followed) raceCam.update(followed, mine ? mine.racer.speed : 0, dt);
    world.update(now, dt, camera.position);
    engines.update(
      [
        ...[...bots.values()].map((b) => ({ position: b.car.object.position, rpm: b.car.racer.physics.rpm, load: b.car.racer.physics.load })),
        ...[...rivals.cars.values()].filter((r) => r.seen).map((r) => ({ position: r.model.root.position, rpm: r.rpm, load: r.load })),
      ],
      camera.position,
    );

    // The start lights.
    let lit: number | null = null;
    if (race.phase === 'lights') lit = serverNow() < race.startAt ? lightsLit(serverNow() - race.lightsAt) : 0;
    else if (race.phase === 'racing' && time < 2) lit = 0;
    world.circuit.lights.set(lit ?? 0);
    hud.renderLights(lit);
    if (lit !== null && lit > lastLit) beep(false);
    if (lit === 0 && lastLit > 0) beep(true);
    lastLit = lit ?? 0;

    // The screens.
    hud.tick();
    if (race.phase === 'grid') {
      const left = Math.max(0, Math.ceil((race.until - serverNow()) / 1000));
      // The countdown waits for the host's game to build the circuit; the lights, for everyone's.
      const loading = race.cars.filter((c) => c.loading && !c.out);
      const waiting = left > GRID_MS / 1000 || (left === 0 && loading.length > 0);
      const who = loading.length ? loading.map((c) => c.name).join(', ') : (race.cars.find((c) => c.id === race.host)?.name ?? 'the host');
      hud.say(waiting ? `${mine ? 'On the grid' : 'Watching'} · waiting for ${who} to load the circuit` : `${mine ? 'On the grid' : 'Watching'} · lights in ${left} s${isHost() ? (touchDevice ? '' : ' · Space to start now') : ''}`);
    } else if (race.phase === 'lights') hud.say('');
    else if (!mine && racing()) hud.say(race.phase === 'racing' ? 'Watching · you race from the next start (C: next car)' : '', 0);
    if (now - towerAt > 250) {
      towerAt = now;
      const myProgress = progress.get(myId);
      hud.renderTower(order, race.setup.laps, order[0] ? (progress.get(order[0].car.id)?.laps ?? 0) : 0, race.phase);
      if (mine && myProgress) {
        const k = order.findIndex((r) => r.me);
        const entry = race.cars.find((c) => c.id === myId)!;
        hud.renderTiming({
          position: k + 1,
          of: order.filter((r) => !r.car.out).length,
          lap: myProgress.laps + 1,
          laps: race.setup.laps,
          current: racing() && entry.finish === null ? Math.max(0, time - myProgress.lapStart) : null,
          last: entry.last,
          best: entry.best,
          ahead: k > 0 ? gapText(order[k - 1].car.id, myId) : '',
          behind: k >= 0 && k < order.length - 1 ? gapText(myId, order[k + 1].car.id).replace('+', '-') : '',
        });
      } else hud.renderTiming(null);
      const fastest = race.cars.filter((c) => c.best !== null).sort((a, b) => a.best! - b.best!)[0];
      hud.renderResults(race.phase === 'finished' ? order : null, fastest ? { name: fastest.name, time: fastest.best! } : null, (race.until - serverNow()) / 1000, race.number);
    }
    if (mine) {
      const p = mine.racer.physics;
      renderGauges(Math.abs(p.speed) < 0.3 ? 0 : p.speed, p.gear, p.rpm / F1.redlineRpm);
      hud.renderDrs(mine.racer.drsOpen ? 'open' : drs.open(myId, mine.racer.s) ? 'ready' : drs.armed(myId) ? 'armed' : 'off');
    }
    document.querySelector<HTMLElement>('.hud-speed')!.hidden = !mine;
    hud.showHelp();
    touch?.update({ driving: !!mine, canUse: false, muted });
    map.render(
      race.cars
        .filter((c) => !c.out)
        .map((c) => {
          const pos = c.id === myId ? mine?.object.position : (bots.get(c.id)?.car.object.position ?? rivals.cars.get(c.id)?.model.root.position);
          return pos ? { x: pos.x, z: pos.z, team: c.team, me: c.id === myId } : null;
        })
        .filter((c) => c !== null),
    );
    if (settings.showFps) renderFps(now);

    // Telling the others.
    if (now - lastSend >= SEND_MS) {
      lastSend = now;
      if (mine) conn.send({ type: 'state', ...mine.transform, car: mine.state, avatar: null });
      if (isHost() && bots.size) {
        conn.send({
          type: 'bots',
          race: race.number,
          bots: [...bots].map(([id, b]) => ({ n: Number(id.split(':')[1]), ...b.car.transform, car: b.car.state })),
        });
      }
    }

    input.endFrame();
    postfx.render(world.dayNight.night);
    labels.render(camera);
  };

  /** Every car on the track as the rules see it. */
  function everyone(): Runner[] {
    const list: Runner[] = [];
    if (mine) list.push({ id: myId, s: mine.racer.s, lateral: mine.racer.lateral, speed: mine.racer.speed });
    for (const [id, b] of bots) list.push({ id, s: b.car.racer.s, lateral: b.car.racer.lateral, speed: b.car.racer.speed });
    for (const r of rivals.cars.values()) if (r.seen) list.push({ id: r.id, s: r.s, lateral: r.lateral, speed: r.speed });
    return list;
  }

  /** The car being watched while not racing: the leader, or the one C moved on to. */
  function watched(order: Standing[]): THREE.Object3D | null {
    const shown = order.filter((r) => !r.car.out);
    if (!shown.length) return null;
    const id = shown[watching % shown.length].car.id;
    return bots.get(id)?.car.object ?? rivals.cars.get(id)?.model.root ?? null;
  }

  /** Why the rear wing won't open. */
  function drsWhy(): string {
    if (!racing() || (progress.get(myId)?.laps ?? 0) < 1) return 'DRS opens from the second lap';
    return 'DRS: be within a second of the car ahead at the detection line';
  }

  await Promise.race([postfx.compile(), new Promise((done) => setTimeout(done, 15000))]);
  // Built: the grid's countdown can start (it waits for the host's game, the lights for everyone's).
  conn.send({ type: 'race_ready' });
  last = performance.now();
  frame();
  renderer.setAnimationLoop(frame);
}

/** m:ss.s for the timing screens. */
function lapClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(3).padStart(6, '0')}`;
}

/** Waits a while for the photo textures (town and zones), then makes do with what has loaded. */
async function loadTextures(media: Media): Promise<Map<string, TextureSet>> {
  const town = await Promise.race([media.textures, new Promise<Map<string, TextureSet>>((done) => setTimeout(() => done(new Map()), 10000))]);
  const zones = await Promise.race([media.zoneTextures, new Promise<Map<string, TextureSet>>((done) => setTimeout(() => done(new Map()), 6000))]);
  return new Map([...town, ...zones]);
}
