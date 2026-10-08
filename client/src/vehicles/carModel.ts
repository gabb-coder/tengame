import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR } from './carPhysics.ts';

const WHEEL_POSITIONS: [number, number][] = [
  [CAR.wheelX, CAR.wheelZFront],
  [-CAR.wheelX, CAR.wheelZFront],
  [CAR.wheelX, CAR.wheelZRear],
  [-CAR.wheelX, CAR.wheelZRear],
];

/** Lean limits for the visual body roll/pitch, in radians. */
const MAX_ROLL = 0.07;
const MAX_PITCH = 0.04;

/** Car body dimensions, in the physics chassis frame (origin at its center, facing +Z). */
const BODY_WIDTH = 1.7;
const CABIN_WIDTH = 1.4;
const BOTTOM = -0.42;
const ARCH_RADIUS = 0.39;
/** Wheel center height when the car rests on flat ground. */
const WHEEL_Y = CAR.wheelY - CAR.suspensionRest * 0.65;

// Shared geometry and materials across all cars.
const tireGeometry = makeTire();
const rimGeometry = makeRim();
const tireMaterial = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.88 });
const rimMaterial = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.22, metalness: 1 });
const discMaterial = new THREE.MeshStandardMaterial({ color: '#5a5c60', roughness: 0.5, metalness: 0.8 });
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#0b1016', roughness: 0.05, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.5 });
const trimMaterial = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.55 });
const chromeMaterial = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.15, metalness: 1 });
const plateMaterial = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5 });
const headlightMaterial = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6d8', emissiveIntensity: 0.6, roughness: 0.1 });
const lensMaterial = new THREE.MeshPhysicalMaterial({ color: '#dfe8f0', roughness: 0.02, transparent: true, opacity: 0.35, clearcoat: 1 });
const taillightMaterial = new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff0505', emissiveIntensity: 0.35 });
const bodyGeometry = makeBody();
const cabinGeometry = makeCabin();

/**
 * A mid-size sedan built from extruded profiles, facing +Z. Origin matches the physics
 * chassis center. Wheels are separate so they can steer, spin and follow the suspension.
 */
export class CarModel {
  readonly root = new THREE.Group();
  /** Body parts that lean with roll/pitch; wheels stay planted. */
  private body = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private brakeLights: THREE.MeshStandardMaterial;
  private roll = 0;
  private pitch = 0;
  private night = 0;
  private braking = false;

  constructor(color: string) {
    const paint = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.42,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    this.brakeLights = taillightMaterial.clone();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.body.add(mesh);
      return mesh;
    };

    add(bodyGeometry, paint);
    add(cabinGeometry, paint);
    // Dark underside so you can't see daylight between the wheel arches.
    add(new THREE.BoxGeometry(BODY_WIDTH - 0.1, 0.08, 3.6), trimMaterial, 0, BOTTOM + 0.06, 0);

    // Glass: side windows (split by the B-pillar), windshield and rear window.
    for (const side of [-1, 1]) {
      const x = side * (CABIN_WIDTH / 2 + 0.042);
      add(sidePane([[-1.36, 0.27], [-0.98, 0.58], [-0.28, 0.63], [-0.28, 0.27]], side), glassMaterial, x);
      add(sidePane([[-0.18, 0.27], [-0.18, 0.635], [0.2, 0.64], [0.86, 0.27]], side), glassMaterial, x);
    }
    add(slopedPane(0.97, 0.25, 0.3, 0.63, CABIN_WIDTH - 0.12), glassMaterial);
    add(slopedPane(-1.44, 0.25, -1.02, 0.6, CABIN_WIDTH - 0.16), glassMaterial);

    // Front: grille, headlights, bumper intake, plate. Rear: tail lights, plate.
    add(new THREE.BoxGeometry(0.78, 0.13, 0.04), trimMaterial, 0, -0.06, 2.315);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.74, 0.008, 0.02), chromeMaterial, 0, -0.11 + i * 0.033, 2.338);
    add(new THREE.BoxGeometry(1.0, 0.09, 0.05), trimMaterial, 0, -0.29, 2.31);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.02), plateMaterial, 0, -0.2, 2.345);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.02), plateMaterial, 0, -0.12, -2.31);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.36, 0.09, 0.06), headlightMaterial, side * 0.6, 0.0, 2.27);
      add(new THREE.BoxGeometry(0.4, 0.12, 0.04), lensMaterial, side * 0.6, 0.0, 2.305);
      add(new THREE.BoxGeometry(0.44, 0.1, 0.05), this.brakeLights, side * 0.58, 0.06, -2.285);
      // Side mirror on a short stalk.
      add(new THREE.BoxGeometry(0.08, 0.03, 0.1), trimMaterial, side * 0.8, 0.28, 0.78);
      add(new THREE.BoxGeometry(0.14, 0.1, 0.16), paint, side * 0.9, 0.3, 0.76);
      // Door seams and handles.
      for (const z of [0.98, -0.22, -1.3]) add(new THREE.BoxGeometry(0.006, 0.5, 0.012), trimMaterial, side * (BODY_WIDTH / 2 + 0.052), -0.08, z);
      for (const z of [0.55, -0.62]) add(new THREE.BoxGeometry(0.02, 0.025, 0.16), chromeMaterial, side * (BODY_WIDTH / 2 + 0.055), 0.08, z);
    }
    this.root.add(this.body);

    for (const [x, z] of WHEEL_POSITIONS) {
      const wheel = new THREE.Group();
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireGeometry, tireMaterial);
      tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      // Rims face outward on both sides of the car.
      rim.scale.x = Math.sign(x);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 20).rotateZ(Math.PI / 2), discMaterial);
      disc.position.x = -Math.sign(x) * 0.05;
      spin.add(tire, rim, disc);
      wheel.add(spin);
      wheel.position.set(x, WHEEL_Y, z);
      this.wheels.push(wheel);
      this.root.add(wheel);
    }
  }

  /** Poses one wheel. `suspension` is the current spring length. */
  setWheel(i: number, steer: number, rotation: number, suspension: number): void {
    const wheel = this.wheels[i];
    wheel.position.y = CAR.wheelY - suspension;
    wheel.rotation.y = steer;
    wheel.children[0].rotation.x = rotation;
  }

  /**
   * Leans the body from acceleration in the car's frame (m/s²):
   * `lateral` positive = pushed toward +X, `longitudinal` positive = speeding up.
   */
  lean(lateral: number, longitudinal: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.roll += (THREE.MathUtils.clamp(lateral * 0.008, -MAX_ROLL, MAX_ROLL) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-longitudinal * 0.005, -MAX_PITCH, MAX_PITCH) - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }

  setBraking(on: boolean): void {
    this.braking = on;
    this.applyTaillights();
  }

  /** Tail lights glow a little at night even when not braking. */
  setNight(night: number): void {
    this.night = night;
    this.applyTaillights();
  }

  /** All cars' headlights: dim by day, bright at night. */
  static setHeadlights(night: number): void {
    headlightMaterial.emissiveIntensity = 0.6 + night * 5;
  }

  private applyTaillights(): void {
    // Kept moderate: tone mapping pushes very bright red toward orange.
    this.brakeLights.emissiveIntensity = this.braking ? 1.3 + this.night * 1.5 : 0.35 + this.night * 0.6;
  }
}

/**
 * Extrudes a side profile (shape X = car Z, shape Y = car Y) across the car's width,
 * centered on X, with rounded edges.
 */
function extrudeSide(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 4,
    curveSegments: 18,
  });
  // Shape X → car Z, extrusion → car X (centered).
  g.rotateY(-Math.PI / 2);
  g.translate((width - 2 * bevel) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Lower body: bumpers, hood, trunk and wheel arches, up to the belt line. */
function makeBody(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const arch = (center: number) => {
    // Arc over the wheel from rear to front, meeting the sill at BOTTOM.
    const a = Math.asin((BOTTOM - WHEEL_Y) / ARCH_RADIUS);
    s.lineTo(center - ARCH_RADIUS * Math.cos(a), BOTTOM);
    s.absarc(center, WHEEL_Y, ARCH_RADIUS, Math.PI - a, a, true);
  };
  s.moveTo(-2.12, BOTTOM);
  arch(CAR.wheelZRear);
  arch(CAR.wheelZFront);
  s.lineTo(2.14, BOTTOM);
  s.lineTo(2.27, -0.3);
  s.lineTo(2.3, -0.04);
  s.quadraticCurveTo(2.28, 0.07, 2.08, 0.1);
  s.lineTo(1.05, 0.19);
  s.lineTo(-1.5, 0.21);
  s.quadraticCurveTo(-2.15, 0.21, -2.24, 0.1);
  s.lineTo(-2.27, -0.3);
  s.lineTo(-2.12, BOTTOM);
  return extrudeSide(s, BODY_WIDTH, 0.06);
}

/** Cabin: pillars and roof, narrower than the body (the glass sits on its faces). */
function makeCabin(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-1.46, 0.2);
  s.quadraticCurveTo(-1.2, 0.5, -0.98, 0.64);
  s.quadraticCurveTo(-0.4, 0.71, 0.24, 0.68);
  s.quadraticCurveTo(0.6, 0.48, 1.0, 0.2);
  s.lineTo(-1.46, 0.2);
  return extrudeSide(s, CABIN_WIDTH, 0.05);
}

/** A flat window shape on a side of the cabin, facing out (side -1 = -X, +1 = +X). */
function sidePane(points: [number, number][], side: number): THREE.BufferGeometry {
  const pts = side > 0 ? points.map(([z, y]) => new THREE.Vector2(-z, y)).reverse() : points.map(([z, y]) => new THREE.Vector2(z, y));
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  // Shape X → car Z; the face turns toward ±X.
  g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  return g;
}

/** Windshield or rear window: a quad from (z0, y0) up to (z1, y1), `width` wide, facing outward. */
function slopedPane(z0: number, y0: number, z1: number, y1: number, width: number): THREE.BufferGeometry {
  const length = Math.hypot(z1 - z0, y1 - y0);
  const g = new THREE.PlaneGeometry(width, length);
  // Lay the plane flat (facing up), then tilt it about X to match the slope.
  g.rotateX(-Math.PI / 2);
  const slope = Math.atan2(y1 - y0, Math.abs(z1 - z0));
  // Windshield (z decreasing upward) tips its top back toward -Z; rear window toward +Z.
  const tilt = z1 < z0 ? slope : -slope;
  g.rotateX(tilt);
  // Sit just proud of the cabin's curved surface, along the pane's normal.
  const out = 0.045;
  g.translate(0, (y0 + y1) / 2 + Math.cos(tilt) * out, (z0 + z1) / 2 + Math.sin(tilt) * out);
  return g;
}

/** Tire with rounded shoulders, around the X axis. */
function makeTire(): THREE.BufferGeometry {
  const r = CAR.wheelRadius;
  const w = 0.24;
  const inner = r * 0.66;
  const pts: THREE.Vector2[] = [new THREE.Vector2(inner, -w / 2)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, -w / 2 + 0.05 + Math.sin(a) * 0.05));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, w / 2 - 0.05 + Math.sin(a) * 0.05));
  }
  pts.push(new THREE.Vector2(inner, w / 2));
  // Lathe spins around Y; turn the axle to X.
  return new THREE.LatheGeometry(pts, 32).rotateZ(Math.PI / 2);
}

/** Five-spoke rim facing +X (mirror with scale.x = -1 for the left side). */
function makeRim(): THREE.BufferGeometry {
  const rr = CAR.wheelRadius * 0.66;
  const parts: THREE.BufferGeometry[] = [
    new THREE.TorusGeometry(rr - 0.015, 0.018, 8, 32).rotateY(Math.PI / 2).translate(0.1, 0, 0),
    new THREE.CylinderGeometry(0.06, 0.07, 0.06, 16).rotateZ(Math.PI / 2).translate(0.09, 0, 0),
  ];
  for (let i = 0; i < 5; i++) {
    parts.push(new THREE.BoxGeometry(0.03, rr - 0.05, 0.05).translate(0.09, (rr - 0.05) / 2, 0).rotateX((i / 5) * Math.PI * 2));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}
