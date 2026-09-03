# Fifty-three white sheep, one black

An endless dark field seen from above, with 53 white sheep and one black sheep
that flock together and react to your cursor.

- **Shepherd** (white): the flock follows you and gathers around you.
- **Dog** (black): the flock scatters and runs.
- Click, tap the button, or press **Space** to switch between them.
- The camera trails the cursor with a little delay, and the map goes on forever.
- Rocks are scattered across the fields and the sheep steer around them.

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
