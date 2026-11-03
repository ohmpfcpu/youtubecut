// Modèle de projet : clips vidéo (séquentiels), pistes audio, réglages.
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export const ADJUST_DEFS = [
  { key: 'exposure', label: 'Exposition', min: -100, max: 100 },
  { key: 'brightness', label: 'Luminosité', min: -100, max: 100 },
  { key: 'contrast', label: 'Contraste', min: -100, max: 100 },
  { key: 'highlights', label: 'Hautes lumières', min: -100, max: 100 },
  { key: 'shadows', label: 'Ombres', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'temperature', label: 'Température', min: -100, max: 100 },
  { key: 'tint', label: 'Teinte (vert ↔ magenta)', min: -100, max: 100 },
  { key: 'sharpen', label: 'Netteté', min: 0, max: 100 },
  { key: 'vignette', label: 'Vignettage', min: 0, max: 100 },
];

export const defaultAdjust = () => Object.fromEntries(ADJUST_DEFS.map(d => [d.key, 0]));
export const isNeutralAdjust = a => ADJUST_DEFS.every(d => !a || !a[d.key]);

export const ASPECTS = [
  { id: 'auto', label: 'Original' },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '21:9', label: '21:9', value: 21 / 9 },
];

export const MIN_CLIP = 0.1;

export function newProject(name) {
  const now = Date.now();
  return {
    id: uid(),
    name: name || 'Projet du ' + new Date(now).toLocaleDateString('fr-FR'),
    created: now,
    updated: now,
    aspect: 'auto',
    fadeIn: 0,
    fadeOut: 0,
    clips: [],
    audio: [],
    export: { res: 1080, fps: 'auto', quality: 'standard', codec: 'avc', audioBitrate: 192000 },
  };
}

export function newClip(media) {
  return {
    id: uid(),
    mediaId: media.id,
    in: 0,
    out: media.duration,
    volume: 1,
    muted: false,
    adjust: defaultAdjust(),
    crop: { cx: 0.5, cy: 0.5, zoom: 1 },
    rotate: 0,
    flip: false,
  };
}

export function newAudioItem(media, start = 0) {
  return { id: uid(), mediaId: media.id, start, in: 0, out: media.duration, volume: 1, fadeIn: 0, fadeOut: 0 };
}

export const clipDur = c => Math.max(0, c.out - c.in);
export const audioDur = a => Math.max(0, a.out - a.in);

export function layout(project) {
  let t = 0;
  return project.clips.map((clip, index) => {
    const start = t;
    t += clipDur(clip);
    return { clip, start, end: t, index };
  });
}

export function videoDuration(project) {
  return project.clips.reduce((s, c) => s + clipDur(c), 0);
}

// Durée de l'export : celle des clips vidéo (l'audio qui dépasse est coupé).
// Sans vidéo, on prend la fin de la dernière piste audio.
export function totalDuration(project) {
  const v = videoDuration(project);
  if (v > 0) return v;
  return project.audio.reduce((m, a) => Math.max(m, a.start + audioDur(a)), 0);
}

export function clipAt(project, t) {
  const items = layout(project);
  if (!items.length) return null;
  for (const it of items) if (t >= it.start && t < it.end) return it;
  return t < 0 ? items[0] : items[items.length - 1];
}

// Taille affichée d'un clip après rotation du fichier + rotation utilisateur.
export function orientedSize(media, clip) {
  const swap = clip && (clip.rotate % 180) !== 0;
  const w = media.width || 16, h = media.height || 9;
  return swap ? { w: h, h: w } : { w, h };
}

export function projectAspect(project, mediaMap) {
  const a = ASPECTS.find(x => x.id === project.aspect);
  if (a && a.value) return a.value;
  const first = project.clips[0];
  const m = first && mediaMap.get(first.mediaId);
  if (!m) return 16 / 9;
  const s = orientedSize(m, first);
  return s.w / s.h;
}

// Rectangle de recadrage (coordonnées normalisées dans l'image orientée).
// zoom = 1 : l'image remplit le cadre ; zoom < 1 : dézoom (bandes noires).
export function fillSize(media, clip, aspect) {
  const s = orientedSize(media, clip);
  const as = s.w / s.h;
  return aspect > as ? { fw: 1, fh: as / aspect } : { fw: aspect / as, fh: 1 };
}

export function fitZoom(media, clip, aspect) {
  const { fw, fh } = fillSize(media, clip, aspect);
  return Math.min(fw, fh);
}

export function cropRect(clip, media, aspect) {
  const { fw, fh } = fillSize(media, clip, aspect);
  const crop = clip.crop || { cx: 0.5, cy: 0.5, zoom: 1 };
  const zoom = Math.max(0.05, crop.zoom || 1);
  const w = fw / zoom, h = fh / zoom;
  const place = (c, size) => {
    if (size <= 1) return Math.min(Math.max(c - size / 2, 0), 1 - size);
    // Plus grand que l'image : on autorise un léger décalage, l'image reste visible.
    const lo = 1 - size, hi = 0;
    return Math.min(Math.max(c - size / 2, lo), hi);
  };
  return { x: place(crop.cx, w), y: place(crop.cy, h), w, h };
}

export function clampCrop(clip, media, aspect) {
  const r = cropRect(clip, media, aspect);
  clip.crop.cx = r.x + r.w / 2;
  clip.crop.cy = r.y + r.h / 2;
}

export function fadeFactor(project, t, total) {
  let f = 1;
  if (project.fadeIn > 0) f = Math.min(f, t / project.fadeIn);
  if (project.fadeOut > 0) f = Math.min(f, (total - t) / project.fadeOut);
  return Math.max(0, Math.min(1, f));
}

export function splitClip(project, t) {
  const it = clipAt(project, t);
  if (!it) return null;
  const local = t - it.start;
  if (local < MIN_CLIP || it.end - t < MIN_CLIP) return null;
  const c = it.clip;
  const second = structuredClone(c);
  second.id = uid();
  second.in = c.in + local;
  c.out = second.in;
  project.clips.splice(it.index + 1, 0, second);
  return second;
}

export function splitAudio(project, item, t) {
  const local = t - item.start;
  if (local < MIN_CLIP || audioDur(item) - local < MIN_CLIP) return null;
  const second = structuredClone(item);
  second.id = uid();
  second.in = item.in + local;
  second.start = item.start + local;
  second.fadeIn = 0;
  item.out = second.in;
  item.fadeOut = 0;
  project.audio.splice(project.audio.indexOf(item) + 1, 0, second);
  return second;
}

export function fmtTime(t, withTenths = true) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withTenths ? `${base}.${Math.floor((t * 10) % 10)}` : base;
}

export function outputSize(aspect, shortSide) {
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  return aspect >= 1
    ? { width: even(shortSide * aspect), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / aspect) };
}
