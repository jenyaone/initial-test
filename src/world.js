import * as THREE from 'three';
import { hashInt, mulberry32 } from './util.js';
import { height as terrainHeight, TERRAIN_GLSL } from './terrain.js';

export const CHUNK = 36;          // world units per rock chunk
const MAX_PER_VARIANT = 300;
const SPAWN_SAFE_RADIUS = 14;     // no rocks where the flock starts

const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

function makeRockGeometry(variant) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const rng = mulberry32(1000 + variant * 77);
  const cache = new Map(); // same input vertex -> same displacement, so faces stay joined
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) { k = 0.7 + rng() * 0.55; cache.set(key, k); }
    v.multiplyScalar(k);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.25; // flatten the base
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeGround(segments) {
  const geo = new THREE.PlaneGeometry(520, 520, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  // The mesh is scaled to match the camera zoom, so world-space height has to
  // be divided by that scale before it is applied in object space.
  const uniforms = { uInvScale: { value: 1 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInvScale = uniforms.uInvScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uInvScale;
${TERRAIN_GLSL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = terrainNormal((modelMatrix * vec4(position, 1.0)).xz);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec2 wxz = (modelMatrix * vec4(transformed, 1.0)).xz;
float wh = terrainHeight(wxz);
transformed.y += wh * uInvScale;
vWPos = vec3(wxz.x, wh, wxz.y);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
float fhash(vec2 p) { p = mod(p, 4096.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1.0, 0.0)), f.x), mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  float cell = 30.0;
  vec2 ci = floor(p / cell);
  vec2 cf = fract(p / cell);
  float h  = fhash(ci);
  float h2 = fhash(ci + 7.3);
  float shade = mix(0.035, 0.13, h);
  // plough furrows, direction differs per field
  float coord = mix(p.x, p.y, step(0.5, h2));
  float furrow = 0.5 + 0.5 * sin(coord * 2.6 + vnoise(p * 0.3) * 2.0);
  shade *= 0.82 + 0.18 * furrow;
  // darker track between the fields
  float e = min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)) * cell;
  shade = mix(shade * 0.4, shade, smoothstep(0.25, 1.1, e));
  // soft mottling at three scales
  shade *= 0.75 + 0.5 * vnoise(p * 0.06);
  shade *= 0.82 + 0.36 * vnoise(p * 0.9);
  shade *= 0.9 + 0.2 * vnoise(p * 5.0);
  // hilltops catch a little more light than the hollows
  shade *= 1.0 + 0.3 * clamp(vWPos.y / 5.0, -1.0, 1.0);
  diffuseColor.rgb *= shade;
}`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

export class World {
  constructor(scene, lowDetail = false) {
    this.scene = scene;
    this.chunks = new Map();
    this.ground = makeGround(lowDetail ? 144 : 192);
    scene.add(this.ground);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7c7c7c, flatShading: true, roughness: 0.9 });
    this.rockMeshes = [0, 1, 2].map((v) => {
      const m = new THREE.InstancedMesh(makeRockGeometry(v), rockMat, MAX_PER_VARIANT);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.viewRadius = 3;          // chunks kept around the focus point
    this.lastCx = null;
    this.lastCz = null;
    this._dummy = new THREE.Object3D();
  }

  // Keep rocks streaming out as far as the fog, and grow the ground disc with
  // the camera, so a zoomed-out portrait view has no bare edge.
  setRange(zoom, fogFar) {
    this.ground.scale.setScalar(zoom);
    this.ground.userData.uniforms.uInvScale.value = 1 / zoom;
    const radius = Math.min(6, Math.max(3, Math.ceil(fogFar / CHUNK) + 1));
    if (radius !== this.viewRadius) {
      this.viewRadius = radius;
      this.lastCx = null; // force a rebuild at the new radius
    }
  }

  getChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let rocks = this.chunks.get(key);
    if (rocks) return rocks;
    rocks = [];
    const rng = mulberry32(hashInt(cx, cz, 91));
    const n = rng() < 0.2 ? 0 : 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const s = 1.1 + rng() * 2.1;
      const x = (cx + 0.1 + rng() * 0.8) * CHUNK;
      const z = (cz + 0.1 + rng() * 0.8) * CHUNK;
      if (x * x + z * z < SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS) continue;
      rocks.push({
        x, z, s,
        sy: 0.6 + rng() * 0.5,
        rot: rng() * Math.PI * 2,
        variant: Math.floor(rng() * 3),
        r: s * 0.95, // collision radius
      });
    }
    this.chunks.set(key, rocks);
    if (this.chunks.size > 3000) this.prune(cx, cz);
    return rocks;
  }

  prune(cx, cz) {
    for (const [key] of this.chunks) {
      const kx = Math.floor(key / 65536) - 32768;
      const kz = (key % 65536) - 32768;
      if (Math.abs(kx - cx) > this.viewRadius + 2 || Math.abs(kz - cz) > this.viewRadius + 2) this.chunks.delete(key);
    }
  }

  // Calls fn(rock) for every rock that could be within ~CHUNK of (x, z).
  forEachRockNear(x, z, fn) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const rocks = this.getChunk(cx + dx, cz + dz);
        for (let i = 0; i < rocks.length; i++) fn(rocks[i]);
      }
    }
  }

  update(focus) {
    this.ground.position.set(focus.x, 0, focus.z);
    const cx = Math.floor(focus.x / CHUNK);
    const cz = Math.floor(focus.z / CHUNK);
    if (cx === this.lastCx && cz === this.lastCz) return;
    this.lastCx = cx;
    this.lastCz = cz;

    const counts = [0, 0, 0];
    const d = this._dummy;
    const R = this.viewRadius;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const rocks = this.getChunk(cx + dx, cz + dz);
        for (const r of rocks) {
          const idx = counts[r.variant];
          if (idx >= MAX_PER_VARIANT) continue;
          d.position.set(r.x, terrainHeight(r.x, r.z) - 0.25 * r.s * r.sy, r.z);
          d.rotation.set(0, r.rot, 0);
          d.scale.set(r.s, r.s * r.sy, r.s);
          d.updateMatrix();
          this.rockMeshes[r.variant].setMatrixAt(idx, d.matrix);
          counts[r.variant]++;
        }
      }
    }
    this.rockMeshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
