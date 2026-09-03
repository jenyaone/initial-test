import * as THREE from 'three';
import { damp, angleLerp } from './util.js';
import { BARN, PEN_MOUTH_Z, PEN_GATE_Z } from './terrain.js';
import { buildDog, slideAlongRocks, standOnGround, groundTmp } from './herder.js';

const RUN = 10.5;          // top speed
const STANDOFF = 6;        // how far behind the flock's edge the dog works from

// Where the dog should be to drive the free sheep toward the barn door: on the
// far side of the flock from the door, just outside its edge. Pure, so it can
// be tested without a scene.
export function drivePoint(flock, out) {
  const c = flock.freeCentroid(out);
  if (c.n === 0) return null;
  const mouthX = BARN.x, mouthZ = PEN_MOUTH_Z + 6;
  const r = Math.min(c.r, 26) + STANDOFF;
  const toMouth = Math.hypot(c.x - mouthX, c.z - mouthZ);
  let ax, az;
  if (toMouth < 16 || (c.z < mouthZ && Math.abs(c.x - mouthX) < 14)) {
    // at the mouth: push straight in from behind, leaning toward the side
    // the flock has drifted to so the shove also centres it
    ax = (c.x - mouthX) * 0.06;
    az = 1;
  } else {
    // gather: drive the flock toward the mouth
    ax = c.x - mouthX; az = c.z - mouthZ;
  }
  const al = Math.hypot(ax, az) + 1e-6;
  ax /= al; az /= al;
  out.px = c.x + ax * r;
  out.pz = Math.max(c.z + az * r, PEN_GATE_Z + 3);   // the dog stays outside the yard
  out.cx = c.x; out.cz = c.z; out.r = c.r;
  return out;
}

// The dog: at heel beside the shepherd, or sent to work, when it runs round
// the flock and pushes it toward the barn on its own.
export class Dog {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.model = buildDog();
    this.model.group.scale.setScalar(1.6);
    this.root.add(this.model.group);
    this.kind = 'dog';
    this.working = false;
    this.x = -3; this.z = 3; this.y = 0;
    this.heading = 0; this.phase = 0; this.speed = 0;
    this.radius = 0.8;
    this._tmp = groundTmp();
    this._out = { x: 0, z: 0 };
    this._dp = { x: 0, z: 0, r: 0, n: 0, px: 0, pz: 0, cx: 0, cz: 0 };
    this.barkT = 1;
    this.barked = false;   // set for one frame when the dog barks
  }

  get active() { return this.working; }
  send() { this.working = true; this.barkT = 0.1; }
  recall() { this.working = false; }
  toggle() { this.working ? this.recall() : this.send(); }
  placeAt(x, z) { this.x = x; this.z = z; this.speed = 0; }

  update(dt, shepherd, flock, world, time) {
    let tx, tz, cap = RUN;
    this.barked = false;
    const dp = this.working ? drivePoint(flock, this._dp) : null;
    if (dp) {
      tx = dp.px; tz = dp.pz;
      // never cut through the flock on the way round: stay outside its edge
      const dx = this.x - dp.cx, dz = this.z - dp.cz;
      const d = Math.hypot(dx, dz) + 1e-6;
      const keep = Math.min(dp.r, 28) + 3;
      if (d < keep) {
        tx += (dx / d) * (keep - d) * 3;
        tz += (dz / d) * (keep - d) * 3;
      }
      this.barkT -= dt;
      if (this.barkT < 0) { this.barked = true; this.barkT = 4 + Math.random() * 6; }
    } else {
      // heel: a pace behind and beside the shepherd
      tx = shepherd.x - 2.6; tz = shepherd.z + 2.0;
      cap = RUN;
      if (this.working) this.working = false;   // nothing left to work
    }
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz) + 1e-6;
    let sp = Math.min(cap, dist * 6);
    if (dist < 0.4) sp = 0;
    const vx = (dx / dist) * sp, vz = (dz / dist) * sp;
    const o = slideAlongRocks(world, this.x, this.z, this.x + vx * dt, this.z + vz * dt, vx, vz, sp, this.radius, dt, this._out);
    const mx = (o.x - this.x) / dt, mz = (o.z - this.z) / dt;
    this.x = o.x; this.z = o.z;
    sp = Math.min(sp, Math.hypot(mx, mz));
    this.speed += (sp - this.speed) * damp(10, dt);
    if (sp > 0.8) this.heading = angleLerp(this.heading, Math.atan2(mx, mz), damp(10, dt));
    else if (dp) this.heading = angleLerp(this.heading, Math.atan2(dp.cx - this.x, dp.cz - this.z), damp(4, dt));
    this.phase += Math.min(this.speed, 14) * dt * 2.2;

    this.y = standOnGround(this.root, this.x, this.z, this.heading, 1, this._tmp);
    const amp = Math.min(1, this.speed / 5) * 0.8;
    this.model.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(this.phase) * amp * ((i === 0 || i === 3) ? 1 : -1); });
    this.model.tail.rotation.z = Math.sin(time * 9) * 0.35 * (0.3 + amp);
    this.model.group.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * amp;
  }
}
