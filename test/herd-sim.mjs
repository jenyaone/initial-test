// Headless: can a player standing behind the flock, with the dog sent, get all
// 54 sheep into the barn? Runs the real World, Flock and Dog with no renderer.
import * as THREE from 'three';
import { World } from '../src/world.js';
import { Flock } from '../src/flock.js';
import { Dog, drivePoint } from '../src/dog.js';
import { BARN } from '../src/terrain.js';

const scene = new THREE.Scene();
const world = new World(scene, false);
const flock = new Flock(54, world, 0);
const dog = new Dog(scene);
const shepherd = { x: 0, z: 16, kind: 'shepherd', active: true };
dog.send();
const dt = 1 / 60;
const tmp = {};
let t = 0, firstPen = null, allPen = null, maxPenned = 0, escaped = 0, maxLost = 0;
for (let i = 0; i < 60 * 300; i++) {
  // the player walks to a spot behind the flock, a little to the side of the dog
  const dp = drivePoint(flock, tmp);
  if (dp) {
    const tx = dp.px + 7, tz = dp.pz + 3;
    const dx = tx - shepherd.x, dz = tz - shepherd.z, d = Math.hypot(dx, dz) + 1e-6;
    const sp = Math.min(6.8, d * 8);
    shepherd.x += (dx / d) * sp * dt; shepherd.z += (dz / d) * sp * dt;
  }
  dog.update(dt, shepherd, flock, world, t);
  flock.step(dt, [shepherd, dog], t);
  t += dt;
  if (flock.penned > 0 && firstPen === null) firstPen = t;
  if (flock.penned === 54 && allPen === null) { allPen = t; break; }
  if (flock.penned < maxPenned) escaped++;
  maxPenned = Math.max(maxPenned, flock.penned);
  maxLost = Math.max(maxLost, flock.lost);
  if (i % (60 * 30) === 0) {
    const c = flock.freeCentroid({});
    console.log(`t=${t.toFixed(0).padStart(3)}s penned=${String(flock.penned).padStart(2)} lost=${flock.lost} free centroid z=${c.n ? c.z.toFixed(0) : '-'} r=${c.n ? c.r.toFixed(0) : '-'} dog=(${dog.x.toFixed(0)},${dog.z.toFixed(0)})`);
  }
}
console.log(`first sheep penned at ${firstPen?.toFixed(0) ?? 'never'}s, all 54 at ${allPen?.toFixed(0) ?? 'never'}s, max penned ${maxPenned}, penned-count drops ${escaped}, max lost ${maxLost}`);
let outside = 0; for (const s of flock.sheep) if (s.penned && !world.inBarn(s.x, s.z)) outside++;
console.log(`penned sheep found outside the barn: ${outside}`);
