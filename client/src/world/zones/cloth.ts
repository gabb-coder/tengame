import * as THREE from 'three';

/** One flag or banner: where it hangs and how big it is. */
export interface BannerSpec {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  color: string;
  /** Hangs down from its top edge (on a wall) instead of flying from a pole. */
  hanging: boolean;
  /** Which way a hanging banner faces. */
  yaw: number;
}

/**
 * A flag flying from a pole whose top is at (x, y, z), or (`hanging`) a banner whose top
 * edge's middle is there.
 */
export function banner(x: number, y: number, z: number, width: number, height: number, color: string, hanging = false, yaw = 0): BannerSpec {
  return { x, y, z, width, height, color, hanging, yaw };
}

/**
 * All flags and banners as one mesh that ripples in the wind (the motion is done on the
 * GPU: each vertex knows how far it is from the edge that's tied down).
 */
export class Banners {
  private specs: BannerSpec[] = [];
  private material: THREE.MeshStandardMaterial;
  private time = { value: 0 };

  constructor() {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const time = this.time;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float flutter;\nattribute float phase;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float wave = sin(uTime * 4.0 + phase + flutter * 5.0) * 0.6 + sin(uTime * 7.3 + phase * 2.0 + flutter * 9.0) * 0.25;
          transformed += objectNormal * wave * flutter * 0.35;`,
        );
    };
  }

  add(spec: BannerSpec): void {
    this.specs.push(spec);
  }

  mesh(): THREE.Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const flutter: number[] = [];
    const phases: number[] = [];
    const color = new THREE.Color();
    const cols = 8;
    const rows = 4;
    this.specs.forEach((s, n) => {
      color.set(s.color);
      // Local frame: u along the cloth away from the tie, v across it.
      const yaw = s.hanging ? s.yaw : 0;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const normal = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const point = (u: number, v: number) => {
        if (s.hanging) return new THREE.Vector3(s.x, s.y - v * s.height, s.z).addScaledVector(right, (u - 0.5) * s.width);
        return new THREE.Vector3(s.x + u * s.width, s.y - v * s.height, s.z);
      };
      const flutterAt = (u: number, v: number) => (s.hanging ? v * 0.5 : u);
      const grid: { p: THREE.Vector3; f: number }[][] = [];
      for (let i = 0; i <= cols; i++) {
        grid.push([]);
        for (let j = 0; j <= rows; j++) {
          const u = i / cols;
          const v = j / rows;
          // Hanging banners end in a point.
          const p = point(s.hanging ? 0.5 + (u - 0.5) * (1 - Math.max(0, v - 0.8) * 2.5) : u, v);
          grid[i].push({ p, f: flutterAt(u, v) });
        }
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          for (const [a, b] of [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
            [1, 1],
            [0, 1],
          ]) {
            const g = grid[i + a][j + b];
            positions.push(g.p.x, g.p.y, g.p.z);
            normals.push(normal.x, normal.y, normal.z);
            colors.push(color.r, color.g, color.b);
            flutter.push(g.f);
            phases.push(n * 1.7);
          }
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('flutter', new THREE.Float32BufferAttribute(flutter, 1));
    g.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  update(time: number): void {
    this.time.value = time;
  }
}
