import * as THREE from 'three';

// Renders every sheep with five instanced meshes (wool, head, ears, legs, tail)
// so 54 animated sheep cost a handful of draw calls.
export class SheepRenderer {
  constructor(scene, sheep) {
    const n = sheep.length;
    const woolGeo = new THREE.IcosahedronGeometry(1, 1);
    const headGeo = new THREE.BoxGeometry(0.5, 0.45, 0.62);
    const earGeo = new THREE.BoxGeometry(0.3, 0.09, 0.16);
    const legGeo = new THREE.BoxGeometry(0.2, 0.64, 0.2);
    legGeo.translate(0, -0.32, 0); // pivot at the hip
    const tailGeo = new THREE.SphereGeometry(0.17, 6, 5);

    const woolMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });

    const make = (geo, mat, count) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.wool = make(woolGeo, woolMat, n);
    this.head = make(headGeo, darkMat, n);
    this.ear = make(earGeo, darkMat, n * 2);
    this.leg = make(legGeo, darkMat, n * 4);
    this.tail = make(tailGeo, woolMat, n);

    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = sheep[i];
      if (s.isBlack) {
        this.wool.setColorAt(i, c.setHex(0x161616));
        this.tail.setColorAt(i, c);
        this.head.setColorAt(i, c.setHex(0x0e0e0e));
      } else {
        const g = 0.86 + s.tint * 0.14;
        this.wool.setColorAt(i, c.setRGB(g, g, g * 0.99));
        this.tail.setColorAt(i, c);
        this.head.setColorAt(i, c.setHex(0x1c1c1c));
      }
      this.ear.setColorAt(i * 2, c);
      this.ear.setColorAt(i * 2 + 1, c);
      for (let l = 0; l < 4; l++) this.leg.setColorAt(i * 4 + l, c);
    }

    this._root = new THREE.Matrix4();
    this._headM = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this._d = new THREE.Object3D();
    this._q = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scl = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  update(sheep, time) {
    const d = this._d;
    const root = this._root;
    const m = this._m;
    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];
      const speedF = Math.min(1, s.speed / 3.5);
      const bob = Math.abs(Math.sin(s.phase)) * 0.07 * speedF;
      const hd = s.headDown;
      const nibble = hd > 0.8 ? Math.sin(time * 7 + i * 1.7) * 0.06 : 0;

      this._q.setFromAxisAngle(this._up, s.heading);
      this._pos.set(s.x, 0, s.z);
      root.compose(this._pos, this._q, this._scl);

      // wool body
      d.position.set(0, 0.95 + bob, 0);
      d.rotation.set(-speedF * 0.06, 0, Math.sin(s.phase) * 0.04 * speedF);
      d.scale.set(0.85 * s.size, 0.72 * s.size, 1.15 * s.size);
      d.updateMatrix();
      this.wool.setMatrixAt(i, m.multiplyMatrices(root, d.matrix));

      // head
      d.position.set(0, 1.02 + bob - hd * 0.55, 1.2 - hd * 0.1);
      d.rotation.set(hd * 1.05 + nibble - speedF * 0.1, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this._headM.multiplyMatrices(root, d.matrix);
      this.head.setMatrixAt(i, this._headM);

      // ears hang off the head
      for (let e = 0; e < 2; e++) {
        const side = e === 0 ? -1 : 1;
        d.position.set(side * 0.34, 0.14, -0.05);
        d.rotation.set(0, 0, side * -0.55);
        d.updateMatrix();
        this.ear.setMatrixAt(i * 2 + e, m.multiplyMatrices(this._headM, d.matrix));
      }

      // legs, diagonal pairs swing together
      const amp = speedF * 0.75;
      for (let l = 0; l < 4; l++) {
        const sx = l % 2 === 0 ? -0.3 : 0.3;
        const sz = l < 2 ? 0.42 : -0.42;
        const sign = (l === 0 || l === 3) ? 1 : -1;
        d.position.set(sx, 0.74, sz);
        d.rotation.set(Math.sin(s.phase) * amp * sign, 0, 0);
        d.updateMatrix();
        this.leg.setMatrixAt(i * 4 + l, m.multiplyMatrices(root, d.matrix));
      }

      // tail
      d.position.set(0, 1.08 + bob, -1.05 * s.size);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.tail.setMatrixAt(i, m.multiplyMatrices(root, d.matrix));
    }
    this.wool.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.ear.instanceMatrix.needsUpdate = true;
    this.leg.instanceMatrix.needsUpdate = true;
    this.tail.instanceMatrix.needsUpdate = true;
  }
}
