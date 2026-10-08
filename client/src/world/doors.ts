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

/** Every house's front door: a swinging panel with a collider that moves with it. */
export class Doors {
  private doors = new Map<string, Door>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  /** Plays a sound at a door when it starts to open or close. */
  onSwing: (position: THREE.Vector3, opening: boolean) => void = () => {};

  constructor(scene: THREE.Scene, houses: House[], m: DoorMaterials, physics: RAPIER.World) {
    const panel = new THREE.BoxGeometry(DOOR_WIDTH - 0.02, DOOR_HEIGHT - 0.01, DOOR_THICKNESS).translate(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0);
    const knob = new THREE.SphereGeometry(0.035, 10, 8);
    const group = new THREE.Group();
    group.name = 'doors';

    for (const house of houses) {
      const M = houseMatrix(house);
      const pivot = new THREE.Object3D();
      const hinge = doorHingeLocal(house).applyMatrix4(M);
      pivot.position.copy(hinge);
      pivot.rotation.y = house.rotation;

      const mesh = new THREE.Mesh(panel, this.material(m, house.doorColor));
      mesh.castShadow = mesh.receiveShadow = true;
      pivot.add(mesh);
      for (const side of [-1, 1]) {
        const k = new THREE.Mesh(knob, m.brass);
        k.position.set(DOOR_WIDTH - 0.12, 1.0, side * (DOOR_THICKNESS / 2 + 0.03));
        pivot.add(k);
      }
      group.add(pivot);
      pivot.updateMatrixWorld();

      const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, DOOR_THICKNESS / 2));
      const front = doorPosition(house);
      const inward = new THREE.Vector3(0, 0, -WALL_THICKNESS / 2).applyAxisAngle(THREE.Object3D.DEFAULT_UP, house.rotation);
      const door: Door = {
        house,
        pivot,
        collider,
        center: new THREE.Vector3(front.x, hinge.y, front.z).add(inward),
        angle: 0,
        open: false,
      };
      this.placeCollider(door);
      this.doors.set(house.id, door);
    }
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
    this.placeCollider(door);
  }

  private placeCollider(door: Door): void {
    const center = new THREE.Vector3(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0).applyMatrix4(door.pivot.matrixWorld);
    door.collider.setTranslation(center);
    door.collider.setRotation(door.pivot.quaternion);
  }

  private material(m: DoorMaterials, color: string): THREE.MeshStandardMaterial {
    let mat = this.materials.get(color);
    if (!mat) {
      mat = m.door.clone();
      mat.vertexColors = false;
      mat.color.set(color);
      this.materials.set(color, mat);
    }
    return mat;
  }
}
