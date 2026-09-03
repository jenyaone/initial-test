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

function buildDog() {
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

// The cursor: a white shepherd the flock follows, or a black dog it runs from.
export class Herder {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.shepherd = buildShepherd();
    this.dog = buildDog();
    this.root.add(this.shepherd.group, this.dog.group);
    this.dog.group.visible = false;
    this.shepherd.group.scale.setScalar(1.2);
    this.dog.group.scale.setScalar(1.6);
    this.mode = 'shepherd';
    this.x = 0; this.z = 0; this.y = 0;
    this._grad = { x: 0, z: 0 };
    this._up = new THREE.Vector3(0, 1, 0);
    this._normal = new THREE.Vector3(0, 1, 0);
    this._qSlope = new THREE.Quaternion();
    this._qHead = new THREE.Quaternion();
    this.heading = 0;
    this.phase = 0;
    this.speed = 0;
    this.pop = 1;

    this.light = new THREE.PointLight(0xfff4e0, 9, 22, 1.4);
    this.light.position.set(0, 4.5, 0);
    this.root.add(this.light);

    // faint ring on the ground so the cursor reads even when the dog is in shadow
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.7, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.root.add(this.ring);
  }

  toggle() {
    this.setMode(this.mode === 'shepherd' ? 'dog' : 'shepherd');
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.shepherd.group.visible = mode === 'shepherd';
    this.dog.group.visible = mode === 'dog';
    this.light.color.setHex(mode === 'dog' ? 0xd8e4ff : 0xfff4e0);
    this.pop = 0;
  }

  update(dt, target, time) {
    // walk toward the pointer at a capped pace so the flock can keep up
    const maxSpeed = this.mode === 'dog' ? 10.5 : 6.8;
    const dx = target.x - this.x, dz = target.z - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz) + 1e-6;
    const sp = Math.min(maxSpeed, dist * 8);
    const vx = (dx / dist) * sp, vz = (dz / dist) * sp;
    this.x += vx * dt; this.z += vz * dt;
    this.speed += (sp - this.speed) * damp(10, dt);
    if (sp > 0.8) this.heading = angleLerp(this.heading, Math.atan2(vx, vz), damp(12, dt));
    this.ring.material.opacity = 0.16 + 0.16 * Math.min(1, this.speed / 4);
    this.phase += Math.min(this.speed, 14) * dt * 2.2;

    this.pop = Math.min(1, this.pop + dt * 3.5);
    const e = 1 - Math.pow(1 - this.pop, 3);
    const scale = 0.5 + 0.5 * e;

    // stand on the ground, leaning with the slope like the sheep do
    const g = gradient(this.x, this.z, this._grad);
    this.y = terrainHeight(this.x, this.z);
    this._normal.set(-g.x, 1, -g.z).normalize();
    this._qSlope.setFromUnitVectors(this._up, this._normal);
    this._qHead.setFromAxisAngle(this._up, this.heading).premultiply(this._qSlope);
    this.root.position.set(this.x, this.y, this.z);
    this.root.quaternion.copy(this._qHead);
    this.root.scale.setScalar(scale);

    const model = this.mode === 'dog' ? this.dog : this.shepherd;
    const amp = Math.min(1, this.speed / 5) * (this.mode === 'dog' ? 0.8 : 0.55);
    model.legs.forEach((leg, i) => {
      const sign = model.legs.length === 4 ? ((i === 0 || i === 3) ? 1 : -1) : (i === 0 ? 1 : -1);
      leg.rotation.x = Math.sin(this.phase) * amp * sign;
    });
    if (model.tail) model.tail.rotation.z = Math.sin(time * 9) * 0.35 * (0.3 + amp);
    model.group.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * amp;
  }
}
