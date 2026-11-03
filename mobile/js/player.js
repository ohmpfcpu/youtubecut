// Moteur d'aperçu : éléments <video> natifs (décodage matériel) rendus dans le
// canvas WebGL + pistes audio jouées via Web Audio. L'horloge audio est maître :
// la vidéo est recalée dessus, pour juger la synchro de l'audio importé.
import { clipAt, totalDuration, cropRect, projectAspect, fadeFactor, audioDur, layout } from './project.js';
import { Renderer } from './renderer.js';
import { CanvasSink } from 'mediabunny';
import { openInput } from './media.js';

const MAX_PREVIEW_SIDE = 1280;

export class Player extends EventTarget {
  constructor(canvas, pool) {
    super();
    this.canvas = canvas;
    this.pool = pool;
    this.renderer = new Renderer(canvas);
    this.project = null;
    this.media = new Map();
    this.time = 0;
    this.playing = false;
    this.els = new Map();
    this.ctx = null;
    this.trackNodes = [];
    this.override = null;
    this.dirty = true;
    this.active = null;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setProject(project, media) {
    this.pause();
    this.project = project;
    this.media = media || new Map();
    for (const [id, e] of [...this.els]) if (!project || !this.media.has(id)) this._dropEl(id, e);
    this.time = 0;
    this.active = null;
    this.override = null;
    this.invalidate();
  }

  // Remplace le projet (annuler/rétablir) en gardant la position de lecture.
  replaceProject(project) {
    this.project = project;
    this.override = null;
    this.active = null;
    this.time = Math.min(this.time, this.duration);
    if (this.playing) this.seek(this.time);
    this.invalidate();
  }

  // Replanifie les pistes audio après une modification pendant la lecture.
  resync() {
    if (this.playing) this.seek(this._masterTime());
    else this.invalidate();
  }

  invalidate() { this.dirty = true; }

  get duration() { return this.project ? totalDuration(this.project) : 0; }

  // ---------- Audio ----------
  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS 17+ */ }
      for (const e of this.els.values()) this._connectEl(e);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _connectEl(e) {
    if (!this.ctx || e.gain) return;
    try {
      e.node = this.ctx.createMediaElementSource(e.el);
      e.gain = this.ctx.createGain();
      e.gain.gain.value = 0;
      e.node.connect(e.gain).connect(this.ctx.destination);
    } catch (err) {
      console.warn('MediaElementSource indisponible', err);
    }
  }

  _setElVolume(e, v) {
    if (e.gain) e.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    else e.el.volume = Math.max(0, Math.min(1, v));
  }

  // ---------- Éléments vidéo ----------
  getEl(mediaId) {
    let e = this.els.get(mediaId);
    if (e) return e;
    const m = this.media.get(mediaId);
    if (!m) return null;
    const el = document.createElement('video');
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    if (!m.url) m.url = URL.createObjectURL(m.blob);
    el.src = m.url;
    this.pool.appendChild(el);
    e = { el, mediaId, seeking: false, pending: null, node: null, gain: null };
    el.addEventListener('seeked', () => {
      e.seeking = false;
      if (e.pending != null) {
        const p = e.pending;
        e.pending = null;
        this._seekEl(e, p);
      }
      this.invalidate();
    });
    el.addEventListener('loadeddata', () => this.invalidate());
    el.addEventListener('canplay', () => this.invalidate());
    el.addEventListener('error', () => this.dispatchEvent(new CustomEvent('error', { detail: `Lecture impossible : ${m.name}` })));
    el.volume = 1;
    this.els.set(mediaId, e);
    this._connectEl(e);
    return e;
  }

  _dropEl(id, e) {
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    e.el.remove();
    this.els.delete(id);
  }

  _seekEl(e, t) {
    if (e.seeking) { e.pending = t; return; }
    if (Math.abs(e.el.currentTime - t) < 0.001 && e.el.readyState >= 2) { this.invalidate(); return; }
    e.seeking = true;
    e.el.currentTime = t;
  }

  // ---------- Transport ----------
  play() {
    if (!this.project || this.playing) return;
    const dur = this.duration;
    if (dur <= 0) return;
    if (this.time >= dur - 0.05) this.time = 0;
    const ctx = this.ensureCtx();
    this.override = null;
    this.playing = true;
    this.t0 = this.time;
    this.ctx0 = ctx.currentTime + 0.06;
    this._startTracks(this.t0, this.ctx0);
    this.active = null;
    this.dispatchEvent(new Event('state'));
  }

  pause() {
    if (!this.playing) return;
    this.time = this._masterTime();
    this.playing = false;
    this._stopTracks();
    for (const e of this.els.values()) {
      e.el.pause();
      e.el.playbackRate = 1;
      this._setElVolume(e, 0);
    }
    this.active = null;
    this.invalidate();
    this.dispatchEvent(new Event('state'));
    this.dispatchEvent(new Event('time'));
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    const dur = this.duration;
    t = Math.max(0, Math.min(dur, t));
    if (this.playing) {
      this._stopTracks();
      this.time = t;
      this.t0 = t;
      this.ctx0 = this.ctx.currentTime + 0.06;
      this._startTracks(this.t0, this.ctx0);
      this.active = null;
    } else {
      this.time = t;
    }
    this.invalidate();
    this.dispatchEvent(new Event('time'));
  }

  // Affiche une image précise d'un clip (pendant un rognage).
  showClipFrame(clip, srcTime) {
    this.override = { clip, srcTime };
    this.invalidate();
  }

  clearOverride() {
    this.override = null;
    this.invalidate();
  }

  _masterTime() {
    if (!this.playing || !this.ctx) return this.time;
    return this.t0 + Math.max(0, this.ctx.currentTime - this.ctx0);
  }

  _startTracks(t0, when) {
    const ctx = this.ctx;
    this._stopTracks();
    const dur = this.duration;
    for (const a of this.project.audio) {
      const m = this.media.get(a.mediaId);
      const buf = m && m.audioBuffer;
      if (!buf) continue;
      const len = audioDur(a);
      const end = Math.min(a.start + len, dur);
      if (end <= t0) continue;
      const startTl = Math.max(t0, a.start);
      const offset = a.in + (startTl - a.start);
      if (offset < 0 || offset >= buf.duration) continue;
      const playLen = end - startTl;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      const at = when + (startTl - t0);
      // Enveloppe de volume (fondus).
      const vol = a.volume;
      const gainAt = tl => {
        let f = 1;
        const local = tl - a.start;
        if (a.fadeIn > 0) f = Math.min(f, local / a.fadeIn);
        if (a.fadeOut > 0) f = Math.min(f, (len - local) / a.fadeOut);
        f = Math.min(f, fadeFactor(this.project, tl, dur));
        return vol * Math.max(0, Math.min(1, f));
      };
      g.gain.setValueAtTime(gainAt(startTl), at);
      const keys = new Set([a.start + a.fadeIn, a.start + len - a.fadeOut, this.project.fadeIn, dur - this.project.fadeOut, end]);
      [...keys].filter(k => k > startTl && k <= end).sort((x, y) => x - y)
        .forEach(k => g.gain.linearRampToValueAtTime(gainAt(k), at + (k - startTl)));
      src.connect(g).connect(ctx.destination);
      src.start(at, offset, playLen);
      this.trackNodes.push({ src, g });
    }
  }

  _stopTracks() {
    for (const { src, g } of this.trackNodes) {
      try { src.stop(); } catch { /* déjà arrêté */ }
      src.disconnect();
      g.disconnect();
    }
    this.trackNodes = [];
  }

  // ---------- Rendu ----------
  layoutCanvas(containerW, containerH) {
    if (!this.project) return;
    const aspect = projectAspect(this.project, this.media);
    let w = Math.min(containerW, containerH * aspect);
    let h = w / aspect;
    w = Math.floor(w); h = Math.floor(h);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let bw = w * dpr, bh = h * dpr;
    const k = Math.min(1, MAX_PREVIEW_SIDE / Math.max(bw, bh));
    this.renderer.resize(Math.max(2, Math.round(bw * k)), Math.max(2, Math.round(bh * k)));
    this.invalidate();
  }

  _loop() {
    requestAnimationFrame(this._loop);
    if (!this.project) return;
    if (this.playing) this._tickPlaying();
    else this._tickPaused();
  }

  _tickPlaying() {
    const dur = this.duration;
    let t = this._masterTime();
    if (t >= dur) {
      this.time = dur;
      this.pause();
      return;
    }
    this.time = t;
    this.dispatchEvent(new Event('time'));
    const it = clipAt(this.project, t);
    if (!it) { this.renderer.drawBlack(); return; }
    const e = this.getEl(it.clip.mediaId);
    if (!e) return;
    const target = it.clip.in + (t - it.start);

    if (!this.active || this.active.clipId !== it.clip.id) {
      const prev = this.active && this.els.get(this.active.mediaId);
      if (prev && prev !== e) { prev.el.pause(); this._setElVolume(prev, 0); }
      // Clip suivant contigu dans le même fichier : on continue sans recaler.
      if (Math.abs(e.el.currentTime - target) > 0.08) this._seekEl(e, target);
      this.active = { clipId: it.clip.id, mediaId: it.clip.mediaId, prerolled: false };
      e.el.playbackRate = 1;
      const p = e.el.play();
      if (p && p.catch) p.catch(() => { /* lecture bloquée */ });
    }
    this._setElVolume(e, it.clip.muted ? 0 : it.clip.volume * fadeFactor(this.project, t, dur));

    // Correction de dérive vidéo / horloge audio.
    if (!e.seeking && e.el.readyState >= 2) {
      const diff = e.el.currentTime - target;
      if (Math.abs(diff) > 0.35) this._seekEl(e, target + 0.05);
      else if (Math.abs(diff) > 0.03) e.el.playbackRate = Math.max(0.9, Math.min(1.1, 1 - diff * 1.5));
      else e.el.playbackRate = 1;
      if (e.el.paused) e.el.play().catch(() => {});
    }

    // Pré-chargement du clip suivant.
    if (!this.active.prerolled && it.end - t < 1.2) {
      const items = layout(this.project);
      const next = items[it.index + 1];
      if (next && next.clip.mediaId !== it.clip.mediaId) {
        const ne = this.getEl(next.clip.mediaId);
        if (ne) { ne.el.pause(); this._seekEl(ne, next.clip.in); }
      }
      this.active.prerolled = true;
    }
    this._render(it.clip, e, t);
  }

  _tickPaused() {
    if (!this.dirty) return;
    let clip, srcTime, t = this.time;
    if (this.override) {
      clip = this.override.clip;
      srcTime = this.override.srcTime;
    } else {
      const it = clipAt(this.project, t);
      if (!it) { this.renderer.drawBlack(); this.dirty = false; return; }
      clip = it.clip;
      srcTime = clip.in + (Math.min(t, it.end - 0.001) - it.start);
    }
    const e = this.getEl(clip.mediaId);
    if (!e) return;
    if (Math.abs(e.el.currentTime - srcTime) > 0.001 || e.pending != null) this._seekEl(e, srcTime);
    if (e.seeking || e.el.readyState < 2) return; // on attend 'seeked'
    this._render(clip, e, this.override ? null : t);
    this.dirty = false;
  }

  _render(clip, e, t) {
    const m = this.media.get(clip.mediaId);
    const el = e.el;
    if (el.readyState < 2 || !m) return;
    try {
      this.renderer.upload(el, el.videoWidth, el.videoHeight);
    } catch (err) {
      console.warn(err);
      return;
    }
    const aspect = projectAspect(this.project, this.media);
    // En général l'élément <video> applique déjà la rotation du fichier (Chrome) ; on le
    // vérifie une fois par média, sinon on applique la rotation nous-mêmes.
    if (m.rotation && m.elementOriented == null && !this.playing) this._probeOrientation(m, e);
    const fileRot = m.elementOriented === false ? m.rotation || 0 : 0;
    this.renderer.draw({
      rect: cropRect(clip, m, aspect),
      rot: (fileRot + (clip.rotate || 0)) / 90,
      flip: clip.flip,
      adjust: clip.adjust,
      fade: t == null ? 1 : fadeFactor(this.project, t, this.duration),
    });
  }

  // Compare l'image de l'élément <video> à une image décodée par Mediabunny
  // (orientation connue) pour savoir si le navigateur applique la rotation.
  async _probeOrientation(m, e) {
    if (m._probing) return;
    m._probing = true;
    const N = 16;
    let input = null, pr = null;
    try {
      const t = e.el.currentTime;
      input = openInput(m.blob);
      const vt = await input.getPrimaryVideoTrack();
      const base = await input.getFirstTimestamp().catch(() => 0);
      const sink = new CanvasSink(vt, { width: N, height: N, fit: 'fill' });
      const wc = await sink.getCanvas(base + t);
      if (!wc) return;
      const ref = wc.canvas.getContext('2d').getImageData(0, 0, N, N).data;
      if (Math.abs(e.el.currentTime - t) > 0.01 || e.el.readyState < 2) return; // l'élément a bougé : on réessaiera
      const pc = document.createElement('canvas');
      pc.width = pc.height = N;
      pr = new Renderer(pc, { preserveDrawingBuffer: true });
      const gl = pr.gl;
      const err = rot => {
        pr.upload(e.el, e.el.videoWidth, e.el.videoHeight);
        pr.draw({ rect: { x: 0, y: 0, w: 1, h: 1 }, rot });
        const px = new Uint8Array(N * N * 4);
        gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let s = 0;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const a = ((N - 1 - y) * N + x) * 4, b = (y * N + x) * 4;
          for (let c = 0; c < 3; c++) s += Math.abs(px[a + c] - ref[b + c]);
        }
        return s;
      };
      const asIs = err(0), rotated = err(m.rotation / 90);
      m.elementOriented = asIs <= rotated;
      this.invalidate();
    } catch (err) {
      console.warn('Détection d\'orientation impossible', err);
    } finally {
      m._probing = false;
      if (input) input.dispose();
      if (pr) { const l = pr.gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); }
    }
  }

  destroy() {
    this.pause();
    for (const [id, e] of this.els) this._dropEl(id, e);
  }
}
