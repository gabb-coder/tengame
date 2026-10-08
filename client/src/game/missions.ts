import * as THREE from 'three';
import type { MissionState, MissionTarget, Vec3 } from '../../../shared/protocol.ts';
import type { LocalPlayer } from './localPlayer.ts';

const COLORS: Record<MissionTarget['kind'], string> = {
  pickup: '#f2c14e',
  dropoff: '#6cbf54',
  item: '#29a3e0',
  checkpoint: '#e4572e',
};
const BEAM_HEIGHT = 70;
const CHECKPOINT_RADIUS = 10;

const $ = (id: string) => document.getElementById(id)!;

/**
 * The client side of missions: shows the objective, timer and a pointer to the
 * target, draws markers in the world, and lines the car up for races. The server
 * decides everything; this only displays it.
 */
export class MissionClient {
  private state: MissionState | null = null;
  /** performance.now() when the current phase ends. */
  private deadline = 0;
  private markers = new THREE.Group();
  private pkg: THREE.Group;
  private lastTimerText = '';

  constructor(
    scene: THREE.Scene,
    private localId: string,
    private player: LocalPlayer,
    /** Where a player is (their character if walking, else their car), or null if unknown. */
    private locate: (id: string) => { position: THREE.Vector3; walking: boolean } | null,
  ) {
    scene.add(this.markers);
    this.pkg = packageModel();
    this.pkg.visible = false;
    scene.add(this.pkg);
  }

  apply(mission: MissionState | null, now: number): void {
    const prev = this.state;
    this.state = mission;
    this.deadline = now + (mission?.timeLeft ?? 0);
    $('mission').hidden = !mission;
    if (!mission) {
      this.clearMarkers();
      this.player.frozen = false;
      return;
    }
    $('mission-title').textContent = mission.title;

    // Races: line up on the grid during the briefing, and hold still until "Go!".
    const slot = mission.grid?.[this.localId];
    const newBriefing = mission.phase === 'briefing' && (prev?.id !== mission.id || prev.phase !== 'briefing');
    if (mission.kind === 'race' && newBriefing && slot) {
      this.player.lineUp(new THREE.Vector3(...slot.p), slot.yaw);
    }
    this.player.frozen = mission.kind === 'race' && mission.phase === 'briefing' && !!slot;
    this.rebuildMarkers();
  }

  update(now: number, camera: THREE.Camera): void {
    const s = this.state;
    if (!s) {
      $('waypoint').hidden = true;
      return;
    }
    const secondsLeft = Math.max(0, Math.ceil((this.deadline - now) / 1000));
    const timer = s.phase === 'briefing' ? `Starts in ${secondsLeft}` : s.phase === 'active' ? clock(secondsLeft) : 'Next mission soon';
    if (timer !== this.lastTimerText) {
      $('mission-timer').textContent = timer;
      $('mission-timer').classList.toggle('urgent', s.phase === 'active' && secondsLeft <= 15);
      this.lastTimerText = timer;
    }
    $('mission-objective').textContent = this.objective(s);

    // Package floating above whoever carries it.
    const carrier = s.phase === 'active' && s.carrier ? this.locate(s.carrier) : null;
    this.pkg.visible = !!carrier;
    if (carrier) {
      this.pkg.position.copy(carrier.position).add(new THREE.Vector3(0, carrier.walking ? 2.25 : 1.5, 0));
      this.pkg.rotation.y = now / 600;
    }

    // Item bob, checkpoint pulse.
    for (const child of this.markers.children) {
      if (child.userData.bob) child.position.y = child.userData.baseY + Math.sin(now / 300) * 0.04;
      if (child.userData.spin) child.rotation.y = now / 800;
    }
    if (s.kind === 'race' && s.phase === 'active') this.highlightCheckpoints();

    this.updateWaypoint(s, camera);
  }

  private objective(s: MissionState): string {
    if (s.phase === 'done') return s.result ?? '';
    if (s.kind === 'delivery' && s.carrier === this.localId) {
      const drop = s.targets.find((t) => t.kind === 'dropoff');
      return `You have the package! Take it to ${drop?.label}: get out and walk it to the front door.`;
    }
    if (s.kind === 'race' && s.phase === 'active') {
      const done = s.progress?.[this.localId] ?? 0;
      const total = s.checkpoints?.length ?? 0;
      if (done >= total) return `You finished! Waiting for the others…`;
      return `Checkpoint ${done + 1} of ${total}${this.player.mode === 'foot' ? ': get back in your car!' : ''}`;
    }
    return s.objective;
  }

  /** The next thing this player should go to, if any (also shown on the minimap). */
  get nextTarget(): THREE.Vector3 | null {
    return this.state ? this.waypoint(this.state) : null;
  }

  /** Where the arrow points: the next thing this player should go to. */
  private waypoint(s: MissionState): THREE.Vector3 | null {
    if (s.phase !== 'active' && !(s.phase === 'briefing' && s.kind !== 'race')) return null;
    if (s.kind === 'race') {
      const next = s.progress?.[this.localId] ?? 0;
      const cp = s.checkpoints?.[next];
      return cp ? new THREE.Vector3(...cp) : null;
    }
    const t = s.targets.find((x) => (s.carrier ? x.kind === 'dropoff' : true));
    return t ? new THREE.Vector3(...t.p) : null;
  }

  private updateWaypoint(s: MissionState, camera: THREE.Camera): void {
    const target = this.waypoint(s);
    const el = $('waypoint');
    el.hidden = !target;
    if (!target) return;
    const from = this.player.focus;
    const distance = Math.hypot(target.x - from.x, target.z - from.z);
    // Bearing of the target relative to where the camera looks, on the ground plane.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const camYaw = Math.atan2(forward.x, forward.z);
    const targetYaw = Math.atan2(target.x - camera.position.x, target.z - camera.position.z);
    const bearing = Math.atan2(Math.sin(camYaw - targetYaw), Math.cos(camYaw - targetYaw));
    (el.querySelector('svg') as SVGElement).style.transform = `rotate(${THREE.MathUtils.radToDeg(bearing)}deg)`;
    $('waypoint-distance').textContent = distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
  }

  private rebuildMarkers(): void {
    this.clearMarkers();
    const s = this.state;
    if (!s || s.phase === 'done') return;
    for (const t of s.targets) this.markers.add(beam(t.p, COLORS[t.kind], t.kind === 'item' ? 0.35 : 1.6));
    const item = s.targets.find((t) => t.kind === 'item');
    if (item) {
      const obj = itemModel();
      obj.position.set(...item.p);
      obj.userData = { bob: true, spin: true, baseY: item.p[1] + 0.03 };
      this.markers.add(obj);
    }
    if (s.kind === 'race') {
      s.checkpoints?.forEach((cp, i) => {
        const g = checkpointMarker(cp, i === s.checkpoints!.length - 1);
        g.userData.checkpoint = i;
        this.markers.add(g);
      });
      this.highlightCheckpoints();
    }
  }

  /** Bright marker for this player's next checkpoint, faint for the one after, hidden otherwise. */
  private highlightCheckpoints(): void {
    const next = this.state?.progress?.[this.localId] ?? 0;
    for (const g of this.markers.children) {
      const i = g.userData.checkpoint as number | undefined;
      if (i === undefined) continue;
      g.visible = i === next || i === next + 1;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).opacity = i === next ? o.userData.opacity : o.userData.opacity * 0.3;
      });
    }
  }

  private clearMarkers(): void {
    for (const child of [...this.markers.children]) {
      this.markers.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
  }
}

function glow(color: string, opacity: number): THREE.MeshBasicMaterial {
  // Normal blending: additive washes out to white against a bright daytime sky.
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

function withOpacity(mesh: THREE.Mesh): THREE.Mesh {
  mesh.userData.opacity = (mesh.material as THREE.MeshBasicMaterial).opacity;
  return mesh;
}

/** A tall column of light with a ring on the ground, visible from across town. */
function beam(p: Vec3, color: string, radius: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...p);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, BEAM_HEIGHT, 24, 1, true), glow(color, 0.45));
  column.position.y = BEAM_HEIGHT / 2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.1, radius * 1.6, 40).rotateX(-Math.PI / 2), glow(color, 0.8));
  ring.position.y = 0.05;
  g.add(withOpacity(column), withOpacity(ring));
  return g;
}

/** Race checkpoint: a wide ring on the road and a beam; checkered top on the finish. */
function checkpointMarker(p: Vec3, finish: boolean): THREE.Group {
  const color = finish ? '#ffffff' : COLORS.checkpoint;
  const g = new THREE.Group();
  g.position.set(p[0], 0, p[2]);
  const ring = new THREE.Mesh(new THREE.RingGeometry(CHECKPOINT_RADIUS - 0.6, CHECKPOINT_RADIUS, 64).rotateX(-Math.PI / 2), glow(color, 0.7));
  ring.position.y = 0.06;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, BEAM_HEIGHT, 20, 1, true), glow(color, 0.45));
  column.position.y = BEAM_HEIGHT / 2;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(CHECKPOINT_RADIUS, CHECKPOINT_RADIUS, 3, 64, 1, true), glow(color, 0.2));
  wall.position.y = 1.5;
  g.add(withOpacity(ring), withOpacity(column), withOpacity(wall));
  return g;
}

/** Small glowing set of keys / phone sized thing. */
function itemModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.03, 0.08),
    new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#ffb000', emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.3 }),
  );
  body.position.y = 0.015;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16).rotateX(Math.PI / 2), body.material);
  ring.position.set(-0.09, 0.01, 0);
  g.add(body, ring);
  return g;
}

/** A cardboard box with tape. */
function packageModel(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.45), new THREE.MeshStandardMaterial({ color: '#b58a58', roughness: 0.9 }));
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.41, 0.08), new THREE.MeshStandardMaterial({ color: '#d9c7a0', roughness: 0.6 }));
  box.castShadow = true;
  g.add(box, tape);
  return g;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
