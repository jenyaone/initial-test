import * as THREE from 'three';
import { damp, angleLerp } from './util.js';
import { height as terrainHeight, gradient } from './terrain.js';

const box = (w, h, d, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};
const pivotBox = (w, h, d, mat, x, y, z) => {
  // pivot at the top so the limb can swing from its joint
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

function buildShepherd() {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xfaf6ec, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xe6e0d0, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.35, 10), cloth);
  body.position.y = 1.15; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 2.05; head.castShadow = true; g.add(head);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.06, 14), cloth);
  brim.position.y = 2.24; brim.castShadow = true; g.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.32, 0.3, 12), cloth);
  crown.position.y = 2.4; crown.castShadow = true; g.add(crown);

  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.7, 6), wood);
  staff.position.set(0.62, 1.35, 0.1); staff.castShadow = true; g.add(staff);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 6, 14, Math.PI * 1.35), wood);
  hook.position.set(0.62 - 0.17, 2.7, 0.1);
  hook.rotation.z = -Math.PI * 0.05; hook.castShadow = true; g.add(hook);
  const arm = box(0.16, 0.16, 0.5, cloth, 0.42, 1.5, 0.05);
  arm.rotation.y = Math.PI / 2; g.add(arm);

  const legs = [pivotBox(0.18, 0.55, 0.18, cloth, -0.16, 0.55, 0), pivotBox(0.18, 0.55, 0.18, cloth, 0.16, 0.55, 0)];
  legs.forEach((l) => g.add(l));
  return { group: g, legs, tail: null };
}

export function buildDog() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });

  g.add(box(0.5, 0.46, 1.1, fur, 0, 0.75, 0));
  g.add(box(0.42, 0.4, 0.42, fur, 0, 1.08, 0.7));
  g.add(box(0.24, 0.2, 0.3, fur, 0, 0.98, 1.02));
  const earL = box(0.12, 0.24, 0.08, fur, -0.17, 1.34, 0.6); earL.rotation.z = 0.25; g.add(earL);
  const earR = box(0.12, 0.24, 0.08, fur, 0.17, 1.34, 0.6); earR.rotation.z = -0.25; g.add(earR);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.05, 6, 14), white);
  collar.position.set(0, 0.98, 0.45); collar.rotation.x = Math.PI / 2; g.add(collar);
  const eyeGeo = new THREE.SphereGeometry(0.045, 6, 6);
  [-0.11, 0.11].forEach((x) => { const e = new THREE.Mesh(eyeGeo, white); e.position.set(x, 1.15, 0.92); g.add(e); });
  const tail = pivotBox(0.09, 0.55, 0.09, fur, 0, 0.9, -0.6);
  tail.rotation.x = -2.4; g.add(tail);

  const legs = [];
  for (const sx of [-0.18, 0.18]) for (const sz of [0.38, -0.38]) legs.push(pivotBox(0.14, 0.52, 0.14, fur, sx, 0.55, sz));
  legs.forEach((l) => g.add(l));
  return { group: g, legs, tail };
}

// Move from (x, z) toward (nx, nz) treating rocks as solid: slide along one met
// at an angle, sidestep one hit head-on. Returns the corrected point.
export function slideAlongRocks(world, x, z, nx, nz, vx, vz, sp, R, dt, out) {
  out.x = nx; out.z = nz;
  if (!world || sp <= 0) return out;
  world.forEachRockNear(out.x, out.z, (r) => {
    const dx = out.x - r.x, dz = out.z - r.z;
    const d = Math.sqrt(dx * dx + dz * dz) + 1e-6;
    const keep = r.r + R;
    if (d >= keep) return;
    const ox = dx / d, oz = dz / d;
    out.x = r.x + ox * keep; out.z = r.z + oz * keep;
    const into = -(vx * ox + vz * oz) / (sp + 1e-6);
    if (into > 0.85) {
      const wx = x + vx - r.x, wz = z + vz - r.z;
      const side = (ox * wz - oz * wx) >= 0 ? 1 : -1;
      out.x += -oz * side * sp * dt * 0.9;
      out.z += ox * side * sp * dt * 0.9;
    }
  });
  return out;
}

// Places a root group on the terrain, leaning with the slope.
export function standOnGround(root, x, z, heading, scale, tmp) {
  const g = gradient(x, z, tmp.grad);
  const y = terrainHeight(x, z);
  tmp.normal.set(-g.x, 1, -g.z).normalize();
  tmp.qSlope.setFromUnitVectors(tmp.up, tmp.normal);
  tmp.q.setFromAxisAngle(tmp.up, heading).premultiply(tmp.qSlope);
  root.position.set(x, y, z);
  root.quaternion.copy(tmp.q);
  root.scale.setScalar(scale);
  return y;
}
export const groundTmp = () => ({
  grad: { x: 0, z: 0 }, up: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 1, 0),
  qSlope: new THREE.Quaternion(), q: new THREE.Quaternion(),
});

// The cursor: a white shepherd. Sheep move away from it, so you walk behind
// the flock to push it where you want.
export class Herder {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.shepherd = buildShepherd();
    this.root.add(this.shepherd.group);
    this.shepherd.group.scale.setScalar(1.2);
    this.kind = 'shepherd';
    this.active = true;
    this.x = 0; this.z = 0; this.y = 0;
    this._tmp = groundTmp();
    this.heading = 0;
    this.phase = 0;
    this.speed = 0;
    this.radius = 0.9;      // body radius for rock collisions
    this.drive = null;      // {x, z} in -1..1: a stick-style push, e.g. from phone tilt
    this._tgt = { x: 0, z: 0 };
    this._out = { x: 0, z: 0 };

    this.light = new THREE.PointLight(0xfff4e0, 9, 22, 1.4);
    this.light.position.set(0, 4.5, 0);
    this.root.add(this.light);

    // faint ring on the ground so the cursor reads on the dark map
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.7, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.root.add(this.ring);
  }

  maxSpeed() { return 6.8; }

  placeAt(x, z) { this.x = x; this.z = z; this.speed = 0; }

  // Nudge a point out of any rock it sits inside, so a tap on a rock becomes
  // a walk to its edge rather than an endless shove against it.
  clearOfRocks(pt, world) {
    if (!world) return pt;
    const R = this.radius + 0.2;
    world.forEachRockNear(pt.x, pt.z, (r) => {
      const dx = pt.x - r.x, dz = pt.z - r.z;
      const d = Math.sqrt(dx * dx + dz * dz) + 1e-6;
      const keep = r.r + R;
      if (d < keep) { pt.x = r.x + (dx / d) * keep; pt.z = r.z + (dz / d) * keep; }
    });
    return pt;
  }

  update(dt, target, time, world) {
    const maxSpeed = this.maxSpeed();
    let vx, vz, sp;
    const mag = this.drive ? Math.hypot(this.drive.x, this.drive.z) : 0;
    if (mag > 0.001) {
      // stick input: further over means faster, up to the walking cap
      const m = Math.min(1, mag);
      sp = maxSpeed * Math.pow(m, 1.4);
      vx = (this.drive.x / mag) * sp;
      vz = (this.drive.z / mag) * sp;
    } else {
      // walk toward the pointer at a capped pace so the flock can keep up
      const t = this._tgt;
      t.x = target.x; t.z = target.z;
      this.clearOfRocks(t, world);
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.sqrt(dx * dx + dz * dz) + 1e-6;
      sp = Math.min(maxSpeed, dist * 8);
      vx = (dx / dist) * sp;
      vz = (dz / dist) * sp;
    }
    const o = slideAlongRocks(world, this.x, this.z, this.x + vx * dt, this.z + vz * dt, vx, vz, sp, this.radius, dt, this._out);
    const movedX = (o.x - this.x) / dt, movedZ = (o.z - this.z) / dt;
    this.x = o.x; this.z = o.z;
    sp = Math.min(sp, Math.hypot(movedX, movedZ));
    vx = movedX; vz = movedZ;
    this.speed += (sp - this.speed) * damp(10, dt);
    if (sp > 0.8) this.heading = angleLerp(this.heading, Math.atan2(vx, vz), damp(12, dt));
    this.ring.material.opacity = 0.16 + 0.16 * Math.min(1, this.speed / 4);
    this.phase += Math.min(this.speed, 14) * dt * 2.2;

    this.y = standOnGround(this.root, this.x, this.z, this.heading, 1, this._tmp);

    const model = this.shepherd;
    const amp = Math.min(1, this.speed / 5) * 0.55;
    model.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(this.phase) * amp * (i === 0 ? 1 : -1); });
    model.group.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * amp;
  }
}
