import * as THREE from 'three';
import { World } from './world.js';
import { Flock } from './flock.js';
import { SheepRenderer } from './sheep.js';
import { Herder } from './herder.js';
import { damp, clamp } from './util.js';
import { height as terrainHeight } from './terrain.js';

const SHEEP_COUNT = 54; // 53 white, 1 black
// Framing is tuned for a wide window and scaled up on narrow ones, so the
// flock still fits on a phone held in portrait.
const CAMERA_DIR = new THREE.Vector3(0, 36, 21).normalize();
const CAMERA_DIST = Math.hypot(36, 21);
const BASE_ASPECT = 1.6;
const MAX_ZOOM_OUT = 2.1;
const BG = 0x060607;

const coarse = matchMedia('(pointer: coarse)').matches;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.75 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 75, 150);

const camera = new THREE.PerspectiveCamera(48, 1, 1, 400);

const hemi = new THREE.HemisphereLight(0xb8c2d6, 0x08080a, 0.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
sun.shadow.camera.near = 5;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(34, 30, 16).normalize(); // low sun, so slopes read

const world = new World(scene, coarse);
const flock = new Flock(SHEEP_COUNT, world, 0);
const sheepRenderer = new SheepRenderer(scene, flock.sheep, coarse);
const herder = new Herder(scene);
// handy for poking at the simulation from the console, and for tests
window.__sim = { flock, world, herder };

const cameraOffset = new THREE.Vector3();
const sunOffset = new THREE.Vector3();
let zoom = 1;

// Wider view on narrow screens, with fog, shadows, ground and rock streaming
// all scaled to match so nothing pops in or fades out mid-screen.
function applyFraming() {
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  zoom = clamp(BASE_ASPECT / aspect, 1, MAX_ZOOM_OUT);
  const dist = CAMERA_DIST * zoom;

  renderer.setSize(w, h, false);
  camera.aspect = aspect;
  camera.far = dist * 9;
  camera.updateProjectionMatrix();

  cameraOffset.copy(CAMERA_DIR).multiplyScalar(dist);
  sunOffset.copy(SUN_DIR).multiplyScalar(74 * zoom);

  scene.fog.near = dist * 1.8;
  scene.fog.far = dist * 3.6;

  const shadowExtent = 64 * zoom;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.right = sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.far = 220 * zoom;
  sun.shadow.camera.updateProjectionMatrix();

  world.setRange(zoom, scene.fog.far);
}

// pointer -> ground
const pointerNdc = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const target = new THREE.Vector3(0, 0, 0);
const focus = new THREE.Vector3(0, 0, 0);
// 'hover' re-reads the pointer every frame, so holding the mouse off-centre
// keeps you travelling. 'fixed' is a world point a tap dropped on the ground.
let targetMode = 'none';

function ndcFrom(e) {
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}
function castToGround(out) {
  raycaster.setFromCamera(pointerNdc, camera);
  return raycaster.ray.intersectPlane(groundPlane, out) ? out : null;
}

canvas.addEventListener('pointermove', (e) => {
  ndcFrom(e);
  if (e.pointerType === 'touch') {
    if (e.buttons || e.pressure > 0) { castToGround(target); targetMode = 'fixed'; }
  } else {
    targetMode = 'hover';
  }
});
let downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', (e) => {
  ndcFrom(e);
  downX = e.clientX; downY = e.clientY; downT = performance.now();
  if (e.pointerType === 'touch') { castToGround(target); targetMode = 'fixed'; }
  else targetMode = 'hover';
});
// A mouse click switches mode. A tap does not: on touch, tapping is how you
// aim the flock, so the button is the only way to swap shepherd and dog.
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
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
switchBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
function toggleMode() {
  herder.toggle();
  const dog = herder.mode === 'dog';
  modeName.textContent = dog ? 'Dog' : 'Shepherd';
  modeDesc.textContent = dog ? 'the flock scatters' : 'the flock follows';
  switchBtn.textContent = dog ? 'Call the shepherd' : 'Send the dog';
  document.body.classList.toggle('dog', dog);
}

// Phone tilt walks the herder, like a thumbstick: further over is faster. iOS
// needs an explicit permission grant from a tap, and only offers the sensor
// at all over https.
const TILT_DEGREES = 18;   // tilt this far past neutral for full speed
const TILT_DEADZONE = 0.1; // fraction of that to ignore, so a still hand holds still
const tilt = { x: 0, z: 0, tx: 0, tz: 0, on: false, baseB: null, baseG: null, reads: 0, wasDriving: false };
const tiltBtn = document.getElementById('tilt');
const tiltDot = document.getElementById('tiltdot');

function onOrientation(e) {
  if (e.beta === null || e.gamma === null) return;
  tilt.reads++;
  if (tilt.baseB === null) { tilt.baseB = e.beta; tilt.baseG = e.gamma; }
  const b = clamp((e.beta - tilt.baseB) / TILT_DEGREES, -1, 1);
  const g = clamp((e.gamma - tilt.baseG) / TILT_DEGREES, -1, 1);
  // beta and gamma are relative to the device, so swap them when it is turned
  const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let ax = g, az = b;
  if (angle === 90) { ax = b; az = -g; }
  else if (angle === 180) { ax = -g; az = -b; }
  else if (angle === 270 || angle === -90) { ax = -b; az = g; }
  tilt.tx = ax;
  tilt.tz = az;
}

function setTilt(on) {
  tilt.on = on;
  tilt.baseB = tilt.baseG = null;
  tilt.tx = tilt.tz = 0;
  tilt.reads = 0;
  herder.drive = null;
  tiltBtn.textContent = on ? 'Tilt on' : 'Use tilt';
  tiltBtn.classList.toggle('active', on);
  document.body.classList.toggle('tilting', on);
}

if (typeof DeviceOrientationEvent === 'undefined' || !coarse) {
  tiltBtn.hidden = true;
} else {
  tiltBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (tilt.on) { window.removeEventListener('deviceorientation', onOrientation); setTilt(false); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { tiltBtn.textContent = 'Tilt blocked'; return; }
      }
      window.addEventListener('deviceorientation', onOrientation);
      setTilt(true);
    } catch {
      // iOS throws here when the page is not on https
      tiltBtn.textContent = window.isSecureContext ? 'Tilt unavailable' : 'Tilt needs https';
    }
  });
  tiltBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
}

// Turns the smoothed tilt into the herder's drive, and shows it on the pad.
function applyTilt(dt) {
  const k = damp(8, dt);
  tilt.x += (tilt.tx - tilt.x) * k;
  tilt.z += (tilt.tz - tilt.z) * k;
  if (!tilt.on) return;
  const mag = Math.hypot(tilt.x, tilt.z);
  if (mag > TILT_DEADZONE) {
    const m = (mag - TILT_DEADZONE) / (1 - TILT_DEADZONE);
    herder.drive = { x: (tilt.x / mag) * m, z: (tilt.z / mag) * m };
    tilt.wasDriving = true;
  } else {
    herder.drive = null;
    // let go of the tilt and the herder stops where it is, rather than
    // resuming a walk to some earlier tap
    if (tilt.wasDriving) { target.set(herder.x, 0, herder.z); tilt.wasDriving = false; }
  }
  tiltDot.style.transform = `translate(${tilt.x * 14}px, ${tilt.z * 14}px)`;
  tiltDot.classList.toggle('live', tilt.reads > 0);
}

window.addEventListener('resize', applyFraming);
window.addEventListener('orientationchange', applyFraming);
if (window.visualViewport) window.visualViewport.addEventListener('resize', applyFraming);
applyFraming();

camera.position.copy(cameraOffset);
camera.lookAt(focus);
Object.assign(window.__sim, { camera, tilt });

let last = performance.now();
let time = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;

  if (targetMode === 'hover') castToGround(target);
  applyTilt(dt);
  herder.update(dt, target, time, world);

  // the camera trails the cursor, rising and falling with the ground
  focus.x += (herder.x - focus.x) * damp(1.8, dt);
  focus.z += (herder.z - focus.z) * damp(1.8, dt);
  focus.y += (terrainHeight(focus.x, focus.z) - focus.y) * damp(2.6, dt);

  camera.position.copy(focus).add(cameraOffset);
  camera.lookAt(focus);

  sun.position.copy(focus).add(sunOffset);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();

  world.update(focus);
  flock.step(dt, herder, time);
  sheepRenderer.update(flock.sheep, time);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
