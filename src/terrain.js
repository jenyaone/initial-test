// One height field, used by both the simulation and the ground shader, so the
// sheep walk on exactly the surface you can see. The GLSL below is generated
// from the same numbers the JS uses, so the two can never drift apart.
//
// Each wave is [amplitude, xFrequency, zFrequency, phase]:
//   height = sum of amp * sin(x * fx + z * fz + phase)
// Long wavelengths and small amplitudes keep it to gentle hills: the steepest
// grade anywhere is about fifteen degrees.
const WAVES = [
  [3.2, 0.030, 0.017, 0.7],
  [2.0, -0.021, 0.052, 2.1],
  [1.15, 0.061, 0.043, 1.3],
  [0.5, 0.115, -0.098, 5.0],
];

// The barn sits on a level pad blended into the hills. Its open side faces +z,
// toward where the flock starts.
export const BARN = { x: 0, z: -78, w: 20, d: 14, door: 10, wallH: 5 };
// A fenced yard in front of the barn with a gate and funnel wings, like a
// sheep race. Anything inside the yard or the barn counts as penned.
export const PEN = { halfW: 15, depth: 26, gate: 12, wing: 15 };
const FRONT = BARN.z + BARN.d / 2;            // barn front wall
export const PEN_GATE_Z = FRONT + PEN.depth;  // the gate line
export const PEN_MOUTH_Z = PEN_GATE_Z + PEN.wing * 0.7071;

// Every fence and wall segment, as [x1, z1, x2, z2] in world XZ.
export function penFences() {
  const { x, w, d, door } = BARN;
  const bz = BARN.z;
  const stub = (w - door) / 2;
  const k = PEN.wing * 0.7071;
  const H = PEN.halfW, G = PEN_GATE_Z, g = PEN.gate / 2;
  return [
    // barn
    [x - w / 2, bz - d / 2, x + w / 2, bz - d / 2],
    [x - w / 2, bz - d / 2, x - w / 2, FRONT],
    [x + w / 2, bz - d / 2, x + w / 2, FRONT],
    [x - w / 2, FRONT, x - w / 2 + stub, FRONT],
    [x + w / 2 - stub, FRONT, x + w / 2, FRONT],
    // yard: shoulders out to the side fences, then the sides up to the gate
    [x - w / 2, FRONT, x - H, FRONT],
    [x + w / 2, FRONT, x + H, FRONT],
    [x - H, FRONT, x - H, G],
    [x + H, FRONT, x + H, G],
    // gate line either side of the opening
    [x - H, G, x - g, G],
    [x + g, G, x + H, G],
    // funnel wings
    [x - g, G, x - g - k, G + k],
    [x + g, G, x + g + k, G + k],
  ];
}
export function inPen(px, pz) {
  const { x, w, d } = BARN;
  const inYard = Math.abs(px - x) < PEN.halfW - 1 && pz < PEN_GATE_Z - 1 && pz > FRONT;
  const inBarn = Math.abs(px - x) < w / 2 - 1 && pz <= FRONT && pz > BARN.z - d / 2 + 1;
  return inYard || inBarn;
}
const PAD_MARGIN = 5;    // flat ground this far beyond the walls
const PAD_BLEND = 16;    // and a ramp this long back into the hills

function baseHeight(x, z) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w[0] * Math.sin(x * w[1] + z * w[2] + w[3]);
  }
  return h;
}
const PAD_H = baseHeight(BARN.x, BARN.z);
const smooth = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };

export function height(x, z) {
  const h = baseHeight(x, z);
  // pad covers the barn and the yard in front of it
  const cz = BARN.z + PEN.depth / 2, hz = BARN.d / 2 + PEN.depth / 2;
  const dx = Math.max(0, Math.abs(x - BARN.x) - PEN.halfW - PAD_MARGIN);
  const dz = Math.max(0, Math.abs(z - cz) - hz - PAD_MARGIN);
  const m = 1 - smooth(0, PAD_BLEND, Math.hypot(dx, dz));
  return h + (PAD_H - h) * m;
}

// Downhill-facing slope into out.x / out.z. Positive x means the ground rises
// as x rises, so walking that way is uphill. Central differences, so the pad
// blend is included without needing its derivative spelled out.
const EPS = 0.3;
export function gradient(x, z, out) {
  out.x = (height(x + EPS, z) - height(x - EPS, z)) / (2 * EPS);
  out.z = (height(x, z + EPS) - height(x, z - EPS)) / (2 * EPS);
  return out;
}

// GLSL needs an explicit decimal point or it reads the literal as an int.
const f = (n) => n.toFixed(6);

export const TERRAIN_GLSL = `
float baseHeight(vec2 p) {
  return ${WAVES.map((w) => `${f(w[0])} * sin(p.x * ${f(w[1])} + p.y * ${f(w[2])} + ${f(w[3])})`).join('\n       + ')};
}
float terrainHeight(vec2 p) {
  float h = baseHeight(p);
  float dx = max(0.0, abs(p.x - ${f(BARN.x)}) - ${f(PEN.halfW + PAD_MARGIN)});
  float dz = max(0.0, abs(p.y - ${f(BARN.z + PEN.depth / 2)}) - ${f(BARN.d / 2 + PEN.depth / 2 + PAD_MARGIN)});
  float m = 1.0 - smoothstep(0.0, ${f(PAD_BLEND)}, length(vec2(dx, dz)));
  return mix(h, ${f(PAD_H)}, m);
}
vec2 terrainGrad(vec2 p) {
  const float e = ${f(EPS)};
  return vec2(terrainHeight(p + vec2(e, 0.0)) - terrainHeight(p - vec2(e, 0.0)),
              terrainHeight(p + vec2(0.0, e)) - terrainHeight(p - vec2(0.0, e))) / (2.0 * e);
}
vec3 terrainNormal(vec2 p) {
  vec2 g = terrainGrad(p);
  return normalize(vec3(-g.x, 1.0, -g.y));
}
`;
