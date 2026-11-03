// Synchronisation automatique : aligne une piste audio (ex. prise studio de ta
// cover) sur le son capté par la caméra, par intercorrélation des attaques.
import { ENV_RATE } from './media.js';
import { layout, audioDur } from './project.js';

// Fonction d'attaque : hausse de l'énergie (log) lissée, normalisée.
function onsets(env) {
  const n = env.length;
  const out = new Float32Array(n);
  const LAG = 10; // 10 ms
  const sm = new Float32Array(n);
  let acc = 0;
  const W = 5;
  for (let i = 0; i < n; i++) {
    acc += Math.log(1e-4 + env[i]);
    if (i >= W) acc -= Math.log(1e-4 + env[i - W]);
    sm[i] = acc / Math.min(i + 1, W);
  }
  for (let i = LAG; i < n; i++) out[i] = Math.max(0, sm[i] - sm[i - LAG]);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n || 1;
  let v = 0;
  for (let i = 0; i < n; i++) { out[i] -= mean; v += out[i] * out[i]; }
  const sd = Math.sqrt(v / (n || 1)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

// FFT radix-2 en place.
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Retourne le décalage d (échantillons) maximisant sum_t ref[t + d] * sig[t].
export function crossCorrelate(ref, sig) {
  const need = ref.length + sig.length;
  let n = 1;
  while (n < need) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(ref);
  br.set(sig);
  fft(ar, ai, false);
  fft(br, bi, false);
  // A * conj(B)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  // Lags valides : -(sig.length-1) .. ref.length-1
  let best = -Infinity, bestLag = 0;
  const score = lag => ar[(lag + n) % n];
  for (let lag = -(sig.length - 1); lag < ref.length; lag++) {
    const v = score(lag);
    if (v > best) { best = v; bestLag = lag; }
  }
  // Deuxième meilleur pic (hors ±80 ms) pour estimer la confiance.
  let second = -Infinity;
  const excl = Math.round(0.08 * ENV_RATE);
  for (let lag = -(sig.length - 1); lag < ref.length; lag++) {
    if (Math.abs(lag - bestLag) <= excl) continue;
    const v = score(lag);
    if (v > second) second = v;
  }
  return { lag: bestLag, peak: best, ratio: second > 0 ? best / second : 10 };
}

// Construit l'enveloppe du son caméra sur toute la timeline.
function timelineEnvelope(project, media) {
  const items = layout(project);
  const total = items.length ? items[items.length - 1].end : 0;
  const n = Math.ceil(total * ENV_RATE);
  const env = new Float32Array(n);
  let any = false;
  for (const it of items) {
    const m = media.get(it.clip.mediaId);
    if (!m || !m.env) continue;
    any = true;
    const a = Math.round(it.start * ENV_RATE), b = Math.round(it.end * ENV_RATE);
    const off = Math.round(it.clip.in * ENV_RATE);
    for (let i = a; i < b && i < n; i++) env[i] = m.env[off + (i - a)] || 0;
  }
  return any ? env : null;
}

// Calcule la position de départ idéale (secondes de timeline) d'une piste audio.
export function autoSync(project, media, item) {
  const m = media.get(item.mediaId);
  if (!m || !m.env) throw new Error('Analyse de la piste audio pas encore terminée.');
  const ref = timelineEnvelope(project, media);
  if (!ref) throw new Error('Le son des vidéos n\'est pas encore analysé (ou les vidéos n\'ont pas de son).');
  // Signal : la piste complète (on ignore le rognage pour trouver l'alignement absolu).
  const sig = m.env;
  // Limite la taille pour rester rapide sur mobile (~12 min max de chaque côté).
  const MAX = 12 * 60 * ENV_RATE;
  const r = crossCorrelate(onsets(ref.subarray(0, MAX)), onsets(sig.subarray(0, MAX)));
  // ref[t + lag] ~ sig[t]  => l'instant 0 du fichier audio tombe à lag/ENV_RATE sur la timeline.
  const fileZeroAt = r.lag / ENV_RATE;
  let start = fileZeroAt + item.in;
  let inPoint = item.in;
  if (start < 0) {
    inPoint = item.in - start;
    start = 0;
  }
  const len = audioDur(item);
  return {
    start,
    in: inPoint,
    out: Math.min(m.duration, inPoint + len),
    confidence: r.ratio >= 1.6 ? 'haute' : r.ratio >= 1.2 ? 'moyenne' : 'faible',
    ratio: r.ratio,
  };
}
