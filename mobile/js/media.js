// Import et analyse des médias (vidéo / audio) via Mediabunny (WebCodecs).
import { Input, BlobSource, ALL_FORMATS, AudioBufferSink, CanvasSink } from 'mediabunny';
import { uid } from './project.js';

export const ENV_RATE = 1000; // enveloppe audio : 1 valeur par milliseconde

let decodeCtx = null;
function getDecodeCtx() {
  // OfflineAudioContext à 48 kHz : decodeAudioData rééchantillonne directement.
  if (!decodeCtx) decodeCtx = new OfflineAudioContext(2, 1, 48000);
  return decodeCtx;
}

export const hasAudioDecoder = () => typeof AudioDecoder !== 'undefined';

export function openInput(blob) {
  return new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
}

// Analyse un fichier et retourne les métadonnées du média.
export async function probe(file, projectId) {
  const media = {
    id: uid(),
    projectId,
    name: file.name || 'média',
    blob: file,
    kind: 'video',
    duration: 0,
    width: 0,
    height: 0,
    rotation: 0,
    fps: 30,
    hasAudio: false,
    env: null,
  };
  let input;
  try {
    input = openInput(file);
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    if (vt) {
      if (!(await vt.canDecode())) {
        const codec = await vt.getCodec();
        throw new Error(`Codec vidéo « ${codec || 'inconnu'} » non décodable par ce navigateur.`);
      }
      media.width = vt.displayWidth;
      media.height = vt.displayHeight;
      media.rotation = vt.rotation || 0;
      try {
        const stats = await vt.computePacketStats(120);
        if (stats && stats.averagePacketRate) media.fps = Math.min(120, Math.max(1, stats.averagePacketRate));
      } catch { /* garde 30 */ }
      media.hasAudio = !!at && ((await at.canDecode()) || !hasAudioDecoder());
      media.duration = await input.computeDuration();
    } else if (at) {
      media.kind = 'audio';
      media.hasAudio = true;
      media.duration = await input.computeDuration();
    } else {
      throw new Error('Aucune piste audio ou vidéo trouvée.');
    }
  } catch (err) {
    // Repli pour les fichiers audio que Mediabunny ne lit pas : Web Audio.
    if ((file.type || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|aif|aiff|caf)$/i.test(media.name)) {
      const buf = await decodeAudioBlob(file);
      media.kind = 'audio';
      media.hasAudio = true;
      media.duration = buf.duration;
      media.audioBuffer = buf;
      media.width = media.height = 0;
    } else {
      throw err;
    }
  } finally {
    if (input) input.dispose();
  }
  if (!media.duration || !isFinite(media.duration)) throw new Error('Durée du média illisible.');
  return media;
}

export async function decodeAudioBlob(blob) {
  const ab = await blob.arrayBuffer();
  return await getDecodeCtx().decodeAudioData(ab);
}

// Enveloppe RMS (1 ms) d'un AudioBuffer complet.
export function envFromAudioBuffer(buf) {
  const n = Math.ceil(buf.duration * ENV_RATE);
  const env = new Float32Array(n);
  const sr = buf.sampleRate;
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const per = sr / ENV_RATE;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * per), b = Math.min(buf.length, Math.floor((i + 1) * per));
    let s = 0, cnt = 0;
    for (let j = a; j < b; j++) {
      let v = 0;
      for (const ch of chans) v += ch[j];
      v /= chans.length;
      s += v * v;
      cnt++;
    }
    env[i] = cnt ? Math.sqrt(s / cnt) : 0;
  }
  return env;
}

// Enveloppe audio d'un fichier (décodage progressif, sans tout charger en mémoire).
export async function computeEnvelope(media, onProgress) {
  if (media.audioBuffer) return envFromAudioBuffer(media.audioBuffer);
  if (!hasAudioDecoder()) {
    try { return envFromAudioBuffer(await decodeAudioBlob(media.blob)); } catch { return null; }
  }
  const input = openInput(media.blob);
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at) return null;
    const n = Math.ceil(media.duration * ENV_RATE) + 1;
    const sum = new Float32Array(n);
    const cnt = new Uint16Array(n);
    const sink = new AudioBufferSink(at);
    let lastReport = 0;
    for await (const { buffer, timestamp } of sink.buffers()) {
      const sr = buffer.sampleRate;
      const chans = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
      const nc = chans.length;
      for (let j = 0; j < buffer.length; j++) {
        const idx = Math.floor((timestamp + j / sr) * ENV_RATE);
        if (idx < 0 || idx >= n) continue;
        let v = 0;
        for (let c = 0; c < nc; c++) v += chans[c][j];
        v /= nc;
        sum[idx] += v * v;
        if (cnt[idx] < 65535) cnt[idx]++;
      }
      if (onProgress && timestamp - lastReport > 5) {
        lastReport = timestamp;
        onProgress(Math.min(1, timestamp / media.duration));
      }
    }
    for (let i = 0; i < n; i++) sum[i] = cnt[i] ? Math.sqrt(sum[i] / cnt[i]) : 0;
    return sum;
  } catch (err) {
    console.warn('Enveloppe audio impossible', err);
    return null;
  } finally {
    input.dispose();
  }
}

// Miniatures pour la timeline.
export async function computeThumbs(media, height = 96) {
  if (media.kind !== 'video') return [];
  const input = openInput(media.blob);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) return [];
    const count = Math.max(2, Math.min(48, Math.ceil(media.duration / 1.5)));
    const first = await vt.getFirstTimestamp().catch(() => 0);
    const times = [];
    for (let i = 0; i < count; i++) times.push(first + (media.duration * (i + 0.5)) / count);
    const sink = new CanvasSink(vt, { height, poolSize: 2 });
    const thumbs = [];
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      const t = times[i++] - first;
      if (wc) thumbs.push({ t, img: await createImageBitmap(wc.canvas) });
    }
    return thumbs;
  } catch (err) {
    console.warn('Miniatures impossibles', err);
    return [];
  } finally {
    input.dispose();
  }
}

export function mediaRecord(media) {
  // Ce qui est sauvegardé dans IndexedDB.
  const { id, projectId, name, blob, kind, duration, width, height, rotation, fps, hasAudio, env } = media;
  return { id, projectId, name, blob, kind, duration, width, height, rotation, fps, hasAudio, env };
}
