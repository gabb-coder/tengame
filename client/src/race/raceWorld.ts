import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { type CircuitData, type CircuitInfo, isNightRace } from '../../../shared/circuits.ts';
import type { TextureSet } from '../assets/media.ts';
import { DayNight } from '../world/dayNight.ts';
import type { Ambience } from '../world/zones/ambience.ts';
import { buildCircuit, type Circuit, type CircuitDetail } from './circuit/index.ts';
import { F1_PERFORMANCE } from './f1.ts';
import { CircuitLayout } from './layout.ts';
import { drsZones, RacingLine, type DrsZone } from './racingLine.ts';
import { Track } from './track.ts';

/** The haze: clear for a couple of kilometers, as on a race day. */
const AMBIENCE: Record<'day' | 'desert' | 'city', Ambience> = {
  day: { fogDay: new THREE.Color('#c3d1de'), fogNight: new THREE.Color('#0b1222'), fogNear: 500, fogFar: 3200, space: 0, overcast: 0, sun: 1, weather: {} },
  desert: { fogDay: new THREE.Color('#e3d6bd'), fogNight: new THREE.Color('#120f14'), fogNear: 400, fogFar: 2800, space: 0, overcast: 0.05, sun: 1.05, weather: {} },
  city: { fogDay: new THREE.Color('#c9d2db'), fogNight: new THREE.Color('#121a2c'), fogNear: 350, fogFar: 2400, space: 0, overcast: 0.1, sun: 1, weather: {} },
};

/**
 * A circuit to race on: its track, racing line and layout, the built world (in its own
 * physics world), and the sky over it, at the time of day its real race is run (floodlit
 * after dark).
 */
export class RaceWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.15, 6000);
  readonly physics: RAPIER.World;
  readonly dayNight: DayNight;
  readonly track: Track;
  readonly line: RacingLine;
  readonly layout: CircuitLayout;
  readonly drs: DrsZone[];
  readonly circuit: Circuit;
  readonly night: boolean;
  private ambience: Ambience;
  /** Floodlights: bright, even light from above for the night races. */
  private flood: THREE.DirectionalLight | null = null;
  private floodFill: THREE.HemisphereLight | null = null;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly info: CircuitInfo,
    data: CircuitData,
    textures: Map<string, TextureSet>,
    detail: CircuitDetail,
  ) {
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = 1 / 60;
    this.track = new Track(data, info);
    this.line = new RacingLine(this.track, F1_PERFORMANCE);
    this.layout = new CircuitLayout(this.track, this.line);
    this.drs = drsZones(this.line);
    this.dayNight = new DayNight(renderer, this.scene);
    this.night = isNightRace(info);
    this.dayNight.setClock({ hours: info.hour, rate: 0 }, performance.now());
    this.ambience = AMBIENCE[info.scenery === 'desert' ? 'desert' : info.style === 'street' ? 'city' : 'day'];
    this.circuit = buildCircuit(this.track, this.line, this.layout, this.drs, textures, this.physics, detail);
    this.scene.add(this.circuit.group);
    if (this.night) {
      this.flood = new THREE.DirectionalLight('#f4f1ea', 1.9);
      this.floodFill = new THREE.HemisphereLight('#cfd6e6', '#3a3a3a', 0.9);
      this.scene.add(this.flood, this.flood.target, this.floodFill);
    }
  }

  /** One fixed physics step (see World.stepPhysics). */
  stepPhysics(): void {
    const w = this.physics;
    w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Sky, sun and haze around `focus`. */
  update(now: number, dt: number, focus: THREE.Vector3): void {
    this.dayNight.update(now, dt, focus, false, this.ambience);
    if (this.flood) {
      this.flood.position.copy(focus).add(new THREE.Vector3(30, 120, 20));
      this.flood.target.position.copy(focus);
    }
    this.circuit.setNight(this.dayNight.night);
  }

  /** Frees the physics world (the scene's GPU memory goes with the renderer's next dispose). */
  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.physics.free();
  }
}
