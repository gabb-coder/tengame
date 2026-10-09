import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { doorPosition, type House } from '../../../shared/town.ts';
import { DOOR_HEIGHT, DOOR_WIDTH, doorHingeLocal, houseMatrix, WALL_THICKNESS } from './town/houses.ts';

const DOOR_THICKNESS = 0.06;
/** Doors swing inward, a quarter turn. */
const OPEN_ANGLE = Math.PI / 2;
const SWING_SPEED = 2.6; // rad/s

interface Door {
  house: House;
  /** Which of the instanced panels (and pairs of knobs) is this door's. */
  index: number;
  /** Hinge pivot; rotating it around Y swings the door. */
  pivot: THREE.Object3D;
  collider: RAPIER.Collider;
  /** Center of the doorway at mid-wall thickness, for reach checks. */
  center: THREE.Vector3;
  angle: number;
  open: boolean;
}

export interface DoorMaterials {
  /** Door panels take their house's door color; one material per color is created from this. */
  door: THREE.MeshStandardMaterial;
  brass: THREE.Material;
}

/** Where the two knobs sit on a door, relative to its hinge. */
const KNOBS = [-1, 1].map((side) => new THREE.Matrix4().makeTranslation(DOOR_WIDTH - 0.12, 1.0, side * (DOOR_THICKNESS / 2 + 0.03)));

/**
 * Every house's front door: a swinging panel with a collider that moves with it. All the
 * panels are drawn together in one go, and all the knobs in another.
 */
export class Doors {
  private doors = new Map<string, Door>();
  private panels: THREE.InstancedMesh;
  private knobs: THREE.InstancedMesh;
  private knob = new THREE.Matrix4();
  /** Plays a sound at a door when it starts to open or close. */
  onSwing: (position: THREE.Vector3, opening: boolean) => void = () => {};

  constructor(scene: THREE.Scene, houses: House[], m: DoorMaterials, physics: RAPIER.World) {
    const panel = new THREE.BoxGeometry(DOOR_WIDTH - 0.02, DOOR_HEIGHT - 0.01, DOOR_THICKNESS).translate(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0);
    const knob = new THREE.SphereGeometry(0.035, 10, 8);
    // Each door takes its house's color.
    const paint = m.door.clone();
    paint.vertexColors = false;
    paint.color.set('#ffffff');
    this.panels = new THREE.InstancedMesh(panel, paint, houses.length);
    this.panels.castShadow = this.panels.receiveShadow = true;
    this.knobs = new THREE.InstancedMesh(knob, m.brass.clone(), houses.length * 2);
    const group = new THREE.Group();
    group.name = 'doors';
    group.add(this.panels, this.knobs);

    houses.forEach((house, index) => {
      const M = houseMatrix(house);
      const pivot = new THREE.Object3D();
      const hinge = doorHingeLocal(house).applyMatrix4(M);
      pivot.position.copy(hinge);
      pivot.rotation.y = house.rotation;
      pivot.updateMatrixWorld();
      this.panels.setColorAt(index, new THREE.Color(house.doorColor));

      const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, DOOR_THICKNESS / 2));
      const front = doorPosition(house);
      const inward = new THREE.Vector3(0, 0, -WALL_THICKNESS / 2).applyAxisAngle(THREE.Object3D.DEFAULT_UP, house.rotation);
      const door: Door = {
        house,
        index,
        pivot,
        collider,
        center: new THREE.Vector3(front.x, hinge.y, front.z).add(inward),
        angle: 0,
        open: false,
      };
      this.place(door);
      this.doors.set(house.id, door);
    });
    this.panels.computeBoundingSphere();
    this.knobs.computeBoundingSphere();
    scene.add(group);
  }

  isOpen(id: string): boolean {
    return this.doors.get(id)?.open ?? false;
  }

  /** Opens or closes a door; it swings there over a moment unless `instant`. */
  setOpen(id: string, open: boolean, instant = false): void {
    const door = this.doors.get(id);
    if (!door || door.open === open) return;
    door.open = open;
    if (instant) {
      door.angle = open ? OPEN_ANGLE : 0;
      this.pose(door);
    } else {
      this.onSwing(door.center, open);
    }
  }

  /** The closest door within `reach` meters (horizontally) of `position`. */
  nearest(position: THREE.Vector3, reach: number): { house: House; open: boolean; distance: number } | null {
    let best: Door | null = null;
    let bestDistance = reach;
    for (const door of this.doors.values()) {
      if (Math.abs(position.y - door.center.y) > 2) continue;
      const d = Math.hypot(position.x - door.center.x, position.z - door.center.z);
      if (d < bestDistance) {
        best = door;
        bestDistance = d;
      }
    }
    return best && { house: best.house, open: best.open, distance: bestDistance };
  }

  /** Animates swinging doors. */
  update(dt: number): void {
    for (const door of this.doors.values()) {
      const target = door.open ? OPEN_ANGLE : 0;
      if (door.angle === target) continue;
      const step = SWING_SPEED * dt;
      door.angle = Math.abs(target - door.angle) <= step ? target : door.angle + Math.sign(target - door.angle) * step;
      this.pose(door);
    }
  }

  private pose(door: Door): void {
    // Ease in/out so the swing doesn't look mechanical.
    const t = door.angle / OPEN_ANGLE;
    const eased = t * t * (3 - 2 * t);
    door.pivot.rotation.y = door.house.rotation + eased * OPEN_ANGLE;
    door.pivot.updateMatrixWorld();
    this.place(door);
  }

  /** Puts the door's panel, knobs and collider where its pivot says. */
  private place(door: Door): void {
    const hinge = door.pivot.matrixWorld;
    this.panels.setMatrixAt(door.index, hinge);
    this.panels.instanceMatrix.needsUpdate = true;
    KNOBS.forEach((offset, k) => this.knobs.setMatrixAt(door.index * 2 + k, this.knob.multiplyMatrices(hinge, offset)));
    this.knobs.instanceMatrix.needsUpdate = true;
    const center = new THREE.Vector3(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0).applyMatrix4(hinge);
    door.collider.setTranslation(center);
    door.collider.setRotation(door.pivot.quaternion);
  }
}
