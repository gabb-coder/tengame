import type { CarSpec } from '../vehicles/carPhysics.ts';

const G = 9.81;

/** What the car can do, for planning speeds round a lap (see racingLine.ts). */
export interface Performance {
  mass: number;
  /** Tire grip sideways and along the tire (coefficients of friction). */
  grip: number;
  longGrip: number;
  /** Downforce and drag, N per (m/s)². */
  downforce: number;
  drag: number;
  /** Engine power reaching the road (W), and the speed the gearing tops out at (m/s). */
  power: number;
  topSpeed: number;
  /**
   * Flat-out acceleration on the level (m/s², drag included) at 0, ACCEL_STEP, 2 ACCEL_STEP...
   * m/s, measured from the physics; used instead of `power` when present.
   */
  accel?: readonly number[];
}

export const ACCEL_STEP = 5;

const MASS = 800;
const GRIP = 1.55;
const DOWNFORCE = 3.1;
const WHEELBASE = 3.6;

/**
 * A modern Grand Prix car: 800 kg with its driver, close to 1000 hp, eight gears, and wings
 * that press it onto the road with nearly three times its own weight at 300 km/h, so it
 * corners and brakes far harder than a road car. Chassis faces +Z, as CarModel.
 */
export const F1: CarSpec = {
  mass: MASS,
  halfExtents: { x: 0.85, y: 0.22, z: 2.5 },
  comOffsetY: -0.08,
  // A little behind the middle: more weight on the driven rear wheels.
  comOffsetZ: -0.2,
  wheelRadius: 0.36,
  wheelX: 0.8,
  wheelZFront: 1.85,
  wheelZRear: -1.75,
  wheelY: 0.13,
  suspensionRest: 0.14,
  suspensionTravel: 0.1,
  suspensionStiffness: 120,
  suspensionCompression: 6.5,
  suspensionRelaxation: 8.5,
  frictionSlip: GRIP,
  sideFrictionStiffness: 1,
  handbrakeGrip: 1,
  maxSteer: 0.36,
  minSteer: 0.03,
  // Fraction of full lock per second (see steerLock).
  steerRate: 3.2,
  // The brakes could lock the wheels at any speed: the tires' grip is the limit (tireGrip).
  brakeForce: 1e6,
  handbrakeForce: 0,
  engineBrake: 6,
  maxReverseSpeed: 6,
  idleRpm: 4000,
  redlineRpm: 12500,
  peakTorque: 640,
  torquePeak: 0.8,
  torqueFalloff: 1.6,
  gears: [4.72, 3.9, 3.23, 2.67, 2.21, 1.83, 1.51, 1.213],
  reverseGear: 4,
  finalDrive: 4,
  efficiency: 0.92,
  upshiftRpm: 12000,
  downshiftRpm: 7400,
  shiftTime: 0.04,
  dragCoefficient: 0.83,
  rollingResistance: 4,
  shapes: false,
  downforce: DOWNFORCE,
  frontDownforce: 0.44,
  tireGrip: 1.5,
  // The rear tires are much wider than the fronts.
  rearGrip: 1.15,
  // Full lock is the most the tires can take at that speed (a touch more), so a full
  // press of a key or stick takes a corner at the limit without spinning the car.
  steerLock: (v) => {
    const lateral = GRIP * (G + (DOWNFORCE * v * v) / MASS);
    return Math.min(0.36, Math.max(0.028, ((WHEELBASE * lateral) / Math.max(v * v, 1)) * 1.12));
  },
  ccd: true,
};

/** Top speed the gearing allows, at the rev limiter in top gear (m/s). */
export function gearedTopSpeed(spec: CarSpec): number {
  const top = spec.gears[spec.gears.length - 1] * spec.finalDrive;
  return ((spec.redlineRpm / 60 / top) * 2 * Math.PI * spec.wheelRadius) * 0.99;
}

/**
 * The F1 car as it really drives in the physics (measured: see client/test/raceDriving):
 * the tires give a little less than their nominal grip once the load shifts between them.
 */
export const F1_PERFORMANCE: Performance = {
  mass: F1.mass,
  grip: F1.frictionSlip * 0.93,
  longGrip: F1.tireGrip! * 0.87,
  downforce: F1.downforce!,
  drag: F1.dragCoefficient,
  power: 700_000,
  topSpeed: gearedTopSpeed(F1),
  // Measured: full throttle from rest on a flat road (see client/test/raceDriving.test.ts).
  accel: [8.93, 8.97, 9.12, 9.32, 9.23, 9.28, 10.23, 10.79, 11.02, 12.31, 12.22, 10.94, 9.36, 7.59, 6.34, 4.52, 3, 1.99, 0.92, 0.27],
};
