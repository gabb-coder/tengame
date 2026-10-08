import type { World } from '../world/world.ts';

/** Time of day behind the title screen: warm afternoon sun with long shadows. */
const TITLE_HOUR = 16.2;
const ORBIT_RADIUS = 95;
const ORBIT_HEIGHT = 30;
/** Radians per second; a full circle takes about five minutes. */
const ORBIT_SPEED = 0.02;
/** It's only a backdrop: 30 fps at normal resolution is plenty, and spares weak laptops. */
const FRAME_MS = 1000 / 30;

/** The town, slowly circled from above, behind the title screen. */
export class TitleScene {
  private onResize = () => this.world.resize(innerWidth, innerHeight);
  private pixelRatio = 1;

  constructor(private world: World) {}

  start(): void {
    const { world } = this;
    world.dayNight.setClock({ hours: TITLE_HOUR, rate: 0 }, performance.now());
    addEventListener('resize', this.onResize);
    this.onResize();
    const camera = world.camera;
    this.pixelRatio = world.renderer.getPixelRatio();
    world.renderer.setPixelRatio(1);
    const start = performance.now();
    let last = start - FRAME_MS;
    world.renderer.setAnimationLoop(() => {
      const now = performance.now();
      if (now - last < FRAME_MS - 2) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const angle = 2.2 + ((now - start) / 1000) * ORBIT_SPEED;
      camera.position.set(Math.cos(angle) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.sin(angle) * ORBIT_RADIUS);
      camera.lookAt(0, 0, 0);
      world.dayNight.update(now, dt, camera.position.clone().multiplyScalar(0.5).setY(0), false);
      world.town.updateInteriors(camera.position);
      world.renderer.render(world.scene, camera);
    });
  }

  /** Hands the renderer over to the game. */
  stop(): void {
    this.world.renderer.setAnimationLoop(null);
    this.world.renderer.setPixelRatio(this.pixelRatio);
    removeEventListener('resize', this.onResize);
    this.onResize();
  }
}
