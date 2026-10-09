import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Clock } from '../../../shared/protocol.ts';
import { AMBIENCE, type Ambience } from './zones/ambience.ts';

const { smoothstep, lerp } = THREE.MathUtils;

/** Lighting at full day and full night; dusk and dawn blend between them. */
const DAY = {
  sun: 2.6,
  hemisphere: 0.4,
  environment: 0.6,
  exposure: 0.6,
  fog: new THREE.Color('#b9c7d6'),
  hemiSky: new THREE.Color('#cfe3ff'),
  hemiGround: new THREE.Color('#4a4034'),
};
const NIGHT = {
  moon: 0.32,
  hemisphere: 0.16,
  environment: 0.12,
  exposure: 1.0,
  fog: new THREE.Color('#0b1222'),
  hemiSky: new THREE.Color('#25365e'),
  hemiGround: new THREE.Color('#141210'),
};
const SUNSET_FOG = new THREE.Color('#d6a07e');
const SUN_LOW = new THREE.Color('#ffa463');
const SUN_HIGH = new THREE.Color('#fff4e0');
const MOON = new THREE.Color('#a8bcff');
/** Indoors the sky light is dimmed to this fraction (it can't see walls). */
const INDOOR_SKY = 0.3;
/** Re-render the sky into the environment map when the sun has moved this far. */
const ENV_UPDATE_ANGLE = THREE.MathUtils.degToRad(2);
const STARS = 1600;
/** Sky tints: the black of space, and a dim purple-grey smog. */
const SPACE_TINT = new THREE.Color(0.05, 0.04, 0.09);
const SMOG_TINT = new THREE.Color(0.5, 0.42, 0.62);

/**
 * Time of day: moves the sun and moon, colors the sky, fog and ambient light, fades
 * in stars at night, and adapts exposure. `night` (0..1) drives street lamps,
 * lit windows and headlights elsewhere.
 */
export class DayNight {
  /** 0 in full daylight, 1 at night. */
  night = 0;
  /** Light from the sun (by day) or the moon (by night); casts shadows. */
  readonly light: THREE.DirectionalLight;
  private hemisphere: THREE.HemisphereLight;
  private sky: Sky;
  private envSky: Sky;
  private envScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envSunDir = new THREE.Vector3(0, -1, 0);
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private clockHours = 12;
  private clockRate = 0;
  private clockAt = 0;
  private indoor = 0;
  readonly sunDir = new THREE.Vector3();
  private skyTint = new THREE.Color(1, 1, 1);
  private envTint = new THREE.Color(1, 1, 1);

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {
    this.sky = tintable(new Sky());
    this.sky.scale.setScalar(1500);
    this.scene.add(this.sky);
    this.envSky = tintable(new Sky());
    this.envSky.scale.setScalar(1500);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.scene.fog = new THREE.Fog(DAY.fog.clone(), 160, 750);

    this.light = new THREE.DirectionalLight(SUN_HIGH.clone(), DAY.sun);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const s = this.light.shadow.camera;
    s.left = s.bottom = -70;
    s.right = s.top = 70;
    s.near = 1;
    s.far = 250;
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.02;
    this.scene.add(this.light, this.light.target);

    this.hemisphere = new THREE.HemisphereLight(DAY.hemiSky.clone(), DAY.hemiGround.clone(), DAY.hemisphere);
    this.scene.add(this.hemisphere);

    this.stars = makeStars();
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(18, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#e8ecff', fog: false, toneMapped: false }),
    );
    this.scene.add(this.moon);
  }

  setClock(clock: Clock, now: number): void {
    this.clockHours = clock.hours;
    this.clockRate = clock.rate;
    this.clockAt = now;
  }

  /** Current time of day in hours (0..24). */
  hours(now: number): number {
    return (this.clockHours + ((now - this.clockAt) / 1000) * this.clockRate) % 24;
  }

  /**
   * `inside` dims the sky's light, which would otherwise shine through walls; `ambience`
   * is the feel of the place (its haze, sky and light).
   */
  update(now: number, dt: number, focus: THREE.Vector3, inside: boolean, ambience: Ambience = AMBIENCE.town): void {
    this.indoor += ((inside ? 1 : 0) - this.indoor) * (1 - Math.exp(-dt * 3));
    const h = this.hours(now);

    // The sun rises in the east (+X) at 6:00, peaks in the south (+Z) at noon, sets at 18:00.
    const a = ((h - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.86, Math.sin(a) * 0.5).normalize();
    const moonDir = this.sunDir.clone().negate().setY(Math.abs(this.sunDir.y) * 0.9 + 0.15).normalize();
    const sunUp = this.sunDir.y;
    const day = smoothstep(sunUp, -0.1, 0.22);
    this.night = 1 - day;

    // The sky box is finite, so it travels with the player (it's drawn as if at infinity).
    this.sky.position.copy(focus);
    // Sky dome: hazier and redder when the sun is low.
    const low = 1 - smoothstep(sunUp, 0.05, 0.4);
    const { space, overcast } = ambience;
    this.skyTint.setRGB(1, 1, 1).lerp(SMOG_TINT, overcast * 0.7).lerp(SPACE_TINT, space);
    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.sunPosition.value.copy(this.sunDir);
      u.turbidity.value = lerp(lerp(5, 9, low), 14, overcast * 0.6);
      u.rayleigh.value = lerp(1.4, 2.6, low) * (1 - space * 0.9);
      u.mieCoefficient.value = lerp(0.004, 0.009, low);
      u.mieDirectionalG.value = 0.8;
      u.cloudCoverage.value = lerp(0.4, 0.88, overcast) * (1 - space);
      u.cloudDensity.value = lerp(0.4, 0.75, overcast);
      u.skyTint.value.copy(this.skyTint);
      u.time.value = now / 1000;
    }

    // One shadow-casting light: the sun by day, the moon by night.
    const sunPower = smoothstep(sunUp, -0.03, 0.18);
    const useSun = sunUp > -0.03;
    const dir = useSun ? this.sunDir : moonDir;
    this.light.position.copy(focus).addScaledVector(dir, 120);
    this.light.target.position.copy(focus);
    if (useSun) {
      this.light.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(sunUp, 0.05, 0.45));
      this.light.intensity = DAY.sun * sunPower * ambience.sun * (1 - overcast * 0.35);
    } else {
      this.light.color.copy(MOON);
      this.light.intensity = NIGHT.moon * smoothstep(moonDir.y, 0, 0.25);
    }

    const sky = lerp(1, INDOOR_SKY, this.indoor);
    this.hemisphere.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, day);
    this.hemisphere.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, day);
    this.hemisphere.intensity = lerp(NIGHT.hemisphere, DAY.hemisphere, day) * sky;
    this.scene.environmentIntensity = lerp(NIGHT.environment, DAY.environment, day) * sky;
    this.renderer.toneMappingExposure = lerp(NIGHT.exposure, DAY.exposure, day);

    const fogObj = this.scene.fog as THREE.Fog;
    fogObj.color.copy(ambience.fogNight).lerp(ambience.fogDay, day).lerp(SUNSET_FOG, low * day * 0.6 * (1 - space) * (1 - overcast));
    fogObj.near = ambience.fogNear;
    fogObj.far = ambience.fogFar;

    // Stars and moon fade in after dusk; they follow the camera so they're always "at infinity".
    const starsMat = this.stars.material as THREE.PointsMaterial;
    starsMat.opacity = Math.max(smoothstep(this.night, 0.4, 1) * (1 - overcast), smoothstep(space, 0.3, 0.9));
    this.stars.visible = starsMat.opacity > 0.01;
    this.stars.position.copy(focus);
    this.stars.rotation.y = (h / 24) * Math.PI * 2;
    this.moon.visible = this.night > 0.2;
    this.moon.position.copy(focus).addScaledVector(moonDir, 1100);

    this.updateEnvironment();
  }

  /** Reflections and ambient light come from the sky; re-render it as the sun moves. */
  private updateEnvironment(): void {
    const tintMoved = Math.abs(this.envTint.r - this.skyTint.r) + Math.abs(this.envTint.g - this.skyTint.g) + Math.abs(this.envTint.b - this.skyTint.b) > 0.06;
    if (this.envTarget && this.envSunDir.angleTo(this.sunDir) < ENV_UPDATE_ANGLE && !tintMoved) return;
    this.envSunDir.copy(this.sunDir);
    this.envTint.copy(this.skyTint);
    const target = this.pmrem.fromScene(this.envScene);
    this.scene.environment = target.texture;
    this.envTarget?.dispose();
    this.envTarget = target;
  }
}

/** Adds a color the sky is multiplied by (for space and smog). */
function tintable(sky: Sky): Sky {
  const mat = sky.material;
  mat.uniforms.skyTint = { value: new THREE.Color(1, 1, 1) };
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform float time;', 'uniform float time;\nuniform vec3 skyTint;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyTint, 1.0 );');
  return sky;
}

function makeStars(): THREE.Points {
  const positions = new Float32Array(STARS * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < STARS; i++) {
    // Upper hemisphere only, denser toward the horizon like a real sky's apparent density.
    v.set(Math.random() * 2 - 1, Math.random() ** 0.7, Math.random() * 2 - 1).normalize().multiplyScalar(1200);
    positions.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    g,
    new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
  );
}
