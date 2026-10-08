import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TICK_RATE, type PlayerInfo, type WelcomeMessage } from '../../shared/protocol.ts';
import { ChaseCamera } from './camera/chaseCamera.ts';
import { Input } from './input.ts';
import { Connection } from './net/connection.ts';
import { RemotePlayers } from './net/remotePlayers.ts';
import { renderGauges, renderPlayerList, showDisconnected, showHud } from './ui/hud.ts';
import { runLobby } from './ui/lobby.ts';
import { Car } from './vehicles/car.ts';
import { CAR } from './vehicles/carPhysics.ts';
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

  const me = welcome.players.find((p) => p.id === welcome.id)!;
  // Spread spawn points so players don't start inside each other.
  const slot = welcome.players.length - 1;
  const spawn = new THREE.Vector3(slot * 4 - 6, 1.2, 0);
  const car = new Car(world.physics, me.color, spawn, listener);
  world.scene.add(car.object);

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
    }
  });
  conn.onClose = showDisconnected;

  const input = new Input();
  const chase = new ChaseCamera(world.camera);
  let accumulator = 0;
  let lastSend = 0;
  let last = performance.now();

  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    accumulator += dt;
    last = now;

    if (input.wasPressed('KeyR')) car.reset();
    if (input.wasPressed('KeyM')) {
      muted = !muted;
      listener.setMasterVolume(muted ? 0 : 1);
    }
    input.endFrame();

    // Fixed-step physics keeps handling identical across frame rates.
    const controls = input.car;
    while (accumulator >= PHYSICS_STEP) {
      car.step(controls, PHYSICS_STEP);
      world.physics.step();
      accumulator -= PHYSICS_STEP;
    }
    car.update(dt);

    if (now - lastSend >= SEND_INTERVAL_MS) {
      conn.send({ type: 'state', ...car.transform, car: car.state });
      lastSend = now;
    }

    remotes.update(now, dt);

    const speed = car.physics.speed;
    chase.update(car.object, speed, dt);
    world.followSun(car.object.position);
    renderGauges(Math.abs(speed) < 0.3 ? 0 : speed, car.physics.gear, car.physics.rpm / CAR.redlineRpm);

    world.renderer.render(world.scene, world.camera);
    labels.render(world.scene, world.camera);
  });
}
