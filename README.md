# Glasswork

A real-time raymarched glass study: five emitters orbit a glass torus, each
primary refracted at its own index of refraction. Open `index.html` — one
self-contained file, no build step and no dependencies.

## Stack, and why

Raw **WebGL2 + GLSL**. No library.

The whole subject here is light transport — emission integrated along a ray,
refraction that differs per wavelength, HDR bloom. That is per-pixel shader
work. A scene-graph library (three.js and friends) buys meshes, loaders,
materials and a render graph, none of which this needs, and its post-processing
chromatic aberration is a screen-space UV offset — a picture of the effect
rather than the effect. Reach for three.js when there is real geometry to
import, many objects to manage, or a team to coordinate.

## How it works

- **Geometry** is a signed distance field: a rotating torus plus a drifting
  bead, marched by sphere tracing. No vertices exist anywhere in this program.
- **Emission** is integrated analytically. Scattering toward a point emitter
  along a ray has a closed form, so the haze around each light costs one `atan`
  pair per light per pixel rather than a sample at every marching step. The
  impact parameter is clamped — the integral diverges as a ray grazes an
  emitter, which milks out the whole frame.
- **Dispersion** is three separate traces. Each primary enters the glass at its
  own index, follows its own path through the interior, exits at its own angle,
  and only then contributes its channel. The fringes are three geometries
  disagreeing, not one image shifted.
- **Lateral aberration** in the composite resolves the frame three times at
  slightly different magnifications, scaled by r² from the optical centre —
  which is what the lens artefact physically is.
- **Bloom** is a bright-pass at quarter resolution, two separable blur
  iterations, added back before an ACES-style tonemap.

## Controls

Drag to orbit; it drifts on its own when left alone. Three sliders set
dispersion, lateral aberration and exposure. Render resolution is measured, not
guessed — the loop times its own frame and moves between 35% and 100%.
