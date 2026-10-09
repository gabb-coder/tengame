import * as THREE from 'three';
import { smoothstep } from '../../../../shared/noise.ts';
import { ARCTIC } from '../../../../shared/zones/arctic.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, placement } from '../town/meshBuilder.ts';
import { grazer, Herd, loopMover, penguin } from './creatures.ts';
import { ChunkedBuilder, compose, conifer, cylinderCollider, instanced, mulberry32, Placement, rockGeometry, type ZoneContent, type ZoneContext } from './kit.ts';

/** Frostfang Tundra: snowy forest, glaciers, igloos, the outpost, and the aurora. */
export function buildArctic(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-arctic';
  const b = new ChunkedBuilder();
  const place = new Placement('arctic');
  const lake = ARCTIC.lake;
  place.avoid({ type: 'circle', x: lake.x, z: lake.z, r: lake.r + 8 });
  place.avoid({ type: 'circle', x: ARCTIC.camp.x, z: ARCTIC.camp.z, r: 44 });

  // Snow-laden spruce forest.
  const tree = conifer(true);
  const trees = place.scatter(420, { minX: -598, maxX: -210, minZ: -598, maxZ: -210 }, 2.2, 61, (x, z) => terrain.heightAt(x, z) < 22);
  const items = trees.map((t) => {
    const h = 7 + t.rng() * 9;
    return { matrix: compose(t.x, terrain.heightAt(t.x, t.z) - 0.2, t.z, t.rng() * 6, new THREE.Vector3(h * 0.55, h, h * 0.55)), h };
  });
  group.add(instanced(tree.trunk, m.bark, items.map((i) => ({ matrix: i.matrix }))));
  group.add(instanced(tree.crown, m.foliage, items.map((i) => ({ matrix: i.matrix, color: '#2f4f3c' }))));
  group.add(instanced(tree.snow!, zm.snow, items.map((i) => ({ matrix: i.matrix, color: '#ffffff' }))));
  for (const t of trees) cylinderCollider(physics, t.x, terrain.heightAt(t.x, t.z) - 0.5, t.z, 0.3, 6);

  // Snow-capped boulders.
  const rock = rockGeometry(7, 1, 0.45);
  const rocks = place.scatter(70, { minX: -598, maxX: -210, minZ: -598, maxZ: -210 }, 2, 62);
  group.add(
    instanced(
      rock,
      zm.rock,
      rocks.map((r) => ({ matrix: compose(r.x, terrain.heightAt(r.x, r.z), r.z, r.rng() * 6, 1 + r.rng() * 2.2), color: '#c8ccd2' })),
    ),
  );

  // Glaciers: great blue ice shelves on the mountains along the world's edge.
  const rng = mulberry32(64);
  for (let i = 0; i < 46; i++) {
    const along = -600 + rng() * 400;
    const out = -605 - rng() * 70;
    const [x, z] = i % 2 ? [out, along - 190] : [along - 190, out];
    if (x > -200 || z > -200) continue;
    const s = 10 + rng() * 22;
    const g = rockGeometry(100 + i, 1, 0.6);
    b.add(g, zm.glacier, compose(x, terrain.heightAt(x, z) - s * 0.2, z, rng() * 6, new THREE.Vector3(s * (1 + rng()), s * (0.6 + rng() * 0.6), s * (1 + rng()))), '#ffffff', { castShadow: false });
  }
  // Ice blocks frozen into the lake, and an ice-fishing hut.
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const r = 15 + rng() * (lake.r - 22);
    const x = lake.x + Math.cos(a) * r;
    const z = lake.z + Math.sin(a) * r;
    const s = 1 + rng() * 2.5;
    const g = rockGeometry(200 + i, 0, 0.5);
    b.add(g, zm.glacier, compose(x, 0, z, rng() * 6, new THREE.Vector3(s * 1.4, s, s * 1.2)), '#ffffff');
    cylinderCollider(physics, x, 0, z, s, s);
  }
  const hut = { x: lake.x + 18, z: lake.z - 14 };
  b.add(box(3, 2.4, 2.6, 1), zm.planks, placement(hut.x, 1.2, hut.z, 0.4), '#8e3b2a');
  b.add(box(3.4, 0.2, 3.2, 1), zm.snow, placement(hut.x, 2.55, hut.z, 0.4), '#ffffff');
  boxCollider(physics, placement(hut.x, 0, hut.z, 0.4), { x: 0, y: 1.2, z: 0 }, { x: 3, y: 2.4, z: 2.6 });

  // The igloo camp.
  for (const ig of ARCTIC.igloos) buildIgloo(ctx, b, ig.x, ig.z, ig.yaw);
  // Sleds and supply crates around the camp.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const x = ARCTIC.camp.x + Math.cos(a) * 14;
    const z = ARCTIC.camp.z + Math.sin(a) * 14;
    b.add(box(1.2, 0.2, 2.6, 1), zm.planks, placement(x, 0.35, z, a), '#8a5a32');
    for (const s of [-0.5, 0.5]) b.add(box(0.06, 0.06, 2.8), m.darkMetal, placement(x + Math.cos(a) * s, 0.1, z - Math.sin(a) * s, a));
    b.add(box(0.8, 0.6, 0.8, 1), zm.planks, placement(x, 0.75, z, a), '#6a4a2a');
  }

  // The outpost: radio mast with a red light, fuel drums and a snowcat shed.
  const ox = ARCTIC.x + 175;
  const oz = ARCTIC.outpostZ - 22;
  for (let k = 0; k < 4; k++) {
    const y = k * 6;
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(0, 3, 0), m.darkMetal, placement(ox - 0.6, y, oz - 0.6));
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(0, 3, 0), m.darkMetal, placement(ox + 0.6, y, oz - 0.6));
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(0, 3, 0), m.darkMetal, placement(ox, y, oz + 0.6));
    b.add(box(1.4, 0.08, 1.4), m.darkMetal, placement(ox, y + 6, oz));
  }
  b.add(new THREE.SphereGeometry(0.35, 10, 8), zm.glow, placement(ox, 24.4, oz), '#ff2a1a');
  cylinderCollider(physics, ox, 0, oz, 1, 24);
  for (let i = 0; i < 6; i++) {
    const x = ARCTIC.x + 40 + (i % 3) * 1.3;
    const z = ARCTIC.outpostZ - 14 - Math.floor(i / 3) * 1.3;
    b.add(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12).translate(0, 0.6, 0), zm.paint, placement(x, 0.15, z), i % 2 ? '#b8452e' : '#2e5a8a');
    cylinderCollider(physics, x, 0, z, 0.5, 1.3);
  }

  const observatoryDome = buildObservatory(ctx, b);
  group.add(b.build('arctic'), observatoryDome);

  // Campfire warmth is on the shared fires; here, just a lamp on the observatory door.
  lights.add({ position: new THREE.Vector3(ARCTIC.observatory.x, 3, ARCTIC.observatory.z + 12), color: '#ffd9a0', intensity: 12, range: 14, active: () => true });

  // Wildlife: a reindeer herd and a penguin colony by the lake.
  const reindeer = new Herd(
    grazer('reindeer', '#7a5a42'),
    7,
    loopMover(
      [
        [-300, -250],
        [-260, -300],
        [-330, -350],
        [-380, -300],
        [-360, -250],
      ],
      1.1,
      terrain,
      { spacing: 6, spread: 3 },
    ),
  );
  const penguins = new Herd(
    penguin(),
    12,
    loopMover(
      [
        [lake.x - 30, lake.z + lake.r + 6],
        [lake.x + 10, lake.z + lake.r + 4],
        [lake.x + 30, lake.z + lake.r - 10],
        [lake.x - 10, lake.z + lake.r - 6],
      ],
      0.45,
      terrain,
      { spacing: 2.2, spread: 0.8 },
    ),
  );
  group.add(reindeer.group, penguins.group);

  const aurora = new Aurora();
  group.add(aurora.mesh);

  return {
    id: 'arctic',
    group,
    update(view) {
      reindeer.update(view.time, view.camera.position);
      penguins.update(view.time, view.camera.position);
      aurora.update(view.time, view.night);
      observatoryDome.rotation.y = view.time * 0.02;
    },
  };
}

/** A snow-block dome with an entrance tunnel, hollow inside, with a fur rug. */
function buildIgloo(ctx: ZoneContext, b: ChunkedBuilder, x: number, z: number, yaw: number): void {
  const { physics, zm, m } = ctx;
  const r = 3.4;
  const M = placement(x, 0, z, yaw);
  // The dome shell, open at the doorway (local +Z).
  const shell = new THREE.SphereGeometry(r, 20, 10, Math.PI / 2 + 0.38, Math.PI * 2 - 0.76, 0, Math.PI / 2);
  b.add(shell, zm.snow, M, '#f4f8fb');
  b.add(new THREE.SphereGeometry(r - 0.3, 20, 10, Math.PI / 2 + 0.38, Math.PI * 2 - 0.76, 0, Math.PI / 2).scale(-1, 1, 1), zm.snow, M, '#dfe9f0');
  // Block joints: rings around the dome.
  for (let k = 1; k < 5; k++) {
    const a = (k / 5) * (Math.PI / 2);
    b.add(new THREE.TorusGeometry(Math.cos(a) * r + 0.02, 0.04, 4, 32, Math.PI * 2 - 0.76).rotateX(Math.PI / 2).rotateY(-Math.PI / 2 + 0.38), zm.snow, M.clone().multiply(placement(0, Math.sin(a) * r, 0)), '#cfdce6', { castShadow: false });
  }
  // Entrance tunnel.
  const tunnel = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 14, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  b.add(tunnel, zm.snow, M.clone().multiply(placement(0, 0, r - 0.2)), '#f4f8fb');
  // A fur rug and a lantern inside.
  b.add(new THREE.CircleGeometry(1.6, 16).rotateX(-Math.PI / 2), m.fabric, M.clone().multiply(placement(0, 0.03, -0.5)), '#8a6a4a', { castShadow: false });
  ctx.lights.add({ position: new THREE.Vector3(x, 1.4, z), color: '#ffb870', intensity: 6, range: 6, flicker: true });
  // Colliders: wall blocks around the ring, leaving the door; a cap on top.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.5) continue;
    boxCollider(physics, M.clone().multiply(placement(Math.cos(a) * (r - 0.3), 0, Math.sin(a) * (r - 0.3), -a + Math.PI / 2)), { x: 0, y: 1.3, z: 0 }, { x: 1.6, y: 2.6, z: 0.5 });
  }
  boxCollider(physics, M, { x: 0, y: r - 0.4, z: 0 }, { x: r, y: 0.6, z: r });
}

/** A domed observatory with a telescope poking out of the slit. */
function buildObservatory(ctx: ZoneContext, b: ChunkedBuilder): THREE.Group {
  const { physics, zm, m } = ctx;
  const o = ARCTIC.observatory;
  b.add(new THREE.CylinderGeometry(9, 9.5, 7, 28).translate(0, 3.5, 0), zm.paint, placement(o.x, 0, o.z), '#e8ecf0');
  b.add(box(2.2, 3, 0.3), m.door, placement(o.x, 1.5, o.z + 9.3), '#2e4a7a');
  cylinderCollider(physics, o.x, 0, o.z, 9.5, 7);
  const dome = new THREE.Group();
  dome.position.set(o.x, 7, o.z);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(9, 28, 14, 0.25, Math.PI * 2 - 0.5, 0, Math.PI / 2), zm.metal);
  shell.rotation.y = Math.PI / 2;
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 9, 16), m.steel);
  scope.position.set(0, 4, 3.5);
  scope.rotation.x = 0.7;
  dome.add(shell, scope);
  dome.traverse((o) => (o.castShadow = true));
  return dome;
}

/** Curtains of green and violet light rippling high over the tundra at night. */
class Aurora {
  readonly mesh: THREE.Mesh;
  private uniforms = { uTime: { value: 0 }, uStrength: { value: 0 } };

  constructor() {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.PlaneGeometry(900, 140, 120, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        // Bend each curtain into a slow S-curve, one behind another.
        pos.setZ(i, Math.sin(x / 140 + k * 1.7) * 70 + k * 80);
        pos.setY(i, pos.getY(i) + 150 + k * 20);
      }
      g.computeVertexNormals();
      parts.push(g);
    }
    const geometry = new THREE.BufferGeometry();
    const merged = parts.map((p) => p.toNonIndexed());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(merged.flatMap((p) => [...(p.attributes.position.array as Float32Array)]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(merged.flatMap((p) => [...(p.attributes.uv.array as Float32Array)]), 2));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vPos; void main() { vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uStrength; varying vec2 vUv; varying vec3 vPos;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main() {
          float x = vUv.x * 60.0;
          float rays = noise(x * 3.0 + uTime * 0.6) * 0.6 + noise(x * 11.0 - uTime * 1.3) * 0.4;
          float band = noise(x * 0.5 + uTime * 0.15);
          float v = vUv.y;
          float fade = smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.35, 1.0, v));
          vec3 green = vec3(0.15, 1.0, 0.45);
          vec3 violet = vec3(0.6, 0.2, 0.9);
          vec3 color = mix(green, violet, smoothstep(0.3, 0.9, v));
          float a = fade * rays * (0.4 + band) * uStrength;
          gl_FragColor = vec4(color * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(ARCTIC.x - 40, 0, ARCTIC.z - 120);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(time: number, night: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uStrength.value = smoothstep(night, 0.35, 0.9) * 1.1;
    this.mesh.visible = night > 0.3;
  }
}
