# Fifty-three white sheep, one black

An endless dark field seen from above, with 53 white sheep and one black sheep
that flock together and react to your cursor.

- **Shepherd** (white): the flock follows you and gathers around you.
- **Dog** (black): the flock scatters and runs.
- The camera trails the cursor with a little delay, and the map goes on forever.
- Rocks are scattered across the fields and the sheep steer around them.

### Controls

| | Move the herder | Switch shepherd / dog |
| --- | --- | --- |
| Mouse | move the cursor | click, or press `Space` |
| Touch | tap or drag the field | the on-screen button |

On a phone the herder walks to wherever you last tapped and keeps going after
you lift your finger, so tapping never switches the mode.

## On iPhone and Android

It runs in mobile Safari and Chrome. iOS 16.4 or newer is required, because the
site loads three.js through an import map. The camera pulls back on narrow
screens so the whole flock stays in frame in portrait, and the renderer drops to
a smaller shadow map and pixel ratio on touch devices.

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
- `src/world.js` generates the fields in a shader from world coordinates and
  places rocks deterministically per chunk, so the map is endless and stable.
- `src/herder.js` builds the procedural shepherd and dog that sit under the cursor.

The `three` entry in `devDependencies` only pins the vendored version.
