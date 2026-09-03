import { damp, angleLerp, mulberry32 } from './util.js';

// Boids in the XZ plane: separation, alignment, cohesion, plus a herder that
// either attracts (shepherd) or repels (dog), rock avoidance and idle wandering.
const SEP_R = 2.4, SEP_R2 = SEP_R * SEP_R;
const ALI_R = 6, ALI_R2 = ALI_R * ALI_R;
const COH_R = 10, COH_R2 = COH_R * COH_R;
const CONTACT = 1.55;             // hard body-to-body distance
const FOLLOW_R = 70;              // shepherd's voice carries this far
const COMFORT = 3.2;              // sheep keep this distance from the shepherd
const FLEE_R = 24;                // the dog scares sheep within this distance
const ROCK_MARGIN = 3.2;

export class Flock {
  constructor(count, world, blackIndex = 0) {
    this.world = world;
    this.sheep = [];
    const rng = mulberry32(7);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 5 + Math.sqrt(rng()) * 9;
      this.sheep.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        vx: 0, vz: 0, fx: 0, fz: 0,
        ax: 0, az: 0, nA: 0, cx: 0, cz: 0, nC: 0,
        heading: rng() * Math.PI * 2,
        phase: rng() * Math.PI * 2,
        speed: 0, fear: 0, headDown: 0, idleTime: rng() * 3,
        wanderT: rng() * 3, wanderDir: rng() * Math.PI * 2, wanderOn: 0,
        agility: 0.9 + rng() * 0.2,
        size: 0.94 + rng() * 0.12,
        tint: rng(),
        isBlack: i === blackIndex,
      });
    }
    this._rng = rng;
  }

  step(dt, herder, time) {
    const S = this.sheep;
    const n = S.length;
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
        a.cx += b.x; a.cz += b.z; a.nC++;
        b.cx += a.x; b.cz += a.z; b.nC++;
        if (d2 < ALI_R2) {
          a.ax += b.vx; a.az += b.vz; a.nA++;
          b.ax += a.vx; b.az += a.vz; b.nA++;
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

    const hx = herder.x, hz = herder.z;
    const dogMode = herder.mode === 'dog';

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
        fx += (s.cx * inv - s.x) * 0.35;
        fz += (s.cz * inv - s.z) * 0.35;
      }

      // the herder
      const dx = hx - s.x, dz = hz - s.z;
      const d = Math.sqrt(dx * dx + dz * dz) + 1e-4;
      if (dogMode) {
        if (d < FLEE_R) {
          const t = 1 - d / FLEE_R;
          fearTarget = t;
          const want = 12.5 * s.agility;
          fx += ((-dx / d) * want - s.vx) * (1.2 + 3.5 * t);
          fz += ((-dz / d) * want - s.vz) * (1.2 + 3.5 * t);
        }
      } else if (d < FOLLOW_R) {
        const want = d > COMFORT ? Math.min(7.5 * s.agility, (d - COMFORT) * 0.9) : 0;
        const w = d > 30 ? 0.9 : 1.6;
        fx += ((dx / d) * want - s.vx) * w;
        fz += ((dz / d) * want - s.vz) * w;
        if (d < COMFORT * 0.75) {
          const p = (COMFORT * 0.75 - d) * 8;
          fx -= (dx / d) * p; fz -= (dz / d) * p;
        }
      }
      s.fear += (fearTarget - s.fear) * damp(fearTarget > s.fear ? 12 : 1.4, dt);

      // rocks: steer around the ones ahead, never overlap them
      const lx = s.x + s.vx * 0.55, lz = s.z + s.vz * 0.55;
      this.world.forEachRockNear(s.x, s.z, (r) => {
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

      // integrate
      const maxAcc = 30 + s.fear * 50;
      const fm = Math.sqrt(fx * fx + fz * fz);
      if (fm > maxAcc) { fx *= maxAcc / fm; fz *= maxAcc / fm; }
      s.vx += fx * dt;
      s.vz += fz * dt;
      const drag = 1 - Math.min(1, dt * 1.6);
      s.vx *= drag; s.vz *= drag;
      const maxSpeed = (7.5 + s.fear * 5) * s.agility;
      let sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      if (sp > maxSpeed) { s.vx *= maxSpeed / sp; s.vz *= maxSpeed / sp; sp = maxSpeed; }
      if (sp < 0.12) { s.vx = s.vz = 0; sp = 0; }
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.speed = sp;

      // pose
      if (sp > 0.3) s.heading = angleLerp(s.heading, Math.atan2(s.vx, s.vz), damp(9, dt));
      s.phase += sp * dt * 2.6;
      if (sp < 0.35) s.idleTime += dt; else s.idleTime = 0;
      const wantDown = s.idleTime > 1 + (i % 5) * 0.4 && s.fear < 0.2 ? 1 : 0;
      s.headDown += (wantDown - s.headDown) * damp(wantDown ? 3 : 8, dt);
    }
  }
}
