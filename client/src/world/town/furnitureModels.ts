import * as THREE from 'three';
import type { Furniture, FurnitureType } from '../../../../shared/interior.ts';
import type { Media, Model } from '../../assets/media.ts';
import { placement } from './meshBuilder.ts';

/**
 * Real models (from Poly Haven, CC0) for these furniture types. Each house uses one choice
 * per type, so a dining room's chairs match. `yaw` turns a model whose front isn't +Z.
 */
export const FURNITURE_MODELS: Partial<Record<FurnitureType, { id: string; yaw?: number }[]>> = {
  sofa: [{ id: 'Sofa_01' }, { id: 'sofa_02' }],
  armchair: [{ id: 'ArmChair_01' }, { id: 'modern_arm_chair_01' }, { id: 'mid_century_lounge_chair' }],
  coffeeTable: [{ id: 'modern_coffee_table_01', yaw: Math.PI / 2 }, { id: 'coffee_table_round_01' }],
  diningTable: [{ id: 'dining_table' }],
  chair: [{ id: 'dining_chair_02' }, { id: 'painted_wooden_chair_02' }],
  nightstand: [{ id: 'side_table_01' }, { id: 'painted_wooden_nightstand' }],
};

/** Things get put on these, so their height must match the floor plan exactly. */
const SURFACES = new Set<FurnitureType>(['coffeeTable', 'diningTable', 'nightstand']);
/** How far a model may be squashed or stretched along one axis, relative to the others. */
const MAX_STRETCH = 1.25;

/** A piece of furniture waiting for its model: `matrix` is its frame in the world. */
export interface FurnitureSlot {
  f: Furniture;
  houseId: string;
  matrix: THREE.Matrix4;
}

/** One block's replaceable furniture, drawn by stand-ins until the models arrive. */
export interface BlockFurniture {
  /** The block's interior group; models go in here so they hide with it. */
  group: THREE.Group;
  standIns: Map<FurnitureType, THREE.Group>;
  slots: FurnitureSlot[];
}

/** Which of a type's models a house uses. */
export function modelChoice(houseId: string, type: FurnitureType, count: number): number {
  let h = 2166136261;
  for (const c of `${houseId}:${type}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % count;
}

/**
 * How far from the camera furniture models are drawn. Rooms further away are only glimpsed
 * through dark window glass, and drawing every house's furniture would cost a lot.
 */
const MODEL_DISTANCE = 28;
/** Re-pick which furniture to draw after the camera moves this far. */
const REFRESH_DISTANCE = 2;

/** One model part drawn at many slots, of which only the nearby ones are shown. */
interface InstanceSet {
  mesh: THREE.InstancedMesh;
  positions: THREE.Vector3[];
  matrices: THREE.Matrix4[];
}

/**
 * Loads the furniture models and replaces the stand-ins with them, one instanced mesh per
 * model part per block. A type whose models all fail to load keeps its stand-ins.
 */
export class FurnitureModels {
  private sets: InstanceSet[] = [];
  private lastCamera = new THREE.Vector3(Infinity, 0, 0);

  constructor(blocks: BlockFurniture[], media: Media) {
    for (const [key, choices] of Object.entries(FURNITURE_MODELS)) void this.loadType(key as FurnitureType, choices, blocks, media);
  }

  /** Shows the models of furniture near `camera`. */
  update(camera: THREE.Vector3): void {
    if (camera.distanceToSquared(this.lastCamera) < REFRESH_DISTANCE ** 2) return;
    this.lastCamera.copy(camera);
    const max = MODEL_DISTANCE ** 2;
    for (const { mesh, positions, matrices } of this.sets) {
      let n = 0;
      positions.forEach((p, i) => {
        if (p.distanceToSquared(camera) < max) mesh.setMatrixAt(n++, matrices[i]);
      });
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private async loadType(type: FurnitureType, choices: { id: string; yaw?: number }[], blocks: BlockFurniture[], media: Media): Promise<void> {
    const models = await Promise.all(choices.map((c) => media.model(c.id)));
    const loaded = models.map((_, i) => i).filter((i) => models[i]);
    if (loaded.length === 0) return;
    for (const block of blocks) {
      const byChoice = new Map<number, FurnitureSlot[]>();
      for (const slot of block.slots) {
        if (slot.f.type !== type) continue;
        let i = modelChoice(slot.houseId, type, choices.length);
        if (!models[i]) i = loaded[modelChoice(slot.houseId, type, loaded.length)];
        byChoice.set(i, [...(byChoice.get(i) ?? []), slot]);
      }
      for (const [i, slots] of byChoice) this.addInstances(block.group, models[i]!, choices[i].yaw ?? 0, slots);
      const standIn = block.standIns.get(type);
      if (standIn) {
        standIn.removeFromParent();
        standIn.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      }
    }
    this.lastCamera.set(Infinity, 0, 0); // pick what to show on the next update
  }

  private addInstances(group: THREE.Group, model: Model, yaw: number, slots: FurnitureSlot[]): void {
    model.scene.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = [];
    model.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh);
    });
    const fits = slots.map((s) => s.matrix.clone().multiply(fitMatrix(s.f, model, yaw)));
    const positions = slots.map((s) => new THREE.Vector3().setFromMatrixPosition(s.matrix));
    for (const part of parts) {
      const matrices = fits.map((fit) => fit.clone().multiply(part.matrixWorld));
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, slots.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      // Bounds for culling cover every slot, so they stay valid whichever are shown.
      mesh.computeBoundingSphere();
      mesh.count = 0;
      // Indoors, the sun rarely reaches; skipping their shadows saves a lot of drawing.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
      this.sets.push({ mesh, positions, matrices });
    }
  }
}

/**
 * Scales a model (after turning it by `yaw`) to the furniture's box: centered on x/z,
 * standing on y = 0. Proportions bend only a little; surfaces keep their exact height.
 */
export function fitMatrix(f: Furniture, model: Model, yaw: number): THREE.Matrix4 {
  const size = new THREE.Vector3().subVectors(model.max, model.min);
  const turned = Math.abs(Math.sin(yaw)) > 0.5;
  const [sizeX, sizeZ] = turned ? [size.z, size.x] : [size.x, size.z];
  let sx = f.w / sizeX;
  let sy = f.h / size.y;
  let sz = f.d / sizeZ;
  const clamp = (s: number, mean: number) => THREE.MathUtils.clamp(s, mean / MAX_STRETCH, mean * MAX_STRETCH);
  if (SURFACES.has(f.type)) {
    const mean = Math.sqrt(sx * sz);
    [sx, sz] = [clamp(sx, mean), clamp(sz, mean)];
  } else {
    const mean = Math.cbrt(sx * sy * sz);
    [sx, sy, sz] = [clamp(sx, mean), clamp(sy, mean), clamp(sz, mean)];
  }
  const center = new THREE.Vector3((model.min.x + model.max.x) / 2, model.min.y, (model.min.z + model.max.z) / 2);
  return new THREE.Matrix4()
    .makeScale(sx, sy, sz)
    .multiply(placement(0, 0, 0, yaw))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}
