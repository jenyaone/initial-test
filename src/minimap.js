import { BARN } from './terrain.js';

// A small overhead map: every sheep, the shepherd in the middle, the dog, the
// barn, and the edge of the main view. Drawn on a 2D canvas so it costs
// nothing on the GPU.
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

  draw(flock, herder, dog, viewHalfWidth, viewHalfHeight) {
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

    // the barn: a little house, pinned to the rim as a hollow box when far off
    {
      let bx = (BARN.x - herder.x) * k, by = (BARN.z - herder.z) * k;
      const bd = Math.hypot(bx, by);
      const out = bd > edge;
      if (out) { bx *= edge / bd; by *= edge / bd; }
      ctx.save();
      ctx.translate(cx + bx, cy + by);
      ctx.lineWidth = Math.max(1, S / 140);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      if (out) {
        const q = r * 2;
        ctx.strokeRect(-q, -q, q * 2, q * 2);
      } else {
        const hw = Math.max(r * 2.2, (BARN.w / 2) * k), hd = Math.max(r * 1.6, (BARN.d / 2) * k);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(-hw, -hd, hw * 2, hd * 2);
        ctx.strokeRect(-hw, -hd, hw * 2, hd * 2);
        // the door, on the +z side
        ctx.fillStyle = '#fff';
        ctx.fillRect(-hw * 0.35, hd - ctx.lineWidth, hw * 0.7, ctx.lineWidth * 2);
      }
      ctx.restore();
    }

    // the dog: a small dark arrow
    if (dog) {
      let dx = (dog.x - herder.x) * k, dy = (dog.z - herder.z) * k;
      const dd = Math.hypot(dx, dy);
      if (dd > edge) { dx *= edge / dd; dy *= edge / dd; }
      const dr = r * 1.4;
      ctx.save();
      ctx.translate(cx + dx, cy + dy);
      ctx.rotate(-dog.heading);
      ctx.beginPath();
      ctx.moveTo(0, dr * 1.3); ctx.lineTo(-dr * 0.9, -dr * 0.9); ctx.lineTo(0, -dr * 0.4); ctx.lineTo(dr * 0.9, -dr * 0.9);
      ctx.closePath();
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.strokeStyle = dog.working ? '#fff' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, S / 150);
      ctx.stroke();
      ctx.restore();
    }

    // the shepherd: an arrow pointing the way it faces
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
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  }
}
