import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TICK_RATE, type PlayerInfo, type WelcomeMessage } from '../../shared/protocol.ts';
import { Media } from './assets/media.ts';
import { Sounds } from './audio/sounds.ts';
import { Labels } from './render/labels.ts';
import { PostFX } from './render/postfx.ts';
import { LocalPlayer } from './game/localPlayer.ts';
import { Input } from './input.ts';
import { MissionClient } from './game/missions.ts';
import { Connection } from './net/connection.ts';
import { RemotePlayers } from './net/remotePlayers.ts';
import { applyHudSettings, renderClock, renderFps, renderFuel, renderGauges, renderMode, renderPlayerList, renderPrompt, renderUnderwater, renderWarmth, renderZone, showDisconnected, showHud, toggleHelp } from './ui/hud.ts';
import { Fishing } from './game/fishing.ts';
import { AmbientSound } from './audio/ambience.ts';
import { zoneWeights } from './world/zones/ambience.ts';
import { ERUPT_EVERY, ERUPTION } from './world/zones/prehistoric.ts';
import { Relics } from './game/relics.ts';
import { Journal } from './ui/journal.ts';
import { FIRE_WARMTH_RANGE, Warmth } from './game/warmth.ts';
import { Menu } from './ui/menu.ts';
import { onSettings, settings } from './settings.ts';
import { Chat } from './ui/chat.ts';
import { runLobby, setLobbyStatus } from './ui/lobby.ts';
import { Minimap } from './ui/minimap.ts';
import { TitleScene } from './ui/titleScene.ts';
import { showNotice } from './ui/notices.ts';
import { CAR } from './vehicles/carPhysics.ts';
import { Appliances } from './world/appliances.ts';
import { Doors } from './world/doors.ts';
import { seatsOf } from './world/seats.ts';
import { InteriorLights } from './world/interiorLights.ts';
import { StreetLights } from './world/streetLights.ts';
import { FurnitureModels } from './world/town/furnitureModels.ts';
import { applyRealTextures } from './world/town/realTextures.ts';
import { applyZoneTextures } from './world/zones/materials.ts';
import { lampPositions } from './world/town/roads.ts';
import { CarModel } from './vehicles/carModel.ts';
import { AvatarModel } from './player/avatarModel.ts';
import { World } from './world/world.ts';
import { generateWorld, zoneAt, ZONES } from '../../shared/world.ts';
import { syncClock, worldSeconds } from './game/clock.ts';
import { game, playTrigger } from './game/link.ts';
import { markFired, zoneSeats } from './world/zones/buttons.ts';

const SEND_INTERVAL_MS = 1000 / TICK_RATE;
const PHYSICS_STEP = 1 / 60;

// Load the physics WASM, real textures and models while the player is in the lobby.
const physicsReady = RAPIER.init();
const media = new Media();
CarModel.load(media);
AvatarModel.load(media);
/** How long to wait for textures before starting with the generated ones. */
const TEXTURE_WAIT_MS = 8000;
/** How long to wait for shaders to build before starting anyway. */
const COMPILE_WAIT_MS = 15000;

const container = document.getElementById('app')!;
const nextPaint = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done)));

// Build the town as soon as physics is ready, and show it behind the title screen.
const titleReady = physicsReady.then(nextPaint).then(() => {
  const world = new World(container, media);
  world.physics.timestep = PHYSICS_STEP;
  // Real textures replace the generated ones as they arrive.
  void media.textures.then((textures) => applyRealTextures(world.materials, textures));
  void media.zoneTextures.then((textures) => {
    applyZoneTextures(world.zoneMaterials, textures);
    applyRealTextures(world.materials, textures);
  });
  const title = new TitleScene(world);
  title.start();
  return { world, title };
});

runLobby(async ({ name, room, mode }) => {
  // Browsers only allow audio to start from a user gesture, like this click.
  const listener = new THREE.AudioListener();
  void listener.context.resume();
  const [{ conn, welcome }, { world, title }] = await Promise.all([Connection.join(name, room, mode), titleReady]);
  history.replaceState(null, '', `?room=${welcome.room}`);
  setLobbyStatus('Loading textures…');
  await Promise.race([media.textures, new Promise((done) => setTimeout(done, TEXTURE_WAIT_MS))]);
  title.stop();
  setLobbyStatus('Preparing graphics…');
  await startGame(conn, welcome, listener, world);
});

async function startGame(conn: Connection, welcome: WelcomeMessage, listener: THREE.AudioListener, world: World): Promise<void> {
  syncClock(welcome.now);
  // Real furniture replaces the generated stand-ins as the models arrive.
  const furniture = new FurnitureModels(world.town.furniture, media);

  const labels = new Labels();
  container.appendChild(labels.domElement);

  const postfx = new PostFX(world.renderer, world.scene, world.camera);

  const resize = () => {
    world.resize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  resize();

  world.camera.add(listener);
  // Pause sound when the tab is hidden, since the game loop stops too.
  document.addEventListener('visibilitychange', () => {
    void (document.hidden ? listener.context.suspend() : listener.context.resume());
  });
  let muted = false;
  const applyVolume = () => listener.setMasterVolume(muted ? 0 : settings.volume);
  onSettings((s) => {
    postfx.setQuality(s.quality);
    world.grass.setQuality(s.quality);
    applyVolume();
    applyHudSettings(s);
  });

  const sounds = new Sounds(listener);
  const ambientSound = new AmbientSound(listener);
  onSettings((s) => ambientSound.setVolume(s.ambience));
  const doors = new Doors(world.scene, world.town.houses, world.materials, world.physics);
  doors.onSwing = (position, opening) => sounds.door(position, opening);
  for (const id of welcome.openDoors) doors.setOpen(id, true, true);
  const appliances = new Appliances(world.scene, world.town.houses, world.town.interiors, generateWorld().fires, world.materials, world.lights);
  for (const id of welcome.switchedOn) appliances.setOn(id, true);
  const interiorLights = new InteriorLights(world.lights, world.town.houses, world.town.interiors);
  const streetLights = new StreetLights(world.lights, lampPositions(world.town.layout), world.materials.lampGlow);

  const me = welcome.players.find((p) => p.id === welcome.id)!;
  // Separate spawn points so players don't start inside each other.
  const spawns = world.town.layout.spawns;
  const spawn = spawns[(welcome.players.length - 1) % spawns.length];
  const player = new LocalPlayer(world, doors, sounds, me.id, me.color, { position: new THREE.Vector3(spawn.x, 0.8, spawn.z), yaw: spawn.rotation }, listener);
  player.requestDoor = (id, open) => conn.send({ type: 'door', id, open });
  player.requestSwitch = (id, on) => conn.send({ type: 'switch', id, on });
  player.appliances = appliances;
  player.activities = game.activities;
  player.seats = [...world.town.houses.flatMap((h) => seatsOf(h, world.town.interiors.get(h.id)!)), ...zoneSeats];
  const car = player.car;
  // Let the rides, buttons and treasures out in the world reach the player and the server.
  Object.assign(game, {
    ride: (mount: Parameters<typeof player.ride>[0]) => player.ride(mount),
    riding: (mount?: Parameters<typeof player.ride>[0]) => player.riding(mount),
    launch: (v: THREE.Vector3Like) => player.launch(v),
    placeAt: (p: THREE.Vector3Like, yaw: number) => player.placeAt(p, yaw),
    playOnce: (act: Parameters<typeof player.playOnce>[0]) => player.playOnce(act),
    startTask: (act: Parameters<typeof player.playOnce>[0], yaw: number, stop: () => void) => player.startTask(act, yaw, stop),
    stopTask: () => player.stopTask(),
    wearJetpack: (on: boolean) => player.wearJetpack(on),
    hasJetpack: () => player.jetpack !== null,
    trigger: (id: string) => conn.send({ type: 'trigger', id }),
    notice: showNotice,
    sounds,
  });
  game.player.id = me.id;

  // Treasures to find and fish to catch, both written up in the journal.
  const relics = new Relics();
  const fishing = new Fishing();
  fishing.rodTip = (out) => player.rodTip(out);
  game.activities.add(...fishing.activities());
  world.scene.add(relics.group, fishing.group);
  const journal = new Journal(relics.found, fishing.records);
  relics.onFound = () => journal.render();
  fishing.onCatch = () => journal.render();

  const remotes = new RemotePlayers(world.scene, world.physics, welcome.id, listener);
  welcome.players.forEach((p) => remotes.add(p));
  player.takenSeats = () => remotes.seatedPositions();

  const players = new Map<string, PlayerInfo>(welcome.players.map((p) => [p.id, p]));
  const missionsMode = welcome.mode === 'missions';
  let scores = welcome.scores;
  const refreshList = () => renderPlayerList([...players.values()], welcome.id, missionsMode ? scores : undefined);
  showHud(welcome.room, welcome.mode);
  document.getElementById('hud-clock-hint')!.hidden = welcome.mode !== 'freeroam';
  refreshList();

  const missions = new MissionClient(world.scene, welcome.id, player, (id) =>
    id === welcome.id ? { position: player.focus, walking: player.mode === 'foot' } : remotes.locate(id),
  );
  missions.apply(welcome.mission, performance.now());
  world.dayNight.setClock(welcome.clock, performance.now());

  const warmth = new Warmth();
  const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, document.getElementById('map-label')!, world.town.layout, world.terrain.heights);
  const view = new THREE.Vector3();

  const input = new Input(world.renderer.domElement);
  const chat = new Chat();
  chat.onSend = (text) => conn.send({ type: 'chat', text });
  chat.onOpen = () => input.releaseAll();

  // The in-game menu: Esc (or the Menu button). Game keys pause while it's open.
  const menu = new Menu(welcome.room);
  menu.onToggle = (open) => {
    input.enabled = !open;
    input.releaseAll();
  };
  // Esc while the mouse is captured releases it (the browser's rule), so that opens the
  // menu too, unless chat or the menu itself let the mouse go. Browsers differ on whether
  // that Esc also arrives as a key press, so ignore one that follows right after.
  let wasLocked = false;
  let openedOnUnlock = -Infinity;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement !== null;
    if (wasLocked && !locked && !chat.isOpen && !menu.isOpen) {
      menu.open();
      openedOnUnlock = performance.now();
    }
    wasLocked = locked;
  });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || chat.isOpen || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    if (document.pointerLockElement || performance.now() - openedOnUnlock < 400) return;
    menu.toggle();
  });
  chat.system(missionsMode ? 'Missions mode: follow the arrow at the top of the screen. Press Enter to chat.' : 'Free roam. Press Enter to chat.');

  conn.on((msg) => {
    switch (msg.type) {
      case 'player_joined':
        players.set(msg.player.id, msg.player);
        remotes.add(msg.player);
        refreshList();
        chat.system(`${msg.player.name} joined`);
        break;
      case 'player_left':
        chat.system(`${players.get(msg.id)?.name ?? 'Someone'} left`);
        players.delete(msg.id);
        remotes.remove(msg.id);
        refreshList();
        break;
      case 'chat':
        chat.add(msg, players.get(msg.id)?.color ?? '#fff');
        break;
      case 'notice':
        showNotice(msg.text);
        break;
      case 'mission':
        missions.apply(msg.mission, performance.now());
        break;
      case 'time':
        world.dayNight.setClock(msg.clock, performance.now());
        break;
      case 'scores':
        scores = msg.scores;
        refreshList();
        break;
      case 'snapshot':
        remotes.applySnapshot(msg.players, performance.now());
        break;
      case 'door':
        doors.setOpen(msg.id, msg.open);
        break;
      case 'trigger':
        markFired(msg.id);
        playTrigger(msg.id, msg.by);
        break;
      case 'switch': {
        appliances.setOn(msg.id, msg.on);
        const a = appliances.get(msg.id);
        if (a) sounds.click(a.world);
        break;
      }
    }
  });
  conn.onClose = showDisconnected;

  let accumulator = 0;
  let lastSend = 0;
  let last = performance.now();

  const frame = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    accumulator += dt;
    last = now;

    if (input.wasPressed('KeyN') && welcome.mode === 'freeroam') conn.send({ type: 'time', skip: 2 });
    if (input.wasPressed('KeyM')) {
      muted = !muted;
      applyVolume();
    }
    if (input.wasPressed('KeyH')) toggleHelp();
    if (input.wasPressed('KeyJ')) menu.open('journal');
    if (input.wasPressed('KeyF')) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    }

    // Fixed-step physics keeps handling identical across frame rates.
    while (accumulator >= PHYSICS_STEP) {
      player.fixedStep(input, PHYSICS_STEP);
      world.stepPhysics();
      accumulator -= PHYSICS_STEP;
    }
    doors.update(dt);
    world.water.update(dt);
    player.chatting = chat.isOpen;
    player.update(input, dt);
    input.endFrame();
    game.player.position.copy(player.focus);
    game.player.onFoot = player.mode === 'foot';
    game.player.grounded = player.mode === 'foot' && player.grounded;
    relics.update(dt, world.camera.position);
    fishing.update(dt);
    // Jetpacks belong to Outpost Nova: wander off (or drive off) and it goes back.
    if (player.jetpack && (player.mode === 'car' || zoneAt(player.focus.x, player.focus.z) !== 'space')) {
      player.wearJetpack(false);
      showNotice('You left the jetpack at Outpost Nova');
    }
    renderFuel(player.jetpack?.fuel ?? null);

    if (now - lastSend >= SEND_INTERVAL_MS) {
      conn.send({ type: 'state', ...car.transform, car: car.state, avatar: player.avatarState });
      lastSend = now;
    }

    remotes.update(now, dt);
    missions.update(now, world.camera);
    interiorLights.update(player.focus);
    const ambience = world.zones.update(dt, world.camera, player.focus, world.dayNight.night, interiorLights.inside);
    const cam = world.camera.position;
    world.grass.update(dt, cam, player.mode === 'foot' ? player.focus : null);
    ambientSound.update(dt, {
      weights: zoneWeights(cam.x, cam.z),
      night: world.dayNight.night,
      rain: ambience.weather.rain ?? 0,
      submerged: world.zones.submerged,
      sheltered: interiorLights.inside,
      camera: cam,
      fire: appliances.nearestFire(cam),
      erupting: worldSeconds() % ERUPT_EVERY < ERUPTION,
      jetting: !!player.jetpack?.thrusting,
    });
    world.dayNight.update(now, dt, player.focus, interiorLights.inside, ambience);
    const zone = ZONES[zoneAt(player.focus.x, player.focus.z)];
    renderZone(zone.name, zone.theme, dt);
    renderUnderwater(world.zones.submerged);
    // Arctic survival: keep warm by fires, indoors or in the car.
    warmth.update(dt, { position: player.focus, onFoot: player.mode === 'foot', indoors: interiorLights.inside, nearFire: appliances.litFireNear(player.focus, FIRE_WARMTH_RANGE) });
    player.speedScale = warmth.speed;
    renderWarmth(warmth.value, zone.id === 'arctic' && player.mode === 'foot');
    if (warmth.takeWarning()) showNotice("You're freezing! Warm up by a fire, indoors or in your car");
    const night = world.dayNight.night;
    streetLights.update(night);
    world.materials.glassOutsideLit.emissiveIntensity = night * 1.4;
    CarModel.setHeadlights(night);
    car.setNight(night);
    remotes.setNight(night);
    renderClock(world.dayNight.hours(now));
    world.town.updateInteriors(world.camera.position);
    furniture.update(world.camera.position);
    appliances.update(world.camera.position, dt);
    world.lights.update(dt, world.camera.position);

    renderMode(player.mode, input.pointerLocked);
    renderPrompt(player.interaction, player.remoteTv);
    const speed = car.physics.speed;
    renderGauges(Math.abs(speed) < 0.3 ? 0 : speed, car.physics.gear, car.physics.rpm / CAR.redlineRpm);
    if (settings.showFps) renderFps(now);
    world.camera.getWorldDirection(view);
    const focus = player.focus;
    minimap.update(
      { x: focus.x, z: focus.z, yaw: player.facing, color: me.color },
      Math.atan2(view.x, view.z),
      player.mode === 'car' ? speed : 0,
      remotes.markers(),
      missions.nextTarget,
      dt,
    );

    postfx.render(night);
    labels.render(world.camera);
  };

  // Build every shader while the lobby is still up, rather than freezing mid-game the
  // first time each thing comes into view.
  await Promise.race([postfx.compile(), new Promise((done) => setTimeout(done, COMPILE_WAIT_MS))]);
  last = performance.now();
  // The first frame finishes anything still being built (shadows, glow), lobby still up.
  frame();
  world.renderer.setAnimationLoop(frame);
}
