# Fifty-three white sheep, one black

An endless black contour map seen from above, with 53 white sheep and one black
sheep that flock together and react to your cursor.

- **The goal**: get all 54 sheep into the barn. A fenced yard with a funnel
  mouth sits in front of it, and anything inside the yard or the barn counts.
- **The shepherd** (white) is your cursor. Sheep move away from it, so you walk
  behind the flock to push it where you want.
- **The dog** (black) works on its own once sent. It runs round to the far side
  of the flock from the barn and drives the sheep toward the gate, gathering
  them at the mouth first and then pushing them straight in. Call it back and
  it trots to heel.
- The camera trails the shepherd with a little delay, and the map goes on
  forever. Rocks are scattered about, and neither sheep nor herders pass
  through them or the fences.
- The ground rolls in gentle hills, drawn as a topographic map: pale contour
  lines on black, a heavier index line every fifth, and stipple on the flats.
  Sheep lean with the slope, labour uphill and pick up pace on the way down.
- If a sheep strays out of sight for a few seconds a notice offers a restart;
  it clears itself if you bring the flock back. When every sheep is home you
  get a little tune and the offer of another go.
- Ambient sound, all synthesised: wind, the odd bleat, the dog's bark when it
  is sent, a soft bell for each sheep that goes in. The Sound button or `M`
  mutes it, and the choice is remembered.

### Controls

| | Move the shepherd | Send or recall the dog |
| --- | --- | --- |
| Mouse | move the cursor; the shepherd walks to where it stopped | click, or press `Space` |
| Touch | tap or drag the field | the on-screen button |

`R` restarts.

A small map in the top corner shows every sheep, the black one ringed in
white, with the shepherd or dog as an arrow at its centre and a faint box for
what the main camera can see. Sheep beyond the map's edge are pinned to its rim
as dimmer dots, so a scattered flock is always findable.

On a phone there is also a **Use tilt** button. Once you grant it the motion
sensor, tilting the handset walks the shepherd or dog like a thumbstick: the
further you tilt, the faster they go, and holding the phone level stops them.
A small pad next to the button shows the live tilt, and its dot turns solid
white once the sensor is actually delivering readings. Tap the button again to
turn tilt off. The shepherd and dog cannot walk through rocks; they slide round
them.

On a phone the shepherd walks to wherever you last tapped and keeps going after
you lift your finger, so tapping never sends the dog.

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

## Test it

```sh
npm test
```

runs the real simulation headless, with the dog sent and a scripted shepherd
walking behind the flock, and reports how long it takes to pen all 54. It is
the check that the herding actually works, without a browser.

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
