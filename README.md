# Light Table

Five optical studies on one real-time renderer: emissive objects, dispersive
refraction, and an exposure you can drag across the frame. Open `index.html` —
one self-contained file, no build step and no dependencies.

## Stack, and why

Raw **WebGL2 + GLSL**. No library.

The subject is light transport: emission integrated along a ray, refraction
that differs per wavelength, HDR bloom, a streak that is an accumulated
exposure rather than a blur filter. That is per-pixel shader work. A
scene-graph library buys meshes, loaders, materials and a render graph, none of
which this needs, and its post-processing chromatic aberration is a
screen-space UV offset — a picture of the effect rather than the effect. Reach
for one when there is real geometry to import or many objects to manage.

## The scenes

| # | Name | What it is |
|---|------|-----------|
| 01 | glasswork | A glass torus and a loose bead, five lamps in orbit, each primary taking its own path through the interior. |
| 02 | colonnade | Lamps behind a row of slabs; drag the exposure sideways and the gaps pull into ribbons that beat against a fine grating. |
| 03 | creased | A sheet folded into a triangle wave, raked at a grazing angle so N·L swings hard between facets. |
| 04 | veil | Overexposed and out of focus, only the creases left crisp. |
| 05 | stack | A column of hot blocks turning on itself, dragged vertically into coloured trails. |

## How it works

- **Geometry** is a signed distance field, sphere-traced. No vertices exist
  anywhere in this program. The creased sheet is deliberately not an exact
  distance field, so its march is scaled back to keep it from stepping through
  a fold.
- **Emission** is integrated analytically. Scattering toward a point emitter
  along a ray has a closed form, so the haze around each lamp costs one `atan`
  pair per lamp per pixel rather than a sample at every marching step. The
  impact parameter is clamped — the integral diverges on a grazing ray and
  milks out the whole frame.
- **Dispersion** is three separate traces. Each primary enters the glass at its
  own index, follows its own path through the interior, exits at its own angle,
  and only then contributes its channel. The fringes are three geometries
  disagreeing, not one image shifted.
- **Lateral aberration** resolves the composite three times at slightly
  different magnifications, scaled by r² from the optical centre — which is
  what the lens artefact physically is.
- **Exposure drag** sums the frame over a set of displaced samples, each
  primary displaced slightly differently so a bright edge leaves a coloured
  streak. Keep that per-channel split small: a long drag with a wide split
  walks red and blue off in opposite directions and leaves green sitting in the
  middle of everything.
- **Shadows** test against geometry only. Include the lamp spheres in the
  occluder field and every surface is shadowed by the light that illuminates
  it — the scenes render as glow with no objects in them.

## Controls

Drag to orbit; it drifts on its own when left alone. Keys 1–5 or the list
switch scenes, each of which sets its own grade. Four sliders override
dispersion, lateral aberration, exposure drag and exposure. Cost is measured,
not guessed: the loop times its own frame and trades away drag samples first,
then render resolution, between 35% and 100%.
