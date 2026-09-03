import * as THREE from 'three';
import { hashInt, mulberry32 } from './util.js';
import { height as terrainHeight, TERRAIN_GLSL, BARN, PEN, PEN_GATE_Z, penFences, inPen } from './terrain.js';

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

function makeGround(segments, lowDetail) {
  const geo = new THREE.PlaneGeometry(520, 520, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  // The mesh is scaled to match the camera zoom, so world-space height has to
  // be divided by that scale before it is applied in object space.
  const uniforms = {
    uInvScale: { value: 1 },
    uContour: { value: 0.4 },                    // height between contour lines
    uLineWidth: { value: lowDetail ? 1.0 : 0.8 }, // in pixels, a touch thicker without antialiasing
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying float vSlope;
uniform float uInvScale;
${TERRAIN_GLSL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = terrainNormal((modelMatrix * vec4(position, 1.0)).xz);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec2 wxz = (modelMatrix * vec4(transformed, 1.0)).xz;
float wh = terrainHeight(wxz);
transformed.y += wh * uInvScale;
vWPos = vec3(wxz.x, wh, wxz.y);
vSlope = length(terrainGrad(wxz));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying float vSlope;
uniform float uContour;
uniform float uLineWidth;
${TERRAIN_GLSL}
float fhash(vec2 p) { p = mod(p, 4096.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1.0, 0.0)), f.x), mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// 1 on a contour line, 0 off it, with a screen-space width so the lines stay
// crisp and even whether the ground is steep or flat, near or far.
float contour(float h, float interval, float px) {
  float d = abs(fract(h / interval + 0.5) - 0.5) * interval;
  float w = max(fwidth(h), 1e-5) * px;
  return 1.0 - smoothstep(w * 0.3, w * 1.0, d);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float ink;
{
  vec2 p = vWPos.xz;
  // exact height per pixel, not the mesh's linear guess, so the lines curve
  // smoothly even where the ground mesh is coarse
  float h = terrainHeight(p);
  float slope = length(terrainGrad(p));
  // black paper with the faintest tooth to it
  float paper = 0.03 + 0.012 * vnoise(p * 0.12);
  // minor lines every interval, an index line every fifth
  float minor = contour(h, uContour, uLineWidth);
  float index = contour(h, uContour * 5.0, uLineWidth * 1.7);
  ink = max(minor * 0.42, index * 0.8);
  // flats get the map's stipple: sparse dots where the ground is nearly level
  float level = 1.0 - smoothstep(0.015, 0.05, slope);
  vec2 cellp = p * 1.4;
  vec2 ci = floor(cellp);
  vec2 jitter = (vec2(fhash(ci), fhash(ci + 3.7)) - 0.5) * 0.6;
  float dotR = length(fract(cellp) - 0.5 - jitter);
  float dots = (1.0 - smoothstep(0.05, 0.1, dotR)) * step(0.6, fhash(ci + 11.1));
  ink = max(ink, dots * level * 0.6);
  diffuseColor.rgb = mix(vec3(paper), vec3(0.82), ink);
}`)
      // a little glow on the ink so a line in a sheep's shadow never fully vanishes
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(ink * 0.08);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

function makeBarn() {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.9, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 1 });
  const { w, d, door, wallH } = BARN;
  const T = 0.6;
  const wall = (sx, sz, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), wallMat);
    m.position.set(x, wallH / 2, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  wall(w + T, T, 0, -d / 2);                       // back
  wall(T, d, -w / 2, 0);                           // left
  wall(T, d, w / 2, 0);                            // right
  const stub = (w - door) / 2;
  wall(stub, T, -w / 2 + stub / 2, d / 2);         // front, either side of the door
  wall(stub, T, w / 2 - stub / 2, d / 2);
  // gable roof: two slabs meeting at a ridge that runs along x
  const pitch = 0.5;
  const half = d / 2 + 0.8;
  const slabLen = Math.hypot(half, half * Math.tan(pitch));
  for (const side of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 0.35, slabLen), roofMat);
    slab.position.set(0, wallH + (half * Math.tan(pitch)) / 2, side * half / 2);
    slab.rotation.x = -side * pitch;
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
  }
  // gable ends
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - T / 2, 0); shape.lineTo(w / 2 + T / 2, 0); shape.lineTo(0, half * Math.tan(pitch)); shape.closePath();
    const end = new THREE.Mesh(new THREE.ShapeGeometry(shape), wallMat);
    end.position.set(0, wallH, side * d / 2);
    end.castShadow = true;
    g.add(end);
  }
  // the yard: post-and-rail fences for every segment that is not a barn wall
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 });
  for (const [x1, z1, x2, z2] of penFences().slice(5)) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.18), fenceMat);
    rail.position.set((x1 + x2) / 2 - BARN.x, 1.35, (z1 + z2) / 2 - BARN.z);
    rail.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    rail.castShadow = true;
    g.add(rail);
    const rail2 = rail.clone(); rail2.position.y = 0.7; g.add(rail2);
    const posts = Math.max(1, Math.round(len / 2.4));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.22), fenceMat);
      post.position.set(x1 + (x2 - x1) * t - BARN.x, 0.8, z1 + (z2 - z1) * t - BARN.z);
      post.castShadow = true;
      g.add(post);
    }
  }
  // a lit gate sill, so the opening reads from above
  const gateSill = new THREE.Mesh(new THREE.BoxGeometry(PEN.gate, 0.1, 0.4), trimMat);
  gateSill.position.set(0, 0.05, PEN_GATE_Z - BARN.z);
  g.add(gateSill);
  // a lit threshold so the door reads from above and on the map
  const sill = new THREE.Mesh(new THREE.BoxGeometry(door, 0.12, 0.5), trimMat);
  sill.position.set(0, 0.06, d / 2);
  g.add(sill);
  const lamp = new THREE.PointLight(0xffe6c0, 14, 26, 1.5);
  lamp.position.set(0, wallH - 0.5, d / 2 + 1.5);
  g.add(lamp);
  g.position.set(BARN.x, terrainHeight(BARN.x, BARN.z), BARN.z);
  return g;
}

export class World {
  constructor(scene, lowDetail = false) {
    this.scene = scene;
    this.chunks = new Map();
    this.ground = makeGround(lowDetail ? 144 : 192, lowDetail);
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
    this.barn = makeBarn();
    scene.add(this.barn);
    this.barnWalls = penFences();   // every wall and fence, for collisions
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
      if (Math.abs(x - BARN.x) < PEN.halfW + PEN.wing + 12 && z > BARN.z - BARN.d - 10 && z < PEN_GATE_Z + PEN.wing + 16) continue;
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

  inBarn(x, z) { return inPen(x, z); }
  nearBarn(x, z) {
    return Math.abs(x - BARN.x) < PEN.halfW + PEN.wing + 4 && z > BARN.z - BARN.d / 2 - 4 && z < PEN_GATE_Z + PEN.wing + 4;
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
