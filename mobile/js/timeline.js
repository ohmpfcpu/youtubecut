// Timeline tactile dessinée sur un canvas. Tête de lecture fixe au centre :
// on fait glisser la timeline sous le doigt (comme les éditeurs mobiles).
import { layout, totalDuration, clipDur, audioDur, MIN_CLIP } from './project.js';
import { ENV_RATE } from './media.js';

const RULER = 22;
const V_Y = 30, V_H = 62;
const WAVE_H = 14;
const A_Y0 = V_Y + V_H + 12, A_H = 42, A_GAP = 8;
const HANDLE = 14;
const COLORS = {
  bg: '#0f1115', ruler: '#8a93a3', tick: '#3a404c', clip: '#2a3140', clipBorder: '#3d4657',
  sel: '#ffd34d', audio: '#1f5f57', audioSel: '#2b7d73', wave: 'rgba(255,255,255,0.55)',
  wave2: 'rgba(120,230,210,0.9)', playhead: '#ffffff', dim: 'rgba(0,0,0,0.45)', text: '#e8ecf3',
};

export class Timeline extends EventTarget {
  constructor(canvas, app) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.pps = 40;
    this.scrollY = 0;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.fling = null;
    this.dirty = true;
    this.envMax = new Map();
    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e, true));
    canvas.addEventListener('wheel', e => this._wheel(e), { passive: false });
    this._raf = this._raf.bind(this);
    requestAnimationFrame(this._raf);
  }

  get project() { return this.app.project; }
  get media() { return this.app.media; }
  get player() { return this.app.player; }

  invalidate() { this.dirty = true; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.invalidate();
  }

  zoomBy(f) {
    this.pps = Math.max(2, Math.min(800, this.pps * f));
    this.invalidate();
  }

  fitZoom() {
    const d = totalDuration(this.project);
    if (d > 0 && this.w) this.pps = Math.max(2, Math.min(800, (this.w * 0.8) / d));
    this.invalidate();
  }

  get view() { return this.drag && this.drag.view != null ? this.drag.view : this.player.time; }
  x(t) { return this.w / 2 + (t - this.view) * this.pps; }
  laneY(i) { return A_Y0 + i * (A_H + A_GAP) - this.scrollY; }
  contentH() { return A_Y0 + (this.project.audio.length + 1) * (A_H + A_GAP); }

  _raf() {
    requestAnimationFrame(this._raf);
    if (this.fling) this._stepFling();
    if (this.player.playing) this.dirty = true;
    if (this.dirty && this.project && this.w) {
      this.dirty = false;
      this.draw();
    }
  }

  _envMaxOf(m) {
    if (!m.env) return 1;
    let v = this.envMax.get(m.id);
    if (v == null) {
      v = 1e-3;
      for (let i = 0; i < m.env.length; i += 4) if (m.env[i] > v) v = m.env[i];
      this.envMax.set(m.id, v);
    }
    return v;
  }

  _wave(ctx, m, srcStart, x0, x1, yMid, half, color) {
    if (!m || !m.env) return;
    const max = this._envMaxOf(m);
    ctx.fillStyle = color;
    const a = Math.max(x0, 0), b = Math.min(x1, this.w);
    for (let x = Math.floor(a); x < b; x++) {
      const t0 = srcStart + (x - x0) / this.pps;
      const i0 = Math.floor(t0 * ENV_RATE), i1 = Math.max(i0 + 1, Math.floor((t0 + 1 / this.pps) * ENV_RATE));
      let v = 0;
      for (let i = i0; i < i1 && i < m.env.length; i++) if (i >= 0 && m.env[i] > v) v = m.env[i];
      const hgt = Math.max(0.5, Math.pow(Math.min(1, v / max), 0.7) * half);
      ctx.fillRect(x, yMid - hgt, 1, hgt * 2);
    }
  }

  draw() {
    const ctx = this.ctx, W = this.w, H = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    const total = totalDuration(this.project);
    const sel = this.app.selection;

    // Règle
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => s * this.pps >= 70) || 600;
    const tStart = Math.max(0, Math.floor((this.view - W / 2 / this.pps) / step) * step);
    const tEnd = this.view + W / 2 / this.pps;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (let t = tStart; t <= tEnd; t += step) {
      const x = this.x(t);
      ctx.fillStyle = COLORS.tick;
      ctx.fillRect(Math.round(x), 14, 1, 6);
      ctx.fillStyle = COLORS.ruler;
      const label = step < 1 ? `${t.toFixed(1)}s` : t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Math.round(t)}s`;
      ctx.fillText(label, x + 3, 2);
      for (let k = 1; k < 5; k++) {
        const xm = this.x(t + (step * k) / 5);
        ctx.fillStyle = COLORS.tick;
        ctx.fillRect(Math.round(xm), 17, 1, 3);
      }
    }

    // Clips vidéo
    const items = layout(this.project);
    if (!items.length) {
      ctx.fillStyle = '#6b7385';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('Touchez « Vidéo » pour importer vos clips', W / 2, V_Y + V_H / 2);
      ctx.textAlign = 'left';
    }
    for (const it of items) {
      const x0 = this.x(it.start), x1 = this.x(it.end);
      if (x1 < -20 || x0 > W + 20) continue;
      const m = this.media.get(it.clip.mediaId);
      const isSel = sel && sel.type === 'clip' && sel.id === it.clip.id;
      ctx.save();
      roundRect(ctx, x0 + 1, V_Y, Math.max(2, x1 - x0 - 2), V_H, 6);
      ctx.fillStyle = COLORS.clip;
      ctx.fill();
      ctx.clip();
      // Miniatures
      const thumbs = m && m.thumbs;
      const th = V_H - WAVE_H;
      if (thumbs && thumbs.length) {
        const img0 = thumbs[0].img;
        const tw = Math.max(20, (img0.width / img0.height) * th);
        const first = Math.max(0, Math.floor((0 - x0) / tw));
        for (let i = first; x0 + i * tw < Math.min(x1, W); i++) {
          const x = x0 + i * tw;
          const st = it.clip.in + (i * tw + tw / 2) / this.pps;
          ctx.drawImage(nearest(thumbs, st).img, x, V_Y, tw, th);
        }
      }
      // Forme d'onde du son d'origine
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x0, V_Y + th, x1 - x0, WAVE_H);
      if (m && m.env && !it.clip.muted) this._wave(ctx, m, it.clip.in, x0, x1, V_Y + th + WAVE_H / 2, WAVE_H / 2 - 1, COLORS.wave);
      // Étiquettes
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      const label = `${clipDur(it.clip).toFixed(1)}s${it.clip.muted ? '  🔇' : ''}${it.clip.adjust && Object.values(it.clip.adjust).some(Boolean) ? '  ◐' : ''}`;
      const lw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x0 + 4, V_Y + 4, lw, 14);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(label, x0 + 8, V_Y + 6);
      ctx.restore();
      ctx.strokeStyle = isSel ? COLORS.sel : COLORS.clipBorder;
      ctx.lineWidth = isSel ? 2 : 1;
      roundRect(ctx, x0 + 1, V_Y, Math.max(2, x1 - x0 - 2), V_H, 6);
      ctx.stroke();
      if (isSel) this._handles(ctx, x0, x1, V_Y, V_H);
    }

    // Pistes audio
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, A_Y0 - 6, W, H);
    ctx.clip();
    this.project.audio.forEach((a, i) => {
      const y = this.laneY(i);
      const x0 = this.x(a.start), x1 = this.x(a.start + audioDur(a));
      const m = this.media.get(a.mediaId);
      const isSel = sel && sel.type === 'audio' && sel.id === a.id;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, y, W, A_H);
      if (x1 < 0 || x0 > W) return;
      ctx.save();
      roundRect(ctx, x0, y, Math.max(2, x1 - x0), A_H, 6);
      ctx.fillStyle = isSel ? COLORS.audioSel : COLORS.audio;
      ctx.fill();
      ctx.clip();
      this._wave(ctx, m, a.in, x0, x1, y + A_H / 2 + 5, A_H / 2 - 9, COLORS.wave2);
      // fondus
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (a.fadeIn > 0) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + a.fadeIn * this.pps, y); ctx.lineTo(x0, y + A_H); ctx.fill(); }
      if (a.fadeOut > 0) { ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 - a.fadeOut * this.pps, y); ctx.lineTo(x1, y + A_H); ctx.fill(); }
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = COLORS.text;
      const vis = Math.max(x0, 0) + 6;
      ctx.fillText(`♪ ${m ? m.name : '?'}${a.volume !== 1 ? `  ${Math.round(a.volume * 100)}%` : ''}`, vis, y + 3);
      ctx.restore();
      if (isSel) {
        ctx.strokeStyle = COLORS.sel;
        ctx.lineWidth = 2;
        roundRect(ctx, x0, y, Math.max(2, x1 - x0), A_H, 6);
        ctx.stroke();
        this._handles(ctx, x0, x1, y, A_H);
      }
    });
    // Ligne « ajouter un son »
    const yAdd = this.laneY(this.project.audio.length);
    ctx.strokeStyle = '#2f3542';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    roundRect(ctx, 8, yAdd + 0.5, W - 16, A_H - 1, 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7d8699';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('+ Ajouter une bande son', W / 2, yAdd + A_H / 2);
    ctx.textAlign = 'left';
    ctx.restore();

    // Zone au-delà de la fin (non exportée)
    if (total > 0) {
      const xe = this.x(total);
      if (xe < W) {
        ctx.fillStyle = COLORS.dim;
        ctx.fillRect(Math.max(0, xe), RULER, W - Math.max(0, xe), H);
      }
    }

    // Tête de lecture
    ctx.fillStyle = COLORS.playhead;
    ctx.fillRect(Math.round(W / 2) - 1, 0, 2, H);
    ctx.beginPath();
    ctx.moveTo(W / 2 - 6, 0); ctx.lineTo(W / 2 + 6, 0); ctx.lineTo(W / 2, 8);
    ctx.fill();
  }

  _handles(ctx, x0, x1, y, h) {
    ctx.fillStyle = COLORS.sel;
    roundRect(ctx, x0 - HANDLE + 1, y, HANDLE, h, 4); ctx.fill();
    roundRect(ctx, x1 - 1, y, HANDLE, h, 4); ctx.fill();
    ctx.fillStyle = '#3a3000';
    ctx.fillRect(x0 - HANDLE / 2 - 0.5, y + h / 2 - 8, 2, 16);
    ctx.fillRect(x1 + HANDLE / 2 - 1.5, y + h / 2 - 8, 2, 16);
  }

  // ---------- Interaction ----------
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hitTest(x, y) {
    const sel = this.app.selection;
    const near = (px, edge) => Math.abs(px - edge) <= HANDLE + 6;
    if (y >= V_Y - 6 && y <= V_Y + V_H + 6) {
      for (const it of layout(this.project)) {
        const x0 = this.x(it.start), x1 = this.x(it.end);
        if (sel && sel.type === 'clip' && sel.id === it.clip.id) {
          if (near(x, x0 - HANDLE / 2) && x < x0 + 8) return { type: 'clip', id: it.clip.id, part: 'l' };
          if (near(x, x1 + HANDLE / 2) && x > x1 - 8) return { type: 'clip', id: it.clip.id, part: 'r' };
        }
        if (x >= x0 && x < x1) return { type: 'clip', id: it.clip.id, part: 'body' };
      }
      return null;
    }
    for (let i = 0; i <= this.project.audio.length; i++) {
      const ly = this.laneY(i);
      if (y < ly - 4 || y > ly + A_H + 4) continue;
      if (i === this.project.audio.length) return { type: 'add-audio' };
      const a = this.project.audio[i];
      const x0 = this.x(a.start), x1 = this.x(a.start + audioDur(a));
      if (sel && sel.type === 'audio' && sel.id === a.id) {
        if (near(x, x0 - HANDLE / 2) && x < x0 + 8) return { type: 'audio', id: a.id, part: 'l' };
        if (near(x, x1 + HANDLE / 2) && x > x1 - 8) return { type: 'audio', id: a.id, part: 'r' };
        if (x >= x0 && x <= x1) return { type: 'audio', id: a.id, part: 'move' };
      }
      if (x >= x0 && x <= x1) return { type: 'audio', id: a.id, part: 'body' };
      return null;
    }
    return null;
  }

  _down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this._pos(e);
    this.pointers.set(e.pointerId, p);
    this.fling = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps: this.pps };
      this.drag = null;
      return;
    }
    if (this.pointers.size > 2) return;
    const hit = this.hitTest(p.x, p.y);
    const d = { hit, x: p.x, y: p.y, moved: false, startTime: this.player.time, scrollY: this.scrollY, samples: [{ x: p.x, t: performance.now() }] };
    if (hit && hit.type === 'clip' && hit.part !== 'body') d.orig = { ...this.project.clips.find(c => c.id === hit.id) };
    if (hit && hit.type === 'audio' && hit.part !== 'body') d.orig = { ...this.project.audio.find(a => a.id === hit.id) };
    this.drag = d;
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this._pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.pps = Math.max(2, Math.min(800, this.pinch.pps * dist / this.pinch.dist));
      this.invalidate();
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = p.x - d.x, dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 7) return;
    if (!d.moved) {
      d.moved = true;
      if (this.player.playing) this.player.pause();
      d.mode = d.orig ? d.hit.part : (Math.abs(dy) > Math.abs(dx) * 1.3 && this.contentH() > this.h ? 'vscroll' : 'scrub');
    }
    d.samples.push({ x: p.x, t: performance.now() });
    if (d.samples.length > 6) d.samples.shift();
    const dt = dx / this.pps;

    if (d.mode === 'scrub') {
      this.player.seek(d.startTime - dt);
    } else if (d.mode === 'vscroll') {
      this.scrollY = Math.max(0, Math.min(this.contentH() - this.h + 10, d.scrollY - dy));
    } else if (d.hit.type === 'clip') {
      const clip = this.project.clips.find(c => c.id === d.hit.id);
      const m = this.media.get(clip.mediaId);
      if (d.mode === 'l') {
        const nin = Math.max(0, Math.min(d.orig.out - MIN_CLIP, d.orig.in + dt));
        clip.in = nin;
        d.view = d.startTime - (nin - d.orig.in);
        this.player.showClipFrame(clip, clip.in);
      } else if (d.mode === 'r') {
        clip.out = Math.max(clip.in + MIN_CLIP, Math.min(m.duration, d.orig.out + dt));
        this.player.showClipFrame(clip, Math.max(clip.in, clip.out - 0.04));
      }
      this.dispatchEvent(new Event('change'));
    } else if (d.hit.type === 'audio') {
      const a = this.project.audio.find(x => x.id === d.hit.id);
      const m = this.media.get(a.mediaId);
      if (d.mode === 'l') {
        const nin = Math.max(0, Math.min(d.orig.out - MIN_CLIP, d.orig.in + dt));
        a.in = nin;
        a.start = d.orig.start + (nin - d.orig.in);
      } else if (d.mode === 'r') {
        a.out = Math.max(a.in + MIN_CLIP, Math.min(m.duration, d.orig.out + dt));
      } else if (d.mode === 'move') {
        a.start = this._snap(d.orig.start + dt, a);
      }
      this.dispatchEvent(new Event('change'));
    }
    this.invalidate();
  }

  _snap(start, a) {
    const pts = [0, this.player.time];
    for (const it of layout(this.project)) pts.push(it.start, it.end);
    const len = audioDur(a);
    const tol = 8 / this.pps;
    for (const p of pts) {
      if (Math.abs(start - p) < tol) return p;
      if (Math.abs(start + len - p) < tol) return p - len;
    }
    return start;
  }

  _up(e, cancel) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d || cancel) { this.invalidate(); return; }
    if (!d.moved) {
      this.dispatchEvent(new CustomEvent('tap', { detail: d.hit }));
    } else if (d.mode === 'scrub') {
      const s = d.samples;
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1];
        const v = (b.x - a.x) / Math.max(1, b.t - a.t); // px/ms
        if (Math.abs(v) > 0.4 && performance.now() - b.t < 80) this.fling = { v: -v / this.pps * 1000, last: performance.now() };
      }
    } else if (d.mode !== 'vscroll') {
      if (d.view != null) this.player.seek(d.view);
      this.player.clearOverride();
      this.dispatchEvent(new Event('commit'));
    }
    this.invalidate();
  }

  _stepFling() {
    const now = performance.now();
    const dt = (now - this.fling.last) / 1000;
    this.fling.last = now;
    this.player.seek(this.player.time + this.fling.v * dt);
    this.fling.v *= Math.pow(0.04, dt);
    if (Math.abs(this.fling.v * this.pps) < 20 || this.player.time <= 0 || this.player.time >= totalDuration(this.project)) this.fling = null;
    this.invalidate();
  }

  _wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.01));
    else this.player.seek(this.player.time + (e.deltaX || e.deltaY) / this.pps);
    this.invalidate();
  }
}

function nearest(thumbs, t) {
  let best = thumbs[0], bd = Infinity;
  for (const th of thumbs) {
    const d = Math.abs(th.t - t);
    if (d < bd) { bd = d; best = th; }
  }
  return best;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
