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

export function height(x, z) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w[0] * Math.sin(x * w[1] + z * w[2] + w[3]);
  }
  return h;
}

// Writes the downhill-facing slope into out.x / out.z. Positive x means the
// ground rises as x rises, so walking that way is uphill.
export function gradient(x, z, out) {
  let gx = 0, gz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const c = w[0] * Math.cos(x * w[1] + z * w[2] + w[3]);
    gx += c * w[1];
    gz += c * w[2];
  }
  out.x = gx;
  out.z = gz;
  return out;
}

// GLSL needs an explicit decimal point or it reads the literal as an int.
const f = (n) => n.toFixed(6);

export const TERRAIN_GLSL = `
float terrainHeight(vec2 p) {
  return ${WAVES.map((w) => `${f(w[0])} * sin(p.x * ${f(w[1])} + p.y * ${f(w[2])} + ${f(w[3])})`).join('\n       + ')};
}
vec2 terrainGrad(vec2 p) {
  vec2 g = vec2(0.0);
${WAVES.map((w) => `  g += ${f(w[0])} * cos(p.x * ${f(w[1])} + p.y * ${f(w[2])} + ${f(w[3])}) * vec2(${f(w[1])}, ${f(w[2])});`).join('\n')}
  return g;
}
vec3 terrainNormal(vec2 p) {
  vec2 g = terrainGrad(p);
  return normalize(vec3(-g.x, 1.0, -g.y));
}
`;
