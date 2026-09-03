// A small overhead map: every sheep, the herder in the middle, and the edge
// of the main view. Drawn on a 2D canvas so it costs nothing on the GPU.
const MIN_RANGE = 56;   // world units across the map when the flock is tight
const MAX_RANGE = 420;  // beyond this, stragglers are pinned to the rim instead

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.range = MIN_RANGE;
  }

  resize() {
    const css = this.canvas.getBoundingClientRect().width;
    const px = Math.round(css * Math.min(window.devicePixelRatio || 1, 2));
    if (px === this.size || px === 0) return;
    this.size = px;
    this.canvas.width = px;
    this.canvas.height = px;
  }

  draw(flock, herder, viewHalfWidth, viewHalfHeight) {
    this.resize();
    const S = this.size;
    if (!S) return;
    const ctx = this.ctx;
    // zoom to fit the flock: the map spans about 2.4x the farthest sheep,
    // eased over time so it breathes rather than twitches
    let far = 0;
    for (const s of flock.sheep) far = Math.max(far, Math.hypot(s.x - herder.x, s.z - herder.z));
    const want = Math.min(MAX_RANGE, Math.max(MIN_RANGE, far * 2.4));
    this.range += (want - this.range) * 0.04;
    const k = S / this.range;           // pixels per world unit
    const cx = S / 2, cy = S / 2;
    const toX = (x) => cx + (x - herder.x) * k;
    const toY = (z) => cy + (z - herder.z) * k;

    ctx.clearRect(0, 0, S, S);

    // what the main camera roughly sees
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, S / 140);
    ctx.strokeRect(cx - viewHalfWidth * k, cy - viewHalfHeight * k, viewHalfWidth * 2 * k, viewHalfHeight * 2 * k);

    // sheep, clamped to the rim when they are off the map so you know which way to look
    const r = Math.max(1.5, S / 90);
    const edge = S / 2 - r * 1.5;
    for (const s of flock.sheep) {
      let dx = (s.x - herder.x) * k, dy = (s.z - herder.z) * k;
      const d = Math.hypot(dx, dy);
      const out = d > edge;
      if (out) { dx *= edge / d; dy *= edge / d; }
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, out ? r * 0.7 : r, 0, Math.PI * 2);
      if (s.isBlack) {
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1, S / 160);
        ctx.stroke();
      } else {
        ctx.fillStyle = out ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.92)';
        ctx.fill();
      }
    }

    // the herder: an arrow pointing the way it faces
    const hr = r * 1.9;
    ctx.save();
    ctx.translate(toX(herder.x), toY(herder.z));
    ctx.rotate(-herder.heading);          // heading 0 faces +z, which is down on the map
    ctx.beginPath();
    ctx.moveTo(0, hr * 1.3);
    ctx.lineTo(-hr * 0.9, -hr * 0.9);
    ctx.lineTo(0, -hr * 0.4);
    ctx.lineTo(hr * 0.9, -hr * 0.9);
    ctx.closePath();
    if (herder.mode === 'dog') {
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, S / 120);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    ctx.restore();
  }
}
