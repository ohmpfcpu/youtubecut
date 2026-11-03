// Contrôleur de l'application : accueil, éditeur, outils, import, export.
import * as store from './store.js';
import { probe, computeEnvelope, computeThumbs, mediaRecord, decodeAudioBlob, envFromAudioBuffer } from './media.js';
import {
  newProject, newClip, newAudioItem, ADJUST_DEFS, defaultAdjust, ASPECTS, layout, totalDuration, clipAt,
  projectAspect, fitZoom, clampCrop, cropRect, splitClip, splitAudio, fmtTime, uid, outputSize,
} from './project.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import { exportProject, estimate, RESOLUTIONS, QUALITIES, CODECS, FPS_CHOICES, resolveFps, ExportCanceled } from './exporter.js';
import { autoSync } from './sync.js';
import { h, icon, toolButton, slider, chips, toast, openSheet, closeSheet, isSheetOpen, fmtBytes, fmtDuration } from './ui.js';
import { canEncodeVideo } from 'mediabunny';

const $ = id => document.getElementById(id);

const app = {
  project: null,
  media: new Map(),
  selection: null,
  history: [],
  hIndex: -1,
  player: null,
  timeline: null,
  exporting: false,
  cropClip: null,
  bg: Promise.resolve(),
};
window.covercut = app; // pratique pour déboguer

// ======================================================================
// Démarrage
// ======================================================================
function init() {
  const missing = [];
  if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) missing.push('WebCodecs');
  if (!('indexedDB' in window)) missing.push('IndexedDB');
  if (missing.length) {
    const w = $('supportWarn');
    w.textContent = `Ce navigateur ne gère pas ${missing.join(', ')} : l'export ne fonctionnera pas. Utilise Chrome (Android) ou Safari 17+ (iPhone).`;
    w.classList.remove('hidden');
  }

  $('btnBack').append(icon('back'));
  $('btnUndo').append(icon('undo'));
  $('btnRedo').append(icon('redo'));
  $('btnZoomIn').append(icon('zoomIn', 20));
  $('btnZoomOut').append(icon('zoomOut', 20));
  $('sheetClose').append(icon('check'));
  setPlayIcon(false);

  app.player = new Player($('preview'), $('videoPool'));
  app.timeline = new Timeline($('timeline'), app);

  app.player.addEventListener('time', () => { updateTimes(); app.timeline.invalidate(); });
  app.player.addEventListener('state', () => setPlayIcon(app.player.playing));
  app.player.addEventListener('error', e => toast(e.detail));
  app.timeline.addEventListener('tap', e => onTimelineTap(e.detail));
  app.timeline.addEventListener('change', () => { app.player.invalidate(); updateTimes(); });
  app.timeline.addEventListener('commit', () => { commit(); app.player.resync(); });

  $('btnNew').onclick = () => {
    // Ouvre le sélecteur tout de suite (geste utilisateur requis sur mobile).
    $('fileVideo').click();
    createProject();
  };
  $('btnBack').onclick = () => showHome();
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('btnPlay').onclick = () => { if (!app.exporting) app.player.toggle(); };
  $('btnZoomIn').onclick = () => app.timeline.zoomBy(1.5);
  $('btnZoomOut').onclick = () => app.timeline.zoomBy(1 / 1.5);
  $('btnExport').onclick = () => exportSheet();
  $('sheetClose').onclick = () => closeSheet();
  $('projName').addEventListener('change', () => {
    app.project.name = $('projName').value.trim() || app.project.name;
    commit();
  });
  $('fileVideo').addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importVideos(files);
  });
  $('fileAudio').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importAudio(f);
  });

  setupPreviewGestures();
  const ro = new ResizeObserver(() => layoutViews());
  ro.observe($('previewWrap'));
  ro.observe($('timelineWrap'));
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', () => saveNow());
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
  }
  store.requestPersistence();
  showHome();
}

function setPlayIcon(playing) {
  $('btnPlay').replaceChildren(icon(playing ? 'pause' : 'play', 22));
}

function layoutViews() {
  const w = $('previewWrap');
  app.player.layoutCanvas(w.clientWidth, w.clientHeight);
  app.timeline.resize();
}

function setBusy(text) {
  $('busy').classList.toggle('hidden', !text);
  $('busyText').textContent = text || '';
}

// ======================================================================
// Accueil
// ======================================================================
async function showHome() {
  if (app.exporting) return;
  closeSheet();
  if (app.project) await closeProject();
  $('editor').classList.add('hidden');
  $('home').classList.remove('hidden');
  const list = $('projectList');
  let projects = [];
  try { projects = await store.listProjects(); } catch (err) { console.warn(err); }
  if (!projects.length) {
    list.replaceChildren(h('div', { class: 'empty' }, 'Aucun projet pour l\'instant.'));
    return;
  }
  list.replaceChildren(...projects.map(p => {
    const dur = totalDuration(p);
    const thumb = h('div', { class: 'thumb', style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : {} }, p.thumb ? '' : icon('video'));
    const more = h('button', { class: 'more', 'aria-label': 'Options', onclick: e => { e.stopPropagation(); projectMenu(p); } }, icon('more'));
    return h('div', { class: 'project-card', role: 'button', onclick: () => openProject(p) },
      thumb,
      h('div', { class: 'info' },
        h('div', { class: 'name' }, p.name),
        h('div', { class: 'meta' }, `${p.clips.length} clip${p.clips.length > 1 ? 's' : ''} · ${fmtTime(dur, false)} · ${new Date(p.updated).toLocaleDateString('fr-FR')}`)),
      more);
  }));
}

function projectMenu(p) {
  openSheet(p.name, h('div', {},
    h('div', { class: 'row' },
      h('button', {
        class: 'btn grow', onclick: async () => {
          const name = prompt('Nouveau nom du projet :', p.name);
          if (name && name.trim()) { p.name = name.trim(); await store.saveProject(p); }
          closeSheet(); showHome();
        },
      }, 'Renommer'),
      h('button', {
        class: 'btn grow', style: { color: 'var(--danger)' }, onclick: async () => {
          if (!confirm(`Supprimer « ${p.name} » et ses médias importés ?`)) return;
          await store.deleteProject(p.id);
          closeSheet(); showHome();
        },
      }, 'Supprimer'))));
}

async function createProject() {
  const p = newProject();
  await store.saveProject(p);
  await openProject(p);
}

async function openProject(p) {
  app.project = p;
  app.media = new Map();
  app.selection = null;
  $('home').classList.add('hidden');
  $('editor').classList.remove('hidden');
  $('projName').value = p.name;
  let records = [];
  try { records = await store.listMediaRecords(p.id); } catch (err) { console.warn(err); }
  for (const r of records) app.media.set(r.id, { ...r, thumbs: null });
  // Nettoie les références vers des médias manquants.
  p.clips = p.clips.filter(c => app.media.has(c.mediaId));
  p.audio = p.audio.filter(a => app.media.has(a.mediaId));
  app.player.setProject(p, app.media);
  resetHistory();
  layoutViews();
  app.timeline.fitZoom();
  refresh();
  // Analyses en arrière-plan.
  const audioIds = new Set(p.audio.map(a => a.mediaId));
  if (audioIds.size) {
    setBusy('Chargement des bandes son…');
    for (const id of audioIds) await ensureAudioBuffer(app.media.get(id)).catch(err => toast(err.message));
    setBusy(null);
  }
  for (const m of app.media.values()) queueAnalysis(m);
}

async function closeProject() {
  app.player.pause();
  const p = app.project;
  if (!p.clips.length && !p.audio.length && app.hIndex <= 0) {
    // Projet vide (ex. sélecteur de fichiers annulé) : on ne le garde pas.
    clearTimeout(saveTimer);
    await store.deleteProject(p.id).catch(() => {});
  } else {
    await saveNow();
  }
  const used = new Set([...app.project.clips.map(c => c.mediaId), ...app.project.audio.map(a => a.mediaId)]);
  for (const m of app.media.values()) {
    if (!used.has(m.id)) store.deleteMediaRecord(m.id).catch(() => {});
    if (m.url) URL.revokeObjectURL(m.url);
  }
  app.player.setProject(null, null);
  app.project = null;
  app.media = new Map();
  app.selection = null;
}

// ======================================================================
// Historique + sauvegarde
// ======================================================================
const snap = () => JSON.stringify({ ...app.project, updated: 0, thumb: null });

function resetHistory() {
  app.history = [snap()];
  app.hIndex = 0;
  updateUndo();
}

function commit() {
  if (!app.project) return;
  const s = snap();
  if (s !== app.history[app.hIndex]) {
    app.history.splice(app.hIndex + 1);
    app.history.push(s);
    if (app.history.length > 100) app.history.shift();
    app.hIndex = app.history.length - 1;
    scheduleSave();
  }
  refresh();
}

function restore(s) {
  const p = JSON.parse(s);
  p.updated = Date.now();
  p.thumb = app.project.thumb;
  app.project = p;
  if (app.selection) {
    const list = app.selection.type === 'clip' ? p.clips : p.audio;
    if (!list.some(x => x.id === app.selection.id)) app.selection = null;
  }
  closeSheet();
  app.player.replaceProject(p);
  scheduleSave();
  refresh();
}

function undo() { if (app.hIndex > 0) { app.hIndex--; restore(app.history[app.hIndex]); } }
function redo() { if (app.hIndex < app.history.length - 1) { app.hIndex++; restore(app.history[app.hIndex]); } }

function updateUndo() {
  $('btnUndo').disabled = app.hIndex <= 0;
  $('btnRedo').disabled = app.hIndex >= app.history.length - 1;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  clearTimeout(saveTimer);
  const p = app.project;
  if (!p) return;
  p.updated = Date.now();
  try {
    const first = p.clips[0] && app.media.get(p.clips[0].mediaId);
    if (first && first.thumbs && first.thumbs.length) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const img = first.thumbs[Math.min(first.thumbs.length - 1, 1)].img;
      const s = Math.max(128 / img.width, 128 / img.height);
      c.getContext('2d').drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
      p.thumb = c.toDataURL('image/jpeg', 0.7);
    }
    await store.saveProject(JSON.parse(JSON.stringify(p)));
  } catch (err) {
    console.warn('Sauvegarde impossible', err);
  }
}

// ======================================================================
// Rafraîchissement de l'interface
// ======================================================================
function refresh() {
  if (!app.project) return;
  updateUndo();
  layoutViews();
  app.timeline.invalidate();
  app.player.invalidate();
  renderToolbar();
  updateTimes();
  const hint = $('previewHint');
  const empty = !app.project.clips.length;
  hint.textContent = empty ? 'Importe une vidéo pour commencer' : '';
  hint.classList.toggle('hidden', !empty && !app.cropClip);
  if (app.cropClip) hint.textContent = 'Glisse pour cadrer · pince pour zoomer';
}

function updateTimes() {
  if (!app.project) return;
  $('timeCur').textContent = fmtTime(app.player.time);
  $('timeTot').textContent = fmtTime(totalDuration(app.project));
}

function selected() {
  const s = app.selection;
  if (!s || !app.project) return null;
  const item = (s.type === 'clip' ? app.project.clips : app.project.audio).find(x => x.id === s.id);
  return item ? { type: s.type, item } : null;
}

function select(sel) {
  app.selection = sel;
  closeSheet();
  renderToolbar();
  app.timeline.invalidate();
}

function onTimelineTap(hit) {
  if (!hit) return select(null);
  if (hit.type === 'add-audio') return $('fileAudio').click();
  const cur = app.selection;
  if (cur && cur.type === hit.type && cur.id === hit.id) return select(null);
  select({ type: hit.type, id: hit.id });
}

function renderToolbar() {
  const tb = $('toolbar');
  const s = selected();
  const sep = () => h('div', { class: 'tool-sep' });
  if (!s) {
    tb.replaceChildren(
      toolButton('video', 'Vidéo', () => $('fileVideo').click()),
      toolButton('music', 'Bande son', () => $('fileAudio').click()),
      toolButton('split', 'Diviser', splitAtPlayhead, { disabled: !app.project.clips.length }),
      sep(),
      toolButton('aspect', 'Format', formatSheet),
      toolButton('fade', 'Fondus', fadeSheet),
      toolButton('volume', 'Son vidéo', allClipsVolumeSheet, { disabled: !app.project.clips.length }),
    );
  } else if (s.type === 'clip') {
    const c = s.item;
    tb.replaceChildren(
      toolButton('back', 'Fermer', () => select(null)),
      toolButton('split', 'Diviser', splitAtPlayhead),
      toolButton('color', 'Couleur', () => colorSheet(c)),
      toolButton('crop', 'Recadrer', () => cropSheet(c)),
      toolButton(c.muted ? 'mute' : 'volume', 'Volume', () => clipVolumeSheet(c)),
      toolButton('rotate', 'Rotation', () => rotateClip(c)),
      toolButton('flip', 'Miroir', () => { c.flip = !c.flip; commit(); }, { active: c.flip }),
      toolButton('copy', 'Dupliquer', () => duplicateClip(c)),
      toolButton('left', 'Avancer', () => moveClip(c, -1), { disabled: app.project.clips[0] === c }),
      toolButton('right', 'Reculer', () => moveClip(c, 1), { disabled: app.project.clips[app.project.clips.length - 1] === c }),
      toolButton('trash', 'Supprimer', () => deleteClip(c), { danger: true }),
    );
  } else {
    const a = s.item;
    tb.replaceChildren(
      toolButton('back', 'Fermer', () => select(null)),
      toolButton('sync', 'Synchro', () => syncSheet(a)),
      toolButton('volume', 'Volume', () => audioVolumeSheet(a)),
      toolButton('split', 'Diviser', () => {
        if (splitAudio(app.project, a, app.player.time)) commit();
        else toast('Place la tête de lecture dans la bande son pour la diviser.');
      }),
      toolButton('copy', 'Dupliquer', () => {
        const d = structuredClone(a); d.id = uid();
        app.project.audio.splice(app.project.audio.indexOf(a) + 1, 0, d);
        commit();
      }),
      toolButton('trash', 'Supprimer', () => {
        app.project.audio = app.project.audio.filter(x => x !== a);
        app.selection = null;
        commit();
        app.player.resync();
      }, { danger: true }),
    );
  }
}

// ======================================================================
// Opérations sur les clips
// ======================================================================
function splitAtPlayhead() {
  const s = selected();
  const t = app.player.time;
  if (s && s.type === 'audio') return;
  const second = splitClip(app.project, t);
  if (!second) return toast('Place la tête de lecture à l\'intérieur d\'un clip.');
  if (s) app.selection = { type: 'clip', id: second.id };
  commit();
}

function deleteClip(c) {
  app.project.clips = app.project.clips.filter(x => x !== c);
  app.selection = null;
  if (app.player.time > totalDuration(app.project)) app.player.seek(totalDuration(app.project));
  commit();
}

function duplicateClip(c) {
  const d = structuredClone(c);
  d.id = uid();
  app.project.clips.splice(app.project.clips.indexOf(c) + 1, 0, d);
  app.selection = { type: 'clip', id: d.id };
  commit();
}

function moveClip(c, dir) {
  const arr = app.project.clips;
  const i = arr.indexOf(c), j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  commit();
  seekIntoClip(c);
}

function rotateClip(c) {
  c.rotate = ((c.rotate || 0) + 90) % 360;
  clampCrop(c, app.media.get(c.mediaId), projectAspect(app.project, app.media));
  if (app.project.aspect === 'auto' && app.project.clips[0] === c) clampAll();
  commit();
}

function clampAll() {
  const aspect = projectAspect(app.project, app.media);
  for (const c of app.project.clips) clampCrop(c, app.media.get(c.mediaId), aspect);
}

function seekIntoClip(c) {
  const it = layout(app.project).find(x => x.clip === c);
  if (!it) return;
  const t = app.player.time;
  if (t < it.start || t >= it.end) app.player.seek(it.start + Math.min(0.05, (it.end - it.start) / 2));
}

// ======================================================================
// Feuilles d'outils
// ======================================================================
const signed = v => (v > 0 ? '+' : '') + v;
const pct = v => `${Math.round(v)} %`;
const secs = v => `${Number(v).toFixed(1)} s`;

function colorSheet(c) {
  seekIntoClip(c);
  const sliders = [];
  const body = h('div', {});
  for (const d of ADJUST_DEFS) {
    const s = slider({
      label: d.label, min: d.min, max: d.max, value: (c.adjust && c.adjust[d.key]) || 0, format: signed,
      onInput: v => { c.adjust[d.key] = v; app.player.invalidate(); },
      onChange: () => commit(),
    });
    sliders.push([d.key, s]);
    body.append(s);
  }
  body.prepend(h('p', { class: 'note' }, 'Double-tape un nom pour le remettre à zéro.'));
  body.append(h('div', { class: 'row' },
    h('button', {
      class: 'btn grow', onclick: () => {
        c.adjust = defaultAdjust();
        sliders.forEach(([, s]) => s.setValue(0));
        commit();
      },
    }, 'Réinitialiser'),
    h('button', {
      class: 'btn grow', onclick: () => {
        for (const o of app.project.clips) o.adjust = { ...c.adjust };
        commit();
        toast('Réglages appliqués à tous les clips');
      },
    }, 'Appliquer à tous')));
  openSheet('Couleur', body, { onClose: commit });
}

function cropSheet(c) {
  seekIntoClip(c);
  const m = app.media.get(c.mediaId);
  const aspect = projectAspect(app.project, app.media);
  const fz = fitZoom(m, c, aspect);
  const zoomSlider = slider({
    label: 'Zoom', min: Math.floor(fz * 100), max: 400, value: Math.round((c.crop.zoom || 1) * 100), format: pct, reset: 100,
    onInput: v => { c.crop.zoom = v / 100; clampCrop(c, m, aspect); app.player.invalidate(); },
    onChange: () => commit(),
  });
  const setCrop = (patch) => {
    Object.assign(c.crop, patch);
    clampCrop(c, m, aspect);
    zoomSlider.setValue(Math.round(c.crop.zoom * 100));
    app.player.invalidate();
    commit();
  };
  const body = h('div', {},
    h('div', { class: 'section-title' }, 'Format de la vidéo'),
    chips(ASPECTS.map(a => ({ id: a.id, label: a.label })), app.project.aspect, id => {
      app.project.aspect = id;
      clampAll();
      commit();
      cropSheet(c);
    }),
    zoomSlider,
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => setCrop({ zoom: 1, cx: 0.5, cy: 0.5 }) }, 'Remplir'),
      h('button', { class: 'btn grow', onclick: () => setCrop({ zoom: fz, cx: 0.5, cy: 0.5 }) }, 'Ajuster'),
      h('button', { class: 'btn grow', onclick: () => setCrop({ cx: 0.5, cy: 0.5 }) }, 'Centrer')),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => { rotateClip(c); cropSheet(c); } }, icon('rotate', 18), 'Rotation 90°'),
      h('button', { class: 'btn grow', onclick: () => { c.flip = !c.flip; commit(); } }, icon('flip', 18), 'Miroir')),
    h('p', { class: 'note' }, 'Glisse sur l\'aperçu pour déplacer l\'image, pince pour zoomer.'));
  app.cropClip = c;
  app.cropSlider = zoomSlider;
  document.body.classList.add('crop-mode');
  refresh();
  openSheet('Recadrer', body, {
    onClose: () => {
      app.cropClip = null;
      app.cropSlider = null;
      document.body.classList.remove('crop-mode');
      commit();
    },
  });
}

function setupPreviewGestures() {
  const wrap = $('previewWrap');
  const pts = new Map();
  let start = null, moved = false;
  wrap.addEventListener('pointerdown', e => {
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    const c = app.cropClip;
    if (!c) return;
    const vals = [...pts.values()];
    start = {
      cx: c.crop.cx, cy: c.crop.cy, zoom: c.crop.zoom,
      p: vals[0], dist: vals.length === 2 ? Math.hypot(vals[0].x - vals[1].x, vals[0].y - vals[1].y) : 0,
      mid: vals.length === 2 ? { x: (vals[0].x + vals[1].x) / 2, y: (vals[0].y + vals[1].y) / 2 } : vals[0],
    };
  });
  wrap.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = app.cropClip;
    const vals = [...pts.values()];
    if (!c || !start) {
      if (Math.hypot(e.movementX, e.movementY) > 2) moved = true;
      return;
    }
    moved = true;
    const m = app.media.get(c.mediaId);
    const aspect = projectAspect(app.project, app.media);
    const cv = $('preview').getBoundingClientRect();
    if (vals.length === 2 && start.dist) {
      const dist = Math.hypot(vals[0].x - vals[1].x, vals[0].y - vals[1].y);
      c.crop.zoom = Math.max(fitZoom(m, c, aspect), Math.min(4, start.zoom * dist / start.dist));
    } else if (vals.length === 1) {
      const p = vals[0];
      const rect = cropRect(c, m, aspect);
      c.crop.cx = start.cx - ((p.x - start.p.x) / cv.width) * rect.w;
      c.crop.cy = start.cy - ((p.y - start.p.y) / cv.height) * rect.h;
    }
    clampCrop(c, m, aspect);
    if (app.cropSlider) app.cropSlider.setValue(Math.round(c.crop.zoom * 100));
    app.player.invalidate();
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (app.cropClip) {
      if (moved) commit();
      // repart d'un état propre pour le doigt restant
      const c = app.cropClip;
      const vals = [...pts.values()];
      start = vals.length ? { cx: c.crop.cx, cy: c.crop.cy, zoom: c.crop.zoom, p: vals[0], dist: 0 } : null;
    } else if (!moved && pts.size === 0 && e.type === 'pointerup' && app.project && app.project.clips.length) {
      app.player.toggle();
    }
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}

function clipVolumeSheet(c) {
  const sw = h('input', { type: 'checkbox' });
  sw.checked = !!c.muted;
  sw.onchange = () => { c.muted = sw.checked; commit(); };
  const body = h('div', {},
    slider({
      label: 'Volume du clip', min: 0, max: 200, value: Math.round(c.volume * 100), format: pct, reset: 100,
      onInput: v => { c.volume = v / 100; }, onChange: () => commit(),
    }),
    h('label', { class: 'switch' }, h('span', {}, 'Couper le son de ce clip'), sw));
  openSheet('Volume', body, { onClose: commit });
}

function allClipsVolumeSheet() {
  const allMuted = app.project.clips.every(c => c.muted);
  const body = h('div', {},
    h('p', { class: 'note' }, 'Pour une cover enregistrée à part, coupe le son de la caméra et garde uniquement ta bande son.'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn grow ' + (allMuted ? '' : 'primary'), onclick: () => {
          for (const c of app.project.clips) c.muted = !allMuted;
          commit();
          closeSheet();
          toast(allMuted ? 'Son des vidéos rétabli' : 'Son des vidéos coupé');
        },
      }, allMuted ? 'Rétablir le son des vidéos' : 'Couper le son de toutes les vidéos')));
  openSheet('Son des vidéos', body);
}

function audioVolumeSheet(a) {
  const body = h('div', {},
    slider({ label: 'Volume', min: 0, max: 200, value: Math.round(a.volume * 100), format: pct, reset: 100, onInput: v => { a.volume = v / 100; app.timeline.invalidate(); }, onChange: () => { commit(); app.player.resync(); } }),
    slider({ label: 'Fondu d\'entrée', min: 0, max: 10, step: 0.1, value: a.fadeIn, format: secs, onInput: v => { a.fadeIn = v; app.timeline.invalidate(); }, onChange: () => { commit(); app.player.resync(); } }),
    slider({ label: 'Fondu de sortie', min: 0, max: 10, step: 0.1, value: a.fadeOut, format: secs, onInput: v => { a.fadeOut = v; app.timeline.invalidate(); }, onChange: () => { commit(); app.player.resync(); } }));
  openSheet('Volume de la bande son', body, { onClose: commit });
}

function syncSheet(a) {
  const value = h('div', { class: 'big-value' });
  const show = () => {
    value.textContent = `Début à ${a.start >= 0 ? '' : '−'}${Math.abs(a.start).toFixed(3)} s`;
    offs.textContent = a.in > 0.0005 ? `Les ${a.in.toFixed(3)} premières secondes du fichier audio sont coupées.` : '';
  };
  const offs = h('div', { class: 'note', style: { textAlign: 'center', marginTop: '-4px' } });
  show();
  const nudge = d => {
    a.start = Math.round((a.start + d) * 1000) / 1000;
    show();
    app.timeline.invalidate();
    app.player.resync();
    commit();
  };
  const mutedAll = () => app.project.clips.length && app.project.clips.every(c => c.muted);
  const sw = h('input', { type: 'checkbox' });
  sw.checked = mutedAll();
  sw.onchange = () => { for (const c of app.project.clips) c.muted = sw.checked; commit(); app.player.resync(); };
  const body = h('div', {},
    h('p', { class: 'note' }, 'La synchro auto compare ta bande son au son capté par la caméra (attaques, coups de médiator…) et cale les deux au milliseconde près.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary grow', onclick: () => runSync(a, show, sw) }, icon('sync', 18), 'Synchro auto')),
    value,
    offs,
    h('div', { class: 'nudge' },
      h('button', { class: 'btn', onclick: () => nudge(-0.1) }, '−100 ms'),
      h('button', { class: 'btn', onclick: () => nudge(-0.01) }, '−10 ms'),
      h('button', { class: 'btn', onclick: () => nudge(0.01) }, '+10 ms'),
      h('button', { class: 'btn', onclick: () => nudge(0.1) }, '+100 ms')),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => { a.start = app.player.time; show(); commit(); app.player.resync(); } }, 'Caler sur la tête de lecture'),
      h('button', { class: 'btn grow', onclick: () => { a.start = 0; show(); commit(); app.player.resync(); } }, 'Début à 0')),
    h('label', { class: 'switch' }, h('span', {}, 'Couper le son de la caméra'), sw));
  openSheet('Synchronisation', body, { onClose: commit });
}

async function runSync(a, show, sw) {
  try {
    setBusy('Analyse des sons…');
    // S'assure que les enveloppes audio sont prêtes.
    const ids = new Set([a.mediaId, ...app.project.clips.map(c => c.mediaId)]);
    for (const id of ids) {
      const m = app.media.get(id);
      if (m && m.hasAudio && !m.env) {
        m.env = await computeEnvelope(m);
        if (m.env) store.updateMediaRecord(m.id, { env: m.env }).catch(() => {});
      }
    }
    await new Promise(r => setTimeout(r, 30));
    const r = autoSync(app.project, app.media, a);
    a.start = Math.round(r.start * 1000) / 1000;
    a.in = r.in;
    a.out = r.out;
    commit();
    app.player.resync();
    if (show) show();
    app.player.seek(Math.max(0, a.start));
    if (r.confidence === 'faible') toast('Synchro incertaine : vérifie à l\'écoute et ajuste avec les boutons ±10 ms.', 4500);
    else toast(`Synchro trouvée (confiance ${r.confidence}).${sw && !sw.checked ? ' Pense à couper le son de la caméra si besoin.' : ''}`, 4000);
  } catch (err) {
    console.error(err);
    toast(err.message, 4000);
  } finally {
    setBusy(null);
  }
}

function formatSheet() {
  const body = h('div', {},
    h('p', { class: 'note' }, '« Original » reprend le format du premier clip. Recadre ensuite chaque clip avec l\'outil Recadrer.'),
    chips(ASPECTS.map(a => ({ id: a.id, label: a.label })), app.project.aspect, id => {
      app.project.aspect = id;
      clampAll();
      commit();
    }));
  openSheet('Format', body);
}

function fadeSheet() {
  const body = h('div', {},
    h('p', { class: 'note' }, 'Fondu au noir (image et son) au début et à la fin de la vidéo.'),
    slider({ label: 'Fondu d\'ouverture', min: 0, max: 5, step: 0.1, value: app.project.fadeIn, format: secs, onInput: v => { app.project.fadeIn = v; app.player.invalidate(); }, onChange: () => commit() }),
    slider({ label: 'Fondu de fin', min: 0, max: 5, step: 0.1, value: app.project.fadeOut, format: secs, onInput: v => { app.project.fadeOut = v; app.player.invalidate(); }, onChange: () => commit() }));
  openSheet('Fondus', body, { onClose: commit });
}

// ======================================================================
// Import
// ======================================================================
function queueAnalysis(m) {
  app.bg = app.bg.then(async () => {
    if (!app.media.has(m.id)) return;
    if (m.kind === 'video' && !m.thumbs) {
      m.thumbs = await computeThumbs(m);
      app.timeline.invalidate();
      if (app.project && app.project.clips[0] && app.project.clips[0].mediaId === m.id) scheduleSave();
    }
    if (m.hasAudio && !m.env) {
      m.env = await computeEnvelope(m);
      app.timeline.invalidate();
      if (m.env) await store.updateMediaRecord(m.id, { env: m.env }).catch(() => {});
    }
  }).catch(err => console.warn('Analyse', err));
}

async function addMedia(m) {
  app.media.set(m.id, m);
  try {
    await store.saveMediaRecord(mediaRecord(m));
  } catch (err) {
    console.warn(err);
    toast('Stockage local plein : le média ne sera pas conservé après fermeture.', 4000);
  }
}

async function importVideos(files) {
  if (!app.project) await new Promise(r => setTimeout(r, 300));
  if (!app.project) return;
  const s = selected();
  let insertAt = s && s.type === 'clip' ? app.project.clips.indexOf(s.item) + 1 : app.project.clips.length;
  const wasEmpty = !app.project.clips.length;
  let last = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setBusy(`Import ${files.length > 1 ? `${i + 1}/${files.length} ` : ''}: ${f.name}`);
    try {
      const m = await probe(f, app.project.id);
      if (m.kind !== 'video') {
        toast(`« ${f.name} » ne contient pas de vidéo : ajouté comme bande son.`);
        await addAudioMedia(m);
        continue;
      }
      await addMedia(m);
      const c = newClip(m);
      app.project.clips.splice(insertAt++, 0, c);
      last = c;
      queueAnalysis(m);
    } catch (err) {
      console.error(err);
      toast(`Impossible d'importer « ${f.name} » : ${err.message}`, 5000);
    }
  }
  setBusy(null);
  if (last) {
    clampAll();
    commit();
    if (wasEmpty) app.timeline.fitZoom();
    seekIntoClip(last);
  }
}

async function ensureAudioBuffer(m) {
  if (!m || m.audioBuffer) return;
  m.audioBuffer = await decodeAudioBlob(m.blob);
}

async function addAudioMedia(m) {
  await ensureAudioBuffer(m);
  if (!m.env) m.env = envFromAudioBuffer(m.audioBuffer);
  m.hasAudio = true;
  await addMedia(m);
  const start = app.project.audio.length ? app.player.time : 0;
  const item = newAudioItem(m, start);
  item.out = Math.min(m.duration, m.audioBuffer.duration);
  app.project.audio.push(item);
  app.selection = { type: 'audio', id: item.id };
  commit();
  app.player.resync();
  return item;
}

async function importAudio(file) {
  if (!app.project) return;
  setBusy(`Import : ${file.name}`);
  try {
    let m;
    try {
      m = await probe(file, app.project.id);
    } catch {
      // Dernier recours : laisser Web Audio décoder.
      const buf = await decodeAudioBlob(file);
      m = { id: uid(), projectId: app.project.id, name: file.name, blob: file, kind: 'audio', duration: buf.duration, width: 0, height: 0, rotation: 0, fps: 0, hasAudio: true, env: null, audioBuffer: buf };
    }
    const item = await addAudioMedia(m);
    setBusy(null);
    const camHasAudio = app.project.clips.some(c => (app.media.get(c.mediaId) || {}).hasAudio);
    if (camHasAudio) syncSheet(item);
    else toast('Bande son ajoutée');
  } catch (err) {
    console.error(err);
    toast(`Impossible d'importer « ${file.name} » : ${err.message}`, 5000);
  } finally {
    setBusy(null);
  }
}

// ======================================================================
// Export
// ======================================================================
function exportSheet() {
  if (!app.project || !totalDuration(app.project)) return toast('Ajoute d\'abord une vidéo.');
  app.player.pause();
  const s = app.project.export;
  const info = h('div', { class: 'note' });
  const aspect = projectAspect(app.project, app.media);
  const maxSrc = Math.max(...app.project.clips.map(c => {
    const m = app.media.get(c.mediaId);
    return m ? Math.min(m.width, m.height) : 0;
  }), 0);
  const upd = () => {
    const e = estimate(app.project, app.media, s);
    const up = s.res > maxSrc * 1.05 && maxSrc > 0 ? ' · ⚠️ plus grand que la source' : '';
    info.textContent = `${e.width}×${e.height} · ${e.fps} i/s · ${(e.videoBitrate / 1e6).toFixed(1)} Mb/s · ≈ ${fmtBytes(e.bytes)}${up}`;
    app.project.updated = Date.now();
    scheduleSave();
  };
  const resChips = chips(RESOLUTIONS.map(r => {
    const o = outputSize(aspect, r.id);
    return { id: r.id, label: `${r.label} · ${o.width}×${o.height}` };
  }), s.res, v => { s.res = v; upd(); });
  const autoFps = resolveFps(app.project, app.media, 'auto');
  const codecChips = chips(CODECS.map(c => ({ id: c.id, label: c.label })), s.codec, v => { s.codec = v; upd(); });
  // Désactive HEVC si l'appareil ne sait pas l'encoder.
  (async () => {
    try {
      const e = estimate(app.project, app.media, s);
      const ok = await canEncodeVideo('hevc', { width: e.width, height: e.height, bitrate: e.videoBitrate });
      if (!ok) {
        if (s.codec === 'hevc') s.codec = 'avc';
        codecChips.replaceWith(chips(CODECS.map(c => ({ id: c.id, label: c.id === 'hevc' ? c.label + ' — non dispo' : c.label, disabled: c.id === 'hevc' })), s.codec, v => { s.codec = v; upd(); }));
      }
    } catch { /* ignoré */ }
  })();
  const body = h('div', {},
    h('div', { class: 'section-title' }, 'Résolution'),
    resChips,
    h('div', { class: 'section-title' }, 'Images par seconde'),
    chips(FPS_CHOICES.map(f => ({ id: f, label: f === 'auto' ? `Auto (${Math.round(autoFps * 100) / 100})` : String(f) })), s.fps, v => { s.fps = v; upd(); }),
    h('div', { class: 'section-title' }, 'Qualité'),
    chips(QUALITIES.map(q => ({ id: q.id, label: q.label })), s.quality, v => { s.quality = v; upd(); }),
    h('div', { class: 'section-title' }, 'Codec vidéo'),
    codecChips,
    h('div', { class: 'section-title' }, 'Qualité audio (AAC)'),
    chips([128000, 192000, 256000, 320000].map(b => ({ id: b, label: `${b / 1000} kb/s` })), s.audioBitrate, v => { s.audioBitrate = v; upd(); }),
    info,
    h('div', { class: 'row' }, h('button', { class: 'btn primary grow', onclick: startExport }, icon('export', 18), 'Exporter la vidéo')));
  upd();
  openSheet('Exporter', body);
}

async function startExport() {
  const ac = new AbortController();
  const bar = h('div');
  const pctText = h('div', { class: 'big-value' }, '0 %');
  const detail = h('div', { class: 'note', style: { textAlign: 'center' } }, 'Préparation…');
  const body = h('div', {},
    pctText,
    h('div', { class: 'progress' }, bar),
    detail,
    h('p', { class: 'note' }, 'Garde l\'appli au premier plan et l\'écran allumé pendant l\'export.'),
    h('div', { class: 'row' }, h('button', { class: 'btn grow', onclick: () => ac.abort() }, 'Annuler')));
  openSheet('Export en cours…', body, { onClose: () => { if (app.exporting) ac.abort(); } });
  app.exporting = true;
  $('btnExport').disabled = true;
  let lock = null;
  try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch { /* ignoré */ }
  try {
    const res = await exportProject({
      project: structuredClone(app.project),
      media: app.media,
      settings: { ...app.project.export },
      signal: ac.signal,
      onProgress: p => {
        const v = Math.floor(p.progress * 100);
        bar.style.width = v + '%';
        pctText.textContent = v + ' %';
        detail.textContent = `Reste ≈ ${fmtDuration(p.eta)} · ${p.speed.toFixed(1)}× temps réel`;
      },
    });
    app.exporting = false;
    showResult(res);
  } catch (err) {
    app.exporting = false;
    if (err instanceof ExportCanceled || ac.signal.aborted) {
      closeSheet();
      toast('Export annulé');
    } else {
      console.error(err);
      openSheet('Échec de l\'export', h('div', {},
        h('p', {}, err.message || String(err)),
        h('p', { class: 'note' }, 'Essaie une résolution plus basse ou le codec H.264.')));
    }
  } finally {
    app.exporting = false;
    $('btnExport').disabled = false;
    if (lock) lock.release().catch(() => {});
  }
}

function showResult(res) {
  const safe = (app.project.name || 'video').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 50) || 'video';
  const name = `${safe}_${Math.min(res.width, res.height)}p.mp4`;
  const file = new File([res.blob], name, { type: 'video/mp4' });
  const url = URL.createObjectURL(file);
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const codecName = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' }[res.codec] || res.codec;
  const body = h('div', {},
    h('video', { class: 'result-video', src: url, controls: true, playsinline: true }),
    h('div', { class: 'kv' }, h('span', {}, 'Fichier'), h('span', {}, name)),
    h('div', { class: 'kv' }, h('span', {}, 'Format'), h('span', {}, `${res.width}×${res.height} · ${res.fps} i/s · ${codecName}${res.audioCodec ? ' + ' + res.audioCodec.toUpperCase() : ''}`)),
    h('div', { class: 'kv' }, h('span', {}, 'Taille'), h('span', {}, fmtBytes(file.size))),
    h('div', { class: 'kv' }, h('span', {}, 'Encodé en'), h('span', {}, `${fmtDuration(res.elapsed)} (${(res.duration / res.elapsed).toFixed(1)}× temps réel)`)),
    h('div', { class: 'row' },
      canShare ? h('button', {
        class: 'btn primary grow', onclick: async () => {
          try { await navigator.share({ files: [file], title: app.project.name }); } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
        },
      }, icon('share', 18), 'Partager / Enregistrer') : null,
      h('button', {
        class: 'btn grow' + (canShare ? '' : ' primary'), onclick: () => {
          const a = h('a', { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
        },
      }, icon('download', 18), 'Télécharger')),
    h('p', { class: 'note' }, canShare ? 'Sur téléphone, « Partager » permet d\'enregistrer dans la galerie ou d\'envoyer directement.' : ''));
  openSheet('Vidéo prête 🎉', body, { onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
}

// ======================================================================
// Raccourcis clavier (tablette / ordinateur)
// ======================================================================
function onKey(e) {
  if (!app.project || $('editor').classList.contains('hidden')) return;
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); app.player.toggle(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
  else if (k === 's' && !e.ctrlKey && !e.metaKey) splitAtPlayhead();
  else if (k === 'arrowleft') app.player.seek(app.player.time - (e.shiftKey ? 1 : 1 / 30));
  else if (k === 'arrowright') app.player.seek(app.player.time + (e.shiftKey ? 1 : 1 / 30));
  else if (k === 'escape') { if (isSheetOpen()) closeSheet(); else select(null); }
  else if (k === 'delete' || k === 'backspace') {
    const s = selected();
    if (!s) return;
    if (s.type === 'clip') deleteClip(s.item);
    else { app.project.audio = app.project.audio.filter(x => x !== s.item); app.selection = null; commit(); app.player.resync(); }
  }
}

init();
