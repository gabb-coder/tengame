import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_BOX_GROUPS, CAR_SHAPE_GROUPS, SKIP_RAGDOLLS } from '../game/groups.ts';

/** Driver inputs for one physics step. */
export interface CarControls {
  /** 0..1 */
  throttle: number;
  /** 0..1; brakes when moving forward, reverses when stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
}

/** Car spec, roughly a 1.2 t rear-wheel-drive sports sedan. Chassis faces +Z. */
export const CAR = {
  mass: 1200,
  halfExtents: { x: 1.02, y: 0.32, z: 2.2 },
  /** Center of mass below the chassis box center, for stability. */
  comOffsetY: -0.18,
  wheelRadius: 0.34,
  wheelX: 0.92,
  wheelZFront: 1.35,
  wheelZRear: -1.3,
  wheelY: -0.1,
  suspensionRest: 0.32,
  suspensionTravel: 0.22,
  suspensionStiffness: 20,
  suspensionCompression: 2.6,
  suspensionRelaxation: 3.4,
  frictionSlip: 1.15,
  sideFrictionStiffness: 1,
  /** Grip multiplier on the rear wheels while the handbrake is held. */
  handbrakeGrip: 0.55,
  maxSteer: 0.55, // rad at walking speed
  minSteer: 0.12, // rad at top speed
  steerRate: 2.6, // rad/s
  brakeForce: 45,
  handbrakeForce: 80,
  /** Light drag from the drivetrain when coasting. */
  engineBrake: 3.5,
  maxReverseSpeed: 8, // m/s
  // Engine and drivetrain.
  idleRpm: 900,
  redlineRpm: 7000,
  peakTorque: 260, // Nm
  gears: [3.3, 2.15, 1.55, 1.2, 0.98, 0.8],
  reverseGear: 3.2,
  finalDrive: 3.7,
  efficiency: 0.85,
  upshiftRpm: 6300,
  downshiftRpm: 2600,
  shiftTime: 0.22,
  dragCoefficient: 0.42, // 0.5 * air density * Cd * frontal area
  rollingResistance: 14,
} as const;

/** How the place the car is in changes things (see world/zones). */
export interface CarEnvironment {
  /** Gravity as a fraction of normal. */
  gravity: number;
  /** Tire grip as a fraction of normal. */
  grip: number;
  underwater: boolean;
}

const NORMAL_PLACE: CarEnvironment = { gravity: 1, grip: 1, underwater: false };

const DRIVEN = [2, 3]; // rear wheels
const STEERED = [0, 1]; // front wheels
const MAX_SPEED_FOR_STEER = 50; // m/s

/** Wheel state for rendering. */
export interface WheelPose {
  steer: number;
  /** Accumulated spin angle in radians. */
  rotation: number;
  /** Current suspension length; rest length when airborne. */
  suspension: number;
  inContact: boolean;
}

export class CarPhysics {
  readonly body: RAPIER.RigidBody;
  private vehicle: RAPIER.DynamicRayCastVehicleController;
  private steer = 0;
  private shiftTimer = 0;
  /** 1..6 forward, -1 reverse. */
  gear = 1;
  rpm: number = CAR.idleRpm;
  /** 0..1 engine load used for sound. */
  load = 0;

  constructor(
    private world: RAPIER.World,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 },
  ) {
    const h = CAR.halfExtents;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setAngularDamping(0.6)
        .setCanSleep(false),
    );
    // Box inertia, with the center of mass lowered.
    const m = CAR.mass;
    const [w, ht, l] = [h.x * 2, h.y * 2, h.z * 2];
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z)
        .setMassProperties(
          m,
          { x: 0, y: CAR.comOffsetY, z: 0 },
          { x: (m / 12) * (ht * ht + l * l), y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + ht * ht) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.3)
        .setRestitution(0.1)
        .setCollisionGroups(CAR_BOX_GROUPS),
      this.body,
    );
    for (const shape of carShapes()) world.createCollider(shape.setCollisionGroups(CAR_SHAPE_GROUPS), this.body);

    const v = world.createVehicleController(this.body);
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    const wheels = [
      [CAR.wheelX, CAR.wheelZFront],
      [-CAR.wheelX, CAR.wheelZFront],
      [CAR.wheelX, CAR.wheelZRear],
      [-CAR.wheelX, CAR.wheelZRear],
    ];
    wheels.forEach(([x, z], i) => {
      v.addWheel({ x, y: CAR.wheelY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, CAR.suspensionRest, CAR.wheelRadius);
      v.setWheelSuspensionStiffness(i, CAR.suspensionStiffness);
      v.setWheelSuspensionCompression(i, CAR.suspensionCompression);
      v.setWheelSuspensionRelaxation(i, CAR.suspensionRelaxation);
      v.setWheelMaxSuspensionTravel(i, CAR.suspensionTravel);
      v.setWheelMaxSuspensionForce(i, 1e5);
      v.setWheelFrictionSlip(i, CAR.frictionSlip);
      v.setWheelSideFrictionStiffness(i, CAR.sideFrictionStiffness);
    });
    this.vehicle = v;
  }

  /** Forward speed in m/s (negative when reversing). */
  get speed(): number {
    return this.vehicle.currentVehicleSpeed();
  }

  get steerAngle(): number {
    return this.steer;
  }

  wheel(i: number): WheelPose {
    const v = this.vehicle;
    return {
      steer: v.wheelSteering(i) ?? 0,
      rotation: v.wheelRotation(i) ?? 0,
      suspension: v.wheelSuspensionLength(i) ?? CAR.suspensionRest,
      inContact: v.wheelIsInContact(i),
    };
  }

  /**
   * Angle in radians between where the car points and where it is moving
   * (0 when gripping, large when sliding). 0 below walking pace.
   */
  get slipAngle(): number {
    const v = this.body.linvel();
    const horizontal = Math.hypot(v.x, v.z);
    if (horizontal < 3) return 0;
    const r = this.body.rotation();
    // Car's local +Z axis in world space.
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    const cos = (fx * v.x + fz * v.z) / (Math.hypot(fx, fz) * horizontal);
    // Treat reversing as straight-line travel.
    return Math.acos(Math.min(1, Math.abs(cos)));
  }

  step(c: CarControls, dt: number, place: CarEnvironment = NORMAL_PLACE): void {
    const speed = this.speed;
    const absSpeed = Math.abs(speed);

    // Steering: ease toward target; less lock at speed.
    const lock = CAR.maxSteer + (CAR.minSteer - CAR.maxSteer) * Math.min(absSpeed / MAX_SPEED_FOR_STEER, 1) ** 0.6;
    const target = -c.steer * lock;
    const delta = target - this.steer;
    this.steer += Math.sign(delta) * Math.min(Math.abs(delta), CAR.steerRate * dt);
    for (const i of STEERED) this.vehicle.setWheelSteering(i, this.steer);

    // Brake pedal reverses once (nearly) stopped, like most arcade-sim games.
    const wantsReverse = c.brake > 0 && c.throttle === 0 && speed < 1;
    if (wantsReverse && this.gear > 0) this.gear = -1;
    if (c.throttle > 0 && this.gear < 0 && speed > -1) this.gear = 1;

    const reversing = this.gear < 0;
    const pedal = reversing ? c.brake : c.throttle;
    const braking = reversing ? c.throttle : c.brake;

    this.updateGearbox(absSpeed, pedal, dt);
    const reverseLimited = reversing && speed < -CAR.maxReverseSpeed;
    const force = reverseLimited ? 0 : this.engineForce(pedal) * (reversing ? -1 : 1);
    for (const i of DRIVEN) this.vehicle.setWheelEngineForce(i, force);

    for (let i = 0; i < 4; i++) {
      const rear = DRIVEN.includes(i);
      let brake = braking * CAR.brakeForce;
      if (c.handbrake && rear) brake = CAR.handbrakeForce;
      // Gentle engine braking so the car coasts to a stop.
      if (pedal === 0 && braking === 0 && !c.handbrake) brake = absSpeed < 0.5 ? 10 : CAR.engineBrake;
      this.vehicle.setWheelBrake(i, brake);
      this.vehicle.setWheelFrictionSlip(i, CAR.frictionSlip * place.grip * (c.handbrake && rear ? CAR.handbrakeGrip : 1));
    }

    // Aerodynamic drag and rolling resistance oppose the velocity.
    const lv = this.body.linvel();
    const vMag = Math.hypot(lv.x, lv.y, lv.z);
    if (vMag > 0.01) {
      const drag = CAR.dragCoefficient * vMag * vMag + CAR.rollingResistance * vMag;
      const k = (-drag / vMag) * dt;
      this.body.applyImpulse({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);
    }

    // Low gravity: an upward push cancels part of the world's pull. Under water, the car
    // floats a little and the water holds it back.
    const lift = (1 - place.gravity) + (place.underwater ? 0.45 : 0);
    if (lift > 0) this.body.applyImpulse({ x: 0, y: CAR.mass * 9.81 * lift * dt, z: 0 }, true);
    if (place.underwater) {
      const k = -CAR.mass * 0.9 * dt;
      this.body.applyImpulse({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);
      const av = this.body.angvel();
      this.body.setAngvel({ x: av.x * 0.97, y: av.y * 0.97, z: av.z * 0.97 }, true);
    }

    // Wheels roll over someone lying in the road rather than climbing onto them.
    this.vehicle.updateVehicle(dt, undefined, SKIP_RAGDOLLS);
  }

  /** Puts the car back on its wheels at its current spot, keeping its heading. */
  reset(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    this.body.setTranslation({ x: t.x, y: t.y + 1.5, z: t.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.gear = 1;
  }

  private updateGearbox(absSpeed: number, pedal: number, dt: number): void {
    const ratio = this.gear < 0 ? CAR.reverseGear : CAR.gears[this.gear - 1];
    const wheelRpm = (absSpeed / (2 * Math.PI * CAR.wheelRadius)) * 60;
    const driveRpm = wheelRpm * ratio * CAR.finalDrive;
    // Below ~1st-gear idle speed the clutch slips: revs follow the pedal instead.
    const freeRev = CAR.idleRpm + pedal * 3200;
    const targetRpm = Math.max(driveRpm, absSpeed < 4 ? freeRev : CAR.idleRpm);
    this.rpm += (Math.min(targetRpm, CAR.redlineRpm) - this.rpm) * Math.min(1, dt * 12);
    this.load += (pedal - this.load) * Math.min(1, dt * 8);

    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      return;
    }
    if (this.gear > 0) {
      if (driveRpm > CAR.upshiftRpm && this.gear < CAR.gears.length) this.shift(this.gear + 1);
      else if (driveRpm < CAR.downshiftRpm && this.gear > 1) this.shift(this.gear - 1);
    }
  }

  private shift(gear: number): void {
    this.gear = gear;
    this.shiftTimer = CAR.shiftTime;
  }

  private engineForce(pedal: number): number {
    if (pedal === 0 || this.shiftTimer > 0) return 0;
    const ratio = this.gear < 0 ? CAR.reverseGear : CAR.gears[this.gear - 1];
    // Simple torque curve: builds from idle, peaks around 4500 rpm, fades toward redline.
    const x = this.rpm / CAR.redlineRpm;
    const curve = Math.max(0.35, 1 - 2.2 * (x - 0.64) ** 2);
    const limiter = this.rpm >= CAR.redlineRpm - 50 ? 0 : 1;
    const torque = CAR.peakTorque * curve * pedal * limiter;
    // Split across the two driven wheels.
    return ((torque * ratio * CAR.finalDrive * CAR.efficiency) / CAR.wheelRadius) / DRIVEN.length;
  }
}

/**
 * The car's true shape, from the side (z, y in the chassis frame; see CarModel), and how
 * wide: the body from bumper to bumper, and the cabin with its sloping windshield and roof.
 */
const SHAPES: { profile: [number, number][]; halfWidth: number }[] = [
  { profile: [[2.14, -0.42], [2.27, -0.3], [2.3, -0.04], [2.08, 0.1], [1.05, 0.19], [-1.5, 0.21], [-2.24, 0.1], [-2.27, -0.3], [-2.12, -0.42]], halfWidth: 0.85 },
  { profile: [[1, 0.2], [0.24, 0.68], [-0.4, 0.71], [-0.98, 0.64], [-1.46, 0.2]], halfWidth: 0.7 },
];

/**
 * Shapes for a car's body and cabin, weighing nothing: only limp bodies feel them (the box
 * does the driving), so someone knocked flying rolls up over the bonnet and windshield.
 */
export function carShapes(): RAPIER.ColliderDesc[] {
  return SHAPES.map(({ profile, halfWidth }) => {
    const points = profile.flatMap(([z, y]) => [-halfWidth, y, z, halfWidth, y, z]);
    return RAPIER.ColliderDesc.convexHull(new Float32Array(points))!.setDensity(0).setFriction(0.5).setRestitution(0.1);
  });
}
