import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TICK_RATE, type PlayerInfo, type WelcomeMessage } from '../../shared/protocol.ts';
import { Connection } from './net/connection.ts';
import { RemotePlayers } from './net/remotePlayers.ts';
import { Input } from './player/input.ts';
import { LocalPlayer } from './player/localPlayer.ts';
import { renderPlayerList, showDisconnected, showHud } from './ui/hud.ts';
import { runLobby } from './ui/lobby.ts';
import { World } from './world/world.ts';

const SEND_INTERVAL_MS = 1000 / TICK_RATE;
const PHYSICS_STEP = 1 / 60;

// Load the physics WASM while the player is in the lobby.
const physicsReady = RAPIER.init();

runLobby(async ({ name, room }) => {
  const [{ conn, welcome }] = await Promise.all([Connection.join(name, room), physicsReady]);
  history.replaceState(null, '', `?room=${welcome.room}`);
  startGame(conn, welcome);
});

function startGame(conn: Connection, welcome: WelcomeMessage): void {
  const container = document.getElementById('app')!;
  const world = new World(container);

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

  const me = welcome.players.find((p) => p.id === welcome.id)!;
  // Spread spawn points so players don't start inside each other.
  const slot = welcome.players.length - 1;
  const spawn = new THREE.Vector3(slot * 4 - 6, 2, 0);
  const local = new LocalPlayer(world.physics, me.color, spawn);
  world.scene.add(local.mesh);

  const remotes = new RemotePlayers(world.scene, welcome.id);
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
  const cameraOffset = new THREE.Vector3(0, 4, 9);
  const cameraTarget = new THREE.Vector3();
  let accumulator = 0;
  let lastSend = 0;
  let last = performance.now();

  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    accumulator += Math.min((now - last) / 1000, 0.1);
    last = now;

    // Fixed-step physics keeps movement identical across frame rates.
    while (accumulator >= PHYSICS_STEP) {
      local.update(input, PHYSICS_STEP);
      world.physics.step();
      accumulator -= PHYSICS_STEP;
    }
    local.sync();

    if (now - lastSend >= SEND_INTERVAL_MS) {
      conn.send({ type: 'state', ...local.transform });
      lastSend = now;
    }

    remotes.update(now);

    // Chase camera: sit behind and above, ease toward the target.
    const desired = cameraOffset.clone().applyQuaternion(local.mesh.quaternion).add(local.mesh.position);
    world.camera.position.lerp(desired, 0.1);
    cameraTarget.lerp(local.mesh.position, 0.2);
    world.camera.lookAt(cameraTarget.x, cameraTarget.y + 1, cameraTarget.z);
    world.followSun(local.mesh.position);

    world.renderer.render(world.scene, world.camera);
    labels.render(world.scene, world.camera);
  });
}
