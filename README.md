# Fifty-three white sheep, one black

An endless black contour map seen from above, with 53 white sheep and one black
sheep that flock together and react to your cursor.

- **Shepherd** (white): the flock follows you and gathers around you.
- **Dog** (black): the flock scatters and runs.
- The camera trails the cursor with a little delay, and the map goes on forever.
- Rocks are scattered across the fields and the sheep steer around them.
- The ground rolls in gentle hills, drawn as a topographic map: pale contour
  lines on black, a heavier index line every fifth, and stipple on the flats.
  The lines trace the same height field the sheep walk on, so they lean with
  the slope, labour uphill and pick up pace on the way down.

### Controls

| | Move the herder | Switch shepherd / dog |
| --- | --- | --- |
| Mouse | move the cursor | click, or press `Space` |
| Touch | tap or drag the field | the on-screen button |

On a phone there is also a **Use tilt** button. Once you grant it the motion
sensor, tilting the handset leans the camera around the flock. It is only a
camera effect, so it never steers the sheep, and tapping it again turns it off.

On a phone the herder walks to wherever you last tapped and keeps going after
you lift your finger, so tapping never switches the mode.

## On iPhone and Android

It runs in mobile Safari and Chrome. iOS 16.4 or newer is required, because the
site loads three.js through an import map. The camera pulls back on narrow
screens so the whole flock stays in frame in portrait, and touch devices get a
lighter build: a smaller shadow map and pixel ratio, no antialiasing, and
simplified sheep that drop the ears and tail and use a coarser body. That takes
the flock from five instanced meshes to three, and from about 11,400 triangles
down to 4,300.

Tilt needs the page on **https**. iOS only offers the motion sensor in a secure
context, so it works on GitHub Pages but not over a plain `http://` address on
your wifi.

It cannot be opened as a local file: ES modules and import maps need a real
server. Either use GitHub Pages (below), or run `npm start` on a computer and
open the `network` address it prints from a phone on the same wifi.

## Deploying

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push
to `master`, and can also be run by hand from the Actions tab.

Pages has to be turned on once before the first deploy succeeds: in the
repository's **Settings > Pages**, set **Source** to **GitHub Actions**. The
workflow token is not allowed to do this for you. Once it is on, re-run the
workflow and the site appears at `https://<user>.github.io/<repo>/`.

## Run it

Everything is static: no build step, no bundler.

```sh
npm start        # serves the site on http://localhost:8080
```

Any static file server works too (`python3 -m http.server`, GitHub Pages, ...).

## How it is made

- [three.js](https://threejs.org) 0.185 is the only dependency, vendored in `vendor/`
  and loaded through an import map in `index.html`.
- `src/flock.js` is a boids simulation (separation, alignment, cohesion) with
  a herder that attracts or repels, rock avoidance and idle wandering.
- `src/sheep.js` draws every sheep with five instanced meshes (wool, head,
  ears, legs, tail) and animates legs, body bob and grazing heads.
- `src/world.js` draws the contour map in a shader. Each pixel evaluates the
  terrain height exactly and inks a line where it crosses a level, with a
  screen-space width so lines stay hairline whether the ground is steep, flat,
  near or far. Rocks are placed deterministically per chunk, so the map is
  endless and stable.
- `src/terrain.js` holds the height field as a handful of sine waves. It emits
  the matching GLSL from the same numbers the simulation uses, so the ground you
  see and the ground the sheep walk on cannot drift apart.
- `src/herder.js` builds the procedural shepherd and dog that sit under the cursor.

The `three` entry in `devDependencies` only pins the vendored version.
