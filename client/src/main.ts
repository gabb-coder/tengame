import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TICK_RATE, type PlayerInfo, type WelcomeMessage } from '../../shared/protocol.ts';
import { Sounds } from './audio/sounds.ts';
import { LocalPlayer } from './game/localPlayer.ts';
import { Input } from './input.ts';
import { Connection } from './net/connection.ts';
import { RemotePlayers } from './net/remotePlayers.ts';
import { renderGauges, renderMode, renderPlayerList, renderPrompt, showDisconnected, showHud } from './ui/hud.ts';
import { runLobby } from './ui/lobby.ts';
import { CAR } from './vehicles/carPhysics.ts';
import { Doors } from './world/doors.ts';
import { InteriorLights } from './world/interiorLights.ts';
import { World } from './world/world.ts';

const SEND_INTERVAL_MS = 1000 / TICK_RATE;
const PHYSICS_STEP = 1 / 60;

// Load the physics WASM while the player is in the lobby.
const physicsReady = RAPIER.init();

runLobby(async ({ name, room }) => {
  // Browsers only allow audio to start from a user gesture, like this click.
  const listener = new THREE.AudioListener();
  void listener.context.resume();
  const [{ conn, welcome }] = await Promise.all([Connection.join(name, room), physicsReady]);
  history.replaceState(null, '', `?room=${welcome.room}`);
  startGame(conn, welcome, listener);
});

function startGame(conn: Connection, welcome: WelcomeMessage, listener: THREE.AudioListener): void {
  const container = document.getElementById('app')!;
  const world = new World(container);
  world.physics.timestep = PHYSICS_STEP;

  const labels = new CSS2DRenderer();
  labels.domElement.style.position = 'fixed';
  labels.domElement.style.inset = '0';
  labels.domElement.style.pointerEvents = 'none';
  container.appendChild(labels.domElement);

  const resize = () => {
    world.resize(innerWidth, innerHeight);
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

  const sounds = new Sounds(listener);
  const doors = new Doors(world.scene, world.town.layout.houses, world.materials, world.physics);
  doors.onSwing = (position, opening) => sounds.door(position, opening);
  for (const id of welcome.openDoors) doors.setOpen(id, true, true);
  const interiorLights = new InteriorLights(world.scene, world.town.layout.houses, world.town.interiors);

  const me = welcome.players.find((p) => p.id === welcome.id)!;
  // Separate spawn points so players don't start inside each other.
  const spawns = world.town.layout.spawns;
  const spawn = spawns[(welcome.players.length - 1) % spawns.length];
  const player = new LocalPlayer(world, doors, sounds, me.id, me.color, { position: new THREE.Vector3(spawn.x, 0.8, spawn.z), yaw: spawn.rotation }, listener);
  player.requestDoor = (id, open) => conn.send({ type: 'door', id, open });
  const car = player.car;

  const remotes = new RemotePlayers(world.scene, welcome.id, listener);
  welcome.players.forEach((p) => remotes.add(p));

  const players = new Map<string, PlayerInfo>(welcome.players.map((p) => [p.id, p]));
  const refreshList = () => renderPlayerList([...players.values()], welcome.id);
  showHud(welcome.room);
  refreshList();

  conn.on((msg) => {
    switch (msg.type) {
      case 'player_joined':
        players.set(msg.player.id, msg.player);
        remotes.add(msg.player);
        refreshList();
        break;
      case 'player_left':
        players.delete(msg.id);
        remotes.remove(msg.id);
        refreshList();
        break;
      case 'snapshot':
        remotes.applySnapshot(msg.players, performance.now());
        break;
      case 'door':
        doors.setOpen(msg.id, msg.open);
        break;
    }
  });
  conn.onClose = showDisconnected;

  const input = new Input(world.renderer.domElement);
  let accumulator = 0;
  let lastSend = 0;
  let last = performance.now();

  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    accumulator += dt;
    last = now;

    if (input.wasPressed('KeyM')) {
      muted = !muted;
      listener.setMasterVolume(muted ? 0 : 1);
    }

    // Fixed-step physics keeps handling identical across frame rates.
    while (accumulator >= PHYSICS_STEP) {
      player.fixedStep(input, PHYSICS_STEP);
      world.physics.step();
      accumulator -= PHYSICS_STEP;
    }
    doors.update(dt);
    player.update(input, dt);
    input.endFrame();

    if (now - lastSend >= SEND_INTERVAL_MS) {
      conn.send({ type: 'state', ...car.transform, car: car.state, avatar: player.avatarState });
      lastSend = now;
    }

    remotes.update(now, dt);
    world.followSun(player.focus);
    interiorLights.update(player.focus);
    world.setIndoor(interiorLights.inside, dt);
    world.town.updateInteriors(world.camera.position);

    renderMode(player.mode, input.pointerLocked);
    renderPrompt(player.interaction);
    const speed = car.physics.speed;
    renderGauges(Math.abs(speed) < 0.3 ? 0 : speed, car.physics.gear, car.physics.rpm / CAR.redlineRpm);

    world.renderer.render(world.scene, world.camera);
    labels.render(world.scene, world.camera);
  });
}
