import * as THREE from 'three';
import { World } from './world.js';
import { Flock } from './flock.js';
import { SheepRenderer } from './sheep.js';
import { Herder } from './herder.js';
import { Dog } from './dog.js';
import { Minimap } from './minimap.js';
import { Ambience } from './audio.js';
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
const LOST_GRACE = 4;   // seconds a sheep may be out of sight before we say so

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
const dog = new Dog(scene);
const minimap = new Minimap(document.getElementById('map'));
const audio = new Ambience();
// handy for poking at the simulation from the console, and for tests
window.__sim = { flock, world, herder, dog, audio };

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

// pointer -> ground. Every pointer move drops a fixed world point, so when
// the mouse or finger stops, the shepherd walks to that spot and stops there,
// and the camera settles with the shepherd in the middle of the screen.
const pointerNdc = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const target = new THREE.Vector3(0, 0, 0);
const focus = new THREE.Vector3(0, 0, 0);

function ndcFrom(e) {
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}
function castToGround(out) {
  raycaster.setFromCamera(pointerNdc, camera);
  return raycaster.ray.intersectPlane(groundPlane, out) ? out : null;
}

canvas.addEventListener('pointermove', (e) => {
  ndcFrom(e);
  if (e.pointerType === 'touch' && !(e.buttons || e.pressure > 0)) return;
  castToGround(target);
});
let downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', (e) => {
  ndcFrom(e);
  downX = e.clientX; downY = e.clientY; downT = performance.now();
  castToGround(target);
});
// A mouse click sends or recalls the dog. A tap does not: on touch, tapping is
// how you aim the shepherd, so the button is the only way.
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (moved < 8 && performance.now() - downT < 500) toggleDog();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === 'd') { e.preventDefault(); toggleDog(); }
  if (e.key === 'm') soundBtn.click();
  if (e.key === 'r') restart();
});
// sound may only start after a gesture
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.start(), { passive: true });

const goalEl = document.getElementById('goal');
const dogEl = document.getElementById('dogState');
const switchBtn = document.getElementById('switch');
const soundBtn = document.getElementById('sound');
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ovTitle');
const ovText = document.getElementById('ovText');
const ovBtn = document.getElementById('ovBtn');
switchBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDog(); });
switchBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
soundBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.start(); const m = audio.toggleMuted(); soundBtn.textContent = m ? 'Sound off' : 'Sound on'; soundBtn.classList.toggle('active', !m); });
soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
soundBtn.textContent = audio.muted ? 'Sound off' : 'Sound on';
soundBtn.classList.toggle('active', !audio.muted);
ovBtn.addEventListener('click', (e) => { e.stopPropagation(); restart(); });
ovBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

function toggleDog() {
  dog.toggle();
  if (dog.working) audio.bark((dog.x - focus.x) / 35);
  updateHud();
}
let hudPenned = -1, hudDog = null;
function updateHud() {
  if (flock.penned !== hudPenned) {
    hudPenned = flock.penned;
    goalEl.textContent = `${flock.penned} of ${SHEEP_COUNT} in the barn`;
  }
  if (dog.working !== hudDog) {
    hudDog = dog.working;
    dogEl.textContent = dog.working ? 'dog working' : 'dog at heel';
    switchBtn.textContent = dog.working ? 'Call the dog' : 'Send the dog';
    document.body.classList.toggle('dogout', dog.working);
  }
}

// lost / won
let state = 'play';
let lostFor = 0;
function showOverlay(title, text, button) {
  ovTitle.textContent = title; ovText.textContent = text; ovBtn.textContent = button;
  overlay.classList.add('show');
}
function hideOverlay() { overlay.classList.remove('show'); }
function restart() {
  flock.reset();
  herder.placeAt(0, 0);
  target.set(0, 0, 0);
  dog.recall();
  dog.placeAt(-3, 3);
  focus.set(0, 0, 0);
  state = 'play';
  lostFor = 0;
  hideOverlay();
  updateHud();
}
function checkGoal(dt) {
  if (state === 'won') return;
  if (flock.penned === SHEEP_COUNT) {
    state = 'won';
    audio.win();
    showOverlay('All home', `Every one of the ${SHEEP_COUNT} sheep is in the barn.`, 'Play again');
    return;
  }
  if (flock.lost > 0) lostFor += dt; else lostFor = 0;
  if (state === 'play' && lostFor > LOST_GRACE) {
    state = 'lost';
    const n = flock.lost;
    showOverlay('Sheep lost', n === 1 ? 'One sheep has wandered out of sight. Bring it back, or start over.' : `${n} sheep have wandered out of sight. Bring them back, or start over.`, 'Restart');
  } else if (state === 'lost' && flock.lost === 0) {
    state = 'play';
    hideOverlay();
  }
}

// Phone tilt walks the shepherd, like a thumbstick: further over is faster.
// iOS needs an explicit permission grant from a tap, and only offers the
// sensor at all over https.
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

// Turns the smoothed tilt into the shepherd's drive, and shows it on the pad.
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
    // let go of the tilt and the shepherd stops where it is, rather than
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
Object.assign(window.__sim, { camera, tilt, restart, target });
updateHud();

let last = performance.now();
let time = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;

  applyTilt(dt);
  herder.update(dt, target, time, world);
  dog.update(dt, herder, flock, world, time);

  // the camera trails the shepherd, rising and falling with the ground
  focus.x += (herder.x - focus.x) * damp(1.8, dt);
  focus.z += (herder.z - focus.z) * damp(1.8, dt);
  focus.y += (terrainHeight(focus.x, focus.z) - focus.y) * damp(2.6, dt);

  camera.position.copy(focus).add(cameraOffset);
  camera.lookAt(focus);

  sun.position.copy(focus).add(sunOffset);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();

  world.update(focus);
  flock.step(dt, [herder, dog], time);
  sheepRenderer.update(flock.sheep, time);

  if (flock.newlyPenned) audio.bell();
  if (dog.barked) audio.bark((dog.x - focus.x) / 35, 0.16);
  audio.update(dt, flock, focus);
  updateHud();
  checkGoal(dt);

  renderer.render(scene, camera);
  // the ground area the camera covers, for the view box on the map
  const halfH = cameraOffset.length() * Math.tan((camera.fov * Math.PI) / 360);
  minimap.draw(flock, herder, dog, halfH * camera.aspect, halfH);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
