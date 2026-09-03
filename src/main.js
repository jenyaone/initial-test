import * as THREE from 'three';
import { World } from './world.js';
import { Flock } from './flock.js';
import { SheepRenderer } from './sheep.js';
import { Herder } from './herder.js';
import { damp } from './util.js';

const SHEEP_COUNT = 54; // 53 white, 1 black
const CAMERA_OFFSET = new THREE.Vector3(0, 36, 21);
const BG = 0x060607;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 75, 150);

const camera = new THREE.PerspectiveCamera(48, 1, 1, 400);

const hemi = new THREE.HemisphereLight(0xb8c2d6, 0x08080a, 0.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 220;
sun.shadow.camera.left = sun.shadow.camera.bottom = -55;
sun.shadow.camera.right = sun.shadow.camera.top = 55;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(28, 60, 18);

const world = new World(scene);
const flock = new Flock(SHEEP_COUNT, world, 0);
const sheepRenderer = new SheepRenderer(scene, flock.sheep);
const herder = new Herder(scene);
window.__sim = { flock, world, herder }; // handy for poking at the simulation from the console

// pointer -> ground
const pointerNdc = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerWorld = new THREE.Vector3(0, 0, 0);
const focus = new THREE.Vector3(0, 0, 0);
let hasPointer = false;

function updatePointerWorld() {
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) pointerWorld.copy(hit);
}

let downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointermove', (e) => {
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  hasPointer = true;
});
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX; downY = e.clientY; downT = performance.now();
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  hasPointer = true;
});
canvas.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (moved < 8 && performance.now() - downT < 500) toggleMode();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === 'd' || e.key === 's') { e.preventDefault(); toggleMode(); }
});

const modeName = document.getElementById('modeName');
const modeDesc = document.getElementById('modeDesc');
const switchBtn = document.getElementById('switch');
switchBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMode(); });
function toggleMode() {
  herder.toggle();
  const dog = herder.mode === 'dog';
  modeName.textContent = dog ? 'Dog' : 'Shepherd';
  modeDesc.textContent = dog ? 'the flock scatters' : 'the flock follows';
  switchBtn.textContent = dog ? 'Call the shepherd' : 'Send the dog';
  document.body.classList.toggle('dog', dog);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

camera.position.copy(CAMERA_OFFSET);
camera.lookAt(focus);

let last = performance.now();
let time = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;

  if (hasPointer) updatePointerWorld();
  herder.update(dt, pointerWorld, time);

  // the camera trails the cursor
  focus.x += (herder.x - focus.x) * damp(1.8, dt);
  focus.z += (herder.z - focus.z) * damp(1.8, dt);
  camera.position.copy(focus).add(CAMERA_OFFSET);
  camera.lookAt(focus);
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);

  world.update(focus);
  flock.step(dt, herder, time);
  sheepRenderer.update(flock.sheep, time);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
