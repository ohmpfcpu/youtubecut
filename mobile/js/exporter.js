// Export : décodage WebCodecs -> shader WebGL -> encodage matériel (H.264/HEVC) -> MP4.
// L'audio (son des clips + pistes importées) est mixé par segments via OfflineAudioContext.
import {
  Output, Mp4OutputFormat, BufferTarget, StreamTarget, CanvasSource, AudioBufferSource,
  VideoSampleSink, AudioBufferSink, getFirstEncodableVideoCodec, canEncodeAudio,
} from 'mediabunny';
import { layout, totalDuration, projectAspect, cropRect, outputSize, fadeFactor, audioDur } from './project.js';
import { Renderer } from './renderer.js';
import { openInput, decodeAudioBlob, hasAudioDecoder } from './media.js';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';

const SR = 48000;
const SEGMENT = 10; // secondes d'audio mixées à la fois

export const RESOLUTIONS = [
  { id: 480, label: '480p' },
  { id: 720, label: '720p' },
  { id: 1080, label: '1080p' },
  { id: 1440, label: '1440p' },
  { id: 2160, label: '4K' },
];
export const QUALITIES = [
  { id: 'eco', label: 'Économie', bpp: 0.045 },
  { id: 'standard', label: 'Standard', bpp: 0.075 },
  { id: 'high', label: 'Haute', bpp: 0.12 },
  { id: 'max', label: 'Max', bpp: 0.2 },
];
export const CODECS = [
  { id: 'avc', label: 'H.264 (compatible partout)', factor: 1 },
  { id: 'hevc', label: 'HEVC / H.265 (fichier plus léger)', factor: 0.6 },
];
export const FPS_CHOICES = ['auto', 24, 25, 30, 50, 60];

export function resolveFps(project, media, setting) {
  if (setting !== 'auto') return Number(setting);
  let f = 0;
  for (const c of project.clips) f = Math.max(f, (media.get(c.mediaId) || {}).fps || 0);
  if (!f) f = 30;
  const std = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  let best = 30;
  for (const s of std) if (Math.abs(s - f) < Math.abs(best - f)) best = s;
  return Math.min(60, Math.round(best * 1000) / 1000);
}

export function estimate(project, media, s) {
  const aspect = projectAspect(project, media);
  const size = outputSize(aspect, s.res);
  const fps = resolveFps(project, media, s.fps);
  const q = QUALITIES.find(x => x.id === s.quality) || QUALITIES[1];
  const codec = CODECS.find(x => x.id === s.codec) || CODECS[0];
  const vbr = Math.round(Math.min(80e6, Math.max(4e5, size.width * size.height * fps * q.bpp * codec.factor)));
  const dur = totalDuration(project);
  const bytes = ((vbr + (s.audioBitrate || 192000)) * dur) / 8;
  return { ...size, fps, videoBitrate: vbr, bytes, duration: dur };
}

async function pickAudioCodec(bitrate) {
  const opts = { numberOfChannels: 2, sampleRate: SR, bitrate };
  if (await canEncodeAudio('aac', opts)) return 'aac';
  try {
    const mod = await import('../vendor/mediabunny-aac-encoder.min.mjs');
    mod.registerAacEncoder();
    if (await canEncodeAudio('aac', opts)) return 'aac';
  } catch (err) {
    console.warn('Encodeur AAC de secours indisponible', err);
  }
  if (await canEncodeAudio('opus', opts)) return 'opus';
  return null;
}

// Les encodeurs AAC ajoutent un « priming » (souvent 1024 échantillons, ~21 ms) qui
// retarderait le son. On mesure le retard réel de la chaîne encodeur + conteneur
// avec une impulsion, puis on le compense (liste d'édition MP4).
const delayCache = new Map();
async function measureAudioDelay(codec, bitrate) {
  const key = codec + bitrate;
  if (delayCache.has(key)) return delayCache.get(key);
  let delay = 0;
  try {
    const len = Math.round(0.6 * SR), at = Math.round(0.2 * SR);
    const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SR });
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i <= 48; i++) d[at + i] = 0.9 * Math.sin((i / 48) * Math.PI) ** 2;
    }
    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const src = new AudioBufferSource({ codec, bitrate });
    out.addAudioTrack(src);
    await out.start();
    await src.add(buf);
    await out.finalize();
    const input = new Input({ source: new BufferSource(out.target.buffer), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      let best = 0, bestT = null;
      for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
        const d = buffer.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const v = Math.abs(d[i]);
          if (v > best) { best = v; bestT = timestamp + i / buffer.sampleRate; }
        }
      }
      if (bestT != null && best > 0.05) {
        const measured = bestT - (at + 24) / SR;
        if (Math.abs(measured) < 0.2) delay = measured;
      }
    } finally {
      input.dispose();
    }
  } catch (err) {
    console.warn('Mesure du retard audio impossible', err);
  }
  delayCache.set(key, delay);
  return delay;
}

async function openTarget() {
  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      const root = await navigator.storage.getDirectory();
      // Nettoyage des exports précédents.
      try {
        for await (const name of root.keys()) if (name.startsWith('export-')) await root.removeEntry(name);
      } catch { /* ignoré */ }
      const name = `export-${Date.now()}.mp4`;
      const fh = await root.getFileHandle(name, { create: true });
      if (fh.createWritable) {
        const writable = await fh.createWritable();
        return { target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }), fh, root, name, streamed: true };
      }
    }
  } catch (err) {
    console.warn('OPFS indisponible, export en mémoire', err);
  }
  return { target: new BufferTarget(), streamed: false };
}

class MediaReaders {
  constructor(media) { this.media = media; this.cache = new Map(); }
  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const m = this.media.get(id);
    const input = openInput(m.blob);
    const vt = m.kind === 'video' ? await input.getPrimaryVideoTrack() : null;
    const at = m.hasAudio ? await input.getPrimaryAudioTrack() : null;
    const base = await input.getFirstTimestamp().catch(() => 0);
    const r = { input, vt, at, base, audioSink: null, full: null };
    if (at && hasAudioDecoder() && (await at.canDecode())) r.audioSink = new AudioBufferSink(at);
    else if (m.hasAudio) {
      // Navigateur sans AudioDecoder (anciens Safari) : décodage complet via Web Audio.
      try { r.full = await decodeAudioBlob(m.blob); } catch (err) { console.warn(err); }
    }
    this.cache.set(id, r);
    return r;
  }
  dispose() { for (const r of this.cache.values()) r.input.dispose(); this.cache.clear(); }
}

// Lit l'audio d'un clip vidéo entre s0 et s1 (temps du fichier) dans un AudioBuffer.
async function readAudioRange(reader, ctx, s0, s1) {
  if (reader.full) {
    const f = reader.full, sr = f.sampleRate;
    const a = Math.max(0, Math.round(s0 * sr)), len = Math.max(1, Math.round((s1 - s0) * sr));
    const out = ctx.createBuffer(f.numberOfChannels, len, sr);
    for (let c = 0; c < f.numberOfChannels; c++) out.getChannelData(c).set(f.getChannelData(c).subarray(a, a + len));
    return out;
  }
  let out = null, sr = 0, len = 0;
  for await (const { buffer, timestamp } of reader.audioSink.buffers(Math.max(0, reader.base + s0 - 0.05), reader.base + s1)) {
    if (!out) {
      sr = buffer.sampleRate;
      len = Math.max(1, Math.ceil((s1 - s0) * sr));
      out = ctx.createBuffer(Math.min(2, buffer.numberOfChannels), len, sr);
    }
    const off = Math.round((timestamp - reader.base - s0) * sr);
    for (let c = 0; c < out.numberOfChannels; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const dst = out.getChannelData(c);
      const from = Math.max(0, -off), to = Math.min(src.length, len - off);
      if (to > from) dst.set(src.subarray(from, to), off + from);
    }
  }
  return out;
}

async function renderAudioSegment(project, media, readers, T0, T1, total) {
  const len = Math.max(1, Math.round((T1 - T0) * SR));
  const ctx = new OfflineAudioContext(2, len, SR);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  // Fondus globaux.
  const keys = [T0, T1, project.fadeIn, total - project.fadeOut].filter(k => k >= T0 && k <= T1).sort((a, b) => a - b);
  master.gain.setValueAtTime(fadeFactor(project, T0, total), 0);
  for (const k of keys) master.gain.linearRampToValueAtTime(fadeFactor(project, k, total), k - T0);

  // Son d'origine des clips.
  for (const it of layout(project)) {
    const c = it.clip;
    const m = media.get(c.mediaId);
    if (!m || !m.hasAudio || c.muted || c.volume <= 0) continue;
    const a = Math.max(T0, it.start), b = Math.min(T1, it.end);
    if (b <= a) continue;
    const r = await readers.get(c.mediaId);
    if (!r.audioSink && !r.full) continue;
    const s0 = c.in + (a - it.start);
    const buf = await readAudioRange(r, ctx, s0, s0 + (b - a));
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = c.volume;
    src.connect(g).connect(master);
    src.start(a - T0);
  }

  // Pistes audio importées.
  for (const item of project.audio) {
    const m = media.get(item.mediaId);
    if (!m || !m.audioBuffer || item.volume <= 0) continue;
    const L = audioDur(item);
    const a = Math.max(T0, item.start), b = Math.min(T1, item.start + L, total);
    if (b <= a) continue;
    const src = ctx.createBufferSource();
    src.buffer = m.audioBuffer;
    const g = ctx.createGain();
    const gainAt = tl => {
      const local = tl - item.start;
      let f = 1;
      if (item.fadeIn > 0) f = Math.min(f, local / item.fadeIn);
      if (item.fadeOut > 0) f = Math.min(f, (L - local) / item.fadeOut);
      return item.volume * Math.max(0, Math.min(1, f));
    };
    g.gain.setValueAtTime(gainAt(a), a - T0);
    [item.start + item.fadeIn, item.start + L - item.fadeOut, b]
      .filter(k => k > a && k <= b).sort((x, y) => x - y)
      .forEach(k => g.gain.linearRampToValueAtTime(gainAt(k), k - T0));
    src.connect(g).connect(master);
    src.start(a - T0, item.in + (a - item.start), b - a);
  }
  return await ctx.startRendering();
}

function projectHasAudio(project, media) {
  if (project.audio.some(a => media.get(a.mediaId) && a.volume > 0)) return true;
  return project.clips.some(c => !c.muted && c.volume > 0 && (media.get(c.mediaId) || {}).hasAudio);
}

export class ExportCanceled extends Error {
  constructor() { super('Export annulé'); this.name = 'ExportCanceled'; }
}

export async function exportProject({ project, media, settings, onProgress, signal }) {
  const total = totalDuration(project);
  if (total <= 0) throw new Error('Rien à exporter : ajoute au moins une vidéo.');
  const est = estimate(project, media, settings);
  const { width, height, fps, videoBitrate } = est;
  const aspect = projectAspect(project, media);

  const preferred = settings.codec || 'avc';
  const codec = await getFirstEncodableVideoCodec([preferred, 'avc', 'hevc', 'vp9', 'av1'], { width, height, bitrate: videoBitrate });
  if (!codec) throw new Error(`Aucun encodeur vidéo disponible en ${width}×${height} sur cet appareil. Essaie une résolution plus basse.`);

  const withAudio = projectHasAudio(project, media);
  const audioCodec = withAudio ? await pickAudioCodec(settings.audioBitrate || 192000) : null;
  if (withAudio && !audioCodec) throw new Error('Aucun encodeur audio disponible sur ce navigateur.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new Renderer(canvas, { preserveDrawingBuffer: true });

  const tgt = await openTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: tgt.streamed ? false : 'in-memory' }),
    target: tgt.target,
  });
  const videoSource = new CanvasSource(canvas, {
    codec,
    bitrate: videoBitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource = null;
  if (audioCodec) {
    const abr = settings.audioBitrate || 192000;
    const delay = await measureAudioDelay(audioCodec, abr);
    audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: abr }, { startTimestamp: -delay });
    output.addAudioTrack(audioSource);
  }

  const readers = new MediaReaders(media);
  const started = performance.now();
  let audioPushed = 0;
  const pushAudioUntil = async t => {
    if (!audioSource) return;
    while (audioPushed < Math.min(t, total) - 1e-9) {
      const T1 = Math.min(total, audioPushed + SEGMENT);
      const buf = await renderAudioSegment(project, media, readers, audioPushed, T1, total);
      await audioSource.add(buf);
      audioPushed = T1;
    }
  };
  const check = () => { if (signal && signal.aborted) throw new ExportCanceled(); };

  try {
    await output.start();
    await pushAudioUntil(Math.min(total, SEGMENT));
    const totalFrames = Math.max(1, Math.round(total * fps));
    let frame = 0;

    for (const it of layout(project)) {
      const clip = it.clip;
      const m = media.get(clip.mediaId);
      const r = await readers.get(clip.mediaId);
      const rect = cropRect(clip, m, aspect);
      const k0 = Math.round(it.start * fps), k1 = Math.min(totalFrames, Math.round(it.end * fps));
      if (k1 <= k0) continue;
      const sink = new VideoSampleSink(r.vt);
      const iter = sink.samples(Math.max(0, r.base + clip.in - 0.25), r.base + clip.out + 0.1);
      let cur = null, nxt = null, done = false;
      const pull = async () => {
        if (done) return null;
        const res = await iter.next();
        if (res.done) { done = true; return null; }
        return res.value;
      };
      try {
        cur = await pull();
        nxt = await pull();
        for (let k = k0; k < k1; k++) {
          check();
          const t = k / fps;
          const s = r.base + clip.in + (t - it.start);
          while (nxt && nxt.timestamp <= s + 1e-4) {
            cur.close();
            cur = nxt;
            nxt = await pull();
          }
          if (cur) {
            const src = cur.toCanvasImageSource();
            renderer.upload(src, src.displayWidth || src.width, src.displayHeight || src.height);
            renderer.draw({
              rect,
              rot: (((cur.rotation || 0) + (clip.rotate || 0)) / 90),
              flip: !!clip.flip !== !!cur.flip,
              adjust: clip.adjust,
              fade: fadeFactor(project, t, total),
            });
          } else {
            renderer.drawBlack();
          }
          await pushAudioUntil(t + 1);
          await videoSource.add(t, 1 / fps);
          frame++;
          if (onProgress && (frame % 5 === 0 || frame === totalFrames)) {
            const el = (performance.now() - started) / 1000;
            const p = frame / totalFrames;
            onProgress({ progress: p, elapsed: el, eta: p > 0.01 ? el / p - el : null, speed: (frame / fps) / el });
          }
        }
      } finally {
        if (cur) cur.close();
        if (nxt) nxt.close();
        await iter.return();
      }
    }
    check();
    await pushAudioUntil(total);
    await output.finalize();
    let blob;
    if (tgt.streamed) blob = await tgt.fh.getFile();
    else blob = new Blob([tgt.target.buffer], { type: 'video/mp4' });
    return { blob, width, height, fps, codec, audioCodec, duration: total, elapsed: (performance.now() - started) / 1000 };
  } catch (err) {
    try { await output.cancel(); } catch { /* ignoré */ }
    if (tgt.streamed) { try { await tgt.root.removeEntry(tgt.name); } catch { /* ignoré */ } }
    throw err;
  } finally {
    readers.dispose();
    const lose = renderer.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }
}
