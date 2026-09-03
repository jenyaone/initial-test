import { damp, angleLerp, mulberry32, clamp } from './util.js';
import { height as terrainHeight, gradient, BARN } from './terrain.js';

// Boids in the XZ plane: separation, alignment, cohesion, plus herders that
// push the flock ahead of them, rock and wall avoidance, and idle wandering.
const SEP_R = 2.4, SEP_R2 = SEP_R * SEP_R;
const ALI_R = 6, ALI_R2 = ALI_R * ALI_R;
const COH_R = 20, COH_R2 = COH_R * COH_R;
const CONTACT = 1.55;             // hard body-to-body distance
const ROCK_MARGIN = 3.2;
const WALL_R = 1.1;               // sheep body vs barn wall
const WALL_MARGIN = 2.5;
export const LOST_R = 110;        // a sheep this far from the shepherd is lost
// How hard the hills push back: a steady downhill pull, and a speed cap that
// falls when climbing and rises when descending.
const SLOPE_DRAG = 5.0;
const SLOPE_PULL = 8.0;

// How each herder moves the sheep. The dog is faster and frightening; the
// shepherd is a slower, calmer push that carries less far.
const PUSH = {
  shepherd: { r: 17, want: 6.5, weight: 0.8, panic: 0.3 },
  dog:      { r: 24, want: 9.0, weight: 1.2, panic: 0.7 },
};

export class Flock {
  constructor(count, world, blackIndex = 0) {
    this.world = world;
    this.sheep = [];
    this.penned = 0;
    this.lost = 0;
    this.newlyPenned = 0;
    this._seed = 7;
    for (let i = 0; i < count; i++) {
      this.sheep.push({
        x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 0,
        ax: 0, az: 0, nA: 0, cx: 0, cz: 0, nC: 0,
        y: 0, gx: 0, gz: 0, slope: 0,
        heading: 0, phase: 0,
        speed: 0, fear: 0, headDown: 0, idleTime: 0,
        wanderT: 0, wanderDir: 0, wanderOn: 0,
        agility: 1, size: 1, tint: 0,
        penned: false,
        isBlack: i === blackIndex,
      });
    }
    this._grad = { x: 0, z: 0 };
    this.reset();
  }

  // Scatter the flock around the start again.
  reset() {
    const rng = mulberry32(this._seed);
    this._rng = rng;
    for (const s of this.sheep) {
      const a = rng() * Math.PI * 2;
      const r = 5 + Math.sqrt(rng()) * 9;
      s.x = Math.cos(a) * r; s.z = Math.sin(a) * r;
      s.vx = s.vz = 0;
      s.heading = rng() * Math.PI * 2;
      s.phase = rng() * Math.PI * 2;
      s.fear = 0; s.headDown = 0; s.idleTime = rng() * 3; s.slope = 0;
      s.wanderT = rng() * 3; s.wanderDir = rng() * Math.PI * 2; s.wanderOn = 0;
      s.agility = 0.9 + rng() * 0.2;
      s.size = 0.94 + rng() * 0.12;
      s.tint = rng();
      s.penned = false;
      s.y = terrainHeight(s.x, s.z);
    }
    this.penned = 0;
    this.lost = 0;
    this.newlyPenned = 0;
  }

  // pushers: [{x, z, kind: 'shepherd' | 'dog', active}]
  step(dt, pushers, time) {
    const S = this.sheep;
    const n = S.length;
    const world = this.world;
    this.newlyPenned = 0;
    for (let i = 0; i < n; i++) {
      const s = S[i];
      s.fx = s.fz = s.ax = s.az = s.cx = s.cz = 0;
      s.nA = s.nC = 0;
    }

    // pairwise flocking terms
    for (let i = 0; i < n; i++) {
      const a = S[i];
      for (let j = i + 1; j < n; j++) {
        const b = S[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > COH_R2) continue;
        // penned and free sheep do not pull on each other through the walls
        if (a.penned === b.penned) {
          a.cx += b.x; a.cz += b.z; a.nC++;
          b.cx += a.x; b.cz += a.z; b.nC++;
          if (d2 < ALI_R2) {
            a.ax += b.vx; a.az += b.vz; a.nA++;
            b.ax += a.vx; b.az += a.vz; b.nA++;
          }
        }
        if (d2 < SEP_R2) {
          const d = Math.sqrt(d2) + 1e-4;
          const f = (SEP_R - d) / SEP_R;
          const px = (dx / d) * f * 9, pz = (dz / d) * f * 9;
          a.fx -= px; a.fz -= pz;
          b.fx += px; b.fz += pz;
          if (d < CONTACT) {
            const push = (CONTACT - d) * 0.5;
            a.x -= (dx / d) * push; a.z -= (dz / d) * push;
            b.x += (dx / d) * push; b.z += (dz / d) * push;
          }
        }
      }
    }

    let penned = 0, lost = 0;
    const shepherd = pushers[0];

    for (let i = 0; i < n; i++) {
      const s = S[i];
      let fx = s.fx, fz = s.fz;
      let fearTarget = 0;

      if (s.nA > 0) {
        const inv = 1 / s.nA;
        fx += (s.ax * inv - s.vx) * 0.9;
        fz += (s.az * inv - s.vz) * 0.9;
      }
      if (s.nC > 0) {
        const inv = 1 / s.nC;
        fx += (s.cx * inv - s.x) * 1.0;
        fz += (s.cz * inv - s.z) * 1.0;
      }

      if (s.penned) {
        // home: mill about inside, drifting back toward the middle
        fx += (BARN.x - s.x) * 0.25;
        fz += (BARN.z - s.z) * 0.25;
      } else {
        // the herders push: sheep move away from whoever is close
        for (let k = 0; k < pushers.length; k++) {
          const p = pushers[k];
          if (!p.active) continue;
          const cfg = PUSH[p.kind];
          const dx = p.x - s.x, dz = p.z - s.z;
          const d = Math.sqrt(dx * dx + dz * dz) + 1e-4;
          if (d >= cfg.r) continue;
          const t = 1 - d / cfg.r;
          fearTarget = Math.max(fearTarget, t * cfg.panic);
          const want = cfg.want * s.agility;
          const w = cfg.weight * (1 + 3 * t);
          fx += ((-dx / d) * want - s.vx) * w;
          fz += ((-dz / d) * want - s.vz) * w;
        }
      }
      s.fear += (fearTarget - s.fear) * damp(fearTarget > s.fear ? 12 : 1.4, dt);

      // rocks: steer around the ones ahead, never overlap them
      const lx = s.x + s.vx * 0.55, lz = s.z + s.vz * 0.55;
      world.forEachRockNear(s.x, s.z, (r) => {
        const rx = lx - r.x, rz = lz - r.z;
        const rd = Math.sqrt(rx * rx + rz * rz) + 1e-4;
        const margin = r.r + ROCK_MARGIN;
        if (rd < margin) {
          const t = (margin - rd) / ROCK_MARGIN;
          fx += (rx / rd) * t * t * 40;
          fz += (rz / rd) * t * t * 40;
        }
        const ax = s.x - r.x, az = s.z - r.z;
        const ad = Math.sqrt(ax * ax + az * az) + 1e-4;
        const hard = r.r + 0.6;
        if (ad < hard) {
          s.x = r.x + (ax / ad) * hard;
          s.z = r.z + (az / ad) * hard;
          const vn = (s.vx * ax + s.vz * az) / ad;
          if (vn < 0) { s.vx -= (ax / ad) * vn; s.vz -= (az / ad) * vn; }
        }
      });

      // barn walls: solid, with a soft shove away when heading into one
      if (world.nearBarn(s.x, s.z)) {
        const walls = world.barnWalls;
        for (let k = 0; k < walls.length; k++) {
          const [x1, z1, x2, z2] = walls[k];
          const ex = x2 - x1, ez = z2 - z1;
          const len2 = ex * ex + ez * ez;
          // soft: look ahead
          let t = clamp(((lx - x1) * ex + (lz - z1) * ez) / len2, 0, 1);
          let qx = lx - (x1 + ex * t), qz = lz - (z1 + ez * t);
          let qd = Math.sqrt(qx * qx + qz * qz) + 1e-4;
          if (qd < WALL_R + WALL_MARGIN) {
            const u = (WALL_R + WALL_MARGIN - qd) / WALL_MARGIN;
            fx += (qx / qd) * u * u * 35;
            fz += (qz / qd) * u * u * 35;
          }
          // hard: push out
          t = clamp(((s.x - x1) * ex + (s.z - z1) * ez) / len2, 0, 1);
          qx = s.x - (x1 + ex * t); qz = s.z - (z1 + ez * t);
          qd = Math.sqrt(qx * qx + qz * qz) + 1e-4;
          if (qd < WALL_R) {
            s.x += (qx / qd) * (WALL_R - qd);
            s.z += (qz / qd) * (WALL_R - qd);
            const vn = (s.vx * qx + s.vz * qz) / qd;
            if (vn < 0) { s.vx -= (qx / qd) * vn; s.vz -= (qz / qd) * vn; }
          }
        }
      }

      // idle wandering so the flock never freezes
      s.wanderT -= dt;
      if (s.wanderT < 0) {
        s.wanderT = 2 + this._rng() * 5;
        s.wanderDir = this._rng() * Math.PI * 2;
        s.wanderOn = this._rng() < 0.45 ? 1 : 0;
      }
      if (s.wanderOn && s.fear < 0.1) {
        fx += Math.cos(s.wanderDir) * 1.6;
        fz += Math.sin(s.wanderDir) * 1.6;
      }

      // hills: a steady downhill pull, and a speed cap that depends on whether
      // this sheep is climbing or descending
      const g = gradient(s.x, s.z, this._grad);
      s.gx = g.x; s.gz = g.z;
      fx -= g.x * SLOPE_PULL;
      fz -= g.z * SLOPE_PULL;
      const sp0 = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      const climb = sp0 > 0.05 ? (g.x * s.vx + g.z * s.vz) / sp0 : 0; // + uphill
      s.slope += (climb - s.slope) * damp(6, dt);

      // integrate
      const maxAcc = 30 + s.fear * 50;
      const fm = Math.sqrt(fx * fx + fz * fz);
      if (fm > maxAcc) { fx *= maxAcc / fm; fz *= maxAcc / fm; }
      s.vx += fx * dt;
      s.vz += fz * dt;
      const drag = 1 - Math.min(1, dt * 1.6);
      s.vx *= drag; s.vz *= drag;
      const base = s.penned ? 3.5 : 7.5 + s.fear * 5;
      const maxSpeed = base * s.agility * clamp(1 - s.slope * SLOPE_DRAG, 0.4, 1.6);
      let sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      if (sp > maxSpeed) { s.vx *= maxSpeed / sp; s.vz *= maxSpeed / sp; sp = maxSpeed; }
      // Snap only true drift to a stop. A larger threshold traps a sheep that
      // is starting from rest: its first frame of acceleration lands below the
      // cutoff and gets zeroed again every frame, so it never sets off at all.
      if (sp < 0.04) { s.vx = s.vz = 0; sp = 0; }
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.y = terrainHeight(s.x, s.z);
      s.speed = sp;

      // in the barn?
      if (!s.penned && world.inBarn(s.x, s.z)) { s.penned = true; this.newlyPenned++; s.fear = 0; }
      if (s.penned) penned++;
      else if (shepherd && Math.hypot(s.x - shepherd.x, s.z - shepherd.z) > LOST_R) lost++;

      // pose
      if (sp > 0.3) s.heading = angleLerp(s.heading, Math.atan2(s.vx, s.vz), damp(9, dt));
      s.phase += sp * dt * 2.6;
      if (sp < 0.35) s.idleTime += dt; else s.idleTime = 0;
      const wantDown = s.idleTime > 1 + (i % 5) * 0.4 && s.fear < 0.2 ? 1 : 0;
      s.headDown += (wantDown - s.headDown) * damp(wantDown ? 3 : 8, dt);
    }
    this.penned = penned;
    this.lost = lost;
  }

  // Centre and radius of the sheep still out in the field.
  freeCentroid(out) {
    let cx = 0, cz = 0, n = 0;
    for (const s of this.sheep) if (!s.penned) { cx += s.x; cz += s.z; n++; }
    if (n === 0) { out.n = 0; return out; }
    cx /= n; cz /= n;
    let r = 0;
    for (const s of this.sheep) if (!s.penned) r = Math.max(r, Math.hypot(s.x - cx, s.z - cz));
    out.x = cx; out.z = cz; out.r = r; out.n = n;
    return out;
  }
}
