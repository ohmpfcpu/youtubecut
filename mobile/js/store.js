// Persistance locale (IndexedDB) : projets + fichiers médias importés.
const DB_NAME = 'covercut';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) {
        const s = db.createObjectStore('media', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
  }));
}

const reqP = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function listProjects() {
  const all = await tx('projects', 'readonly', s => reqP(s.getAll()));
  return (all || []).sort((a, b) => b.updated - a.updated);
}

export function getProject(id) {
  return tx('projects', 'readonly', s => reqP(s.get(id)));
}

export function saveProject(project) {
  return tx('projects', 'readwrite', s => reqP(s.put(project)));
}

export async function deleteProject(id) {
  const media = await listMediaRecords(id);
  await tx('media', 'readwrite', s => Promise.all(media.map(m => reqP(s.delete(m.id)))));
  await tx('projects', 'readwrite', s => reqP(s.delete(id)));
}

export function saveMediaRecord(record) {
  return tx('media', 'readwrite', s => reqP(s.put(record)));
}

export function updateMediaRecord(id, patch) {
  return tx('media', 'readwrite', async s => {
    const cur = await reqP(s.get(id));
    if (cur) await reqP(s.put({ ...cur, ...patch }));
  });
}

export function deleteMediaRecord(id) {
  return tx('media', 'readwrite', s => reqP(s.delete(id)));
}

export function listMediaRecords(projectId) {
  return tx('media', 'readonly', s => reqP(s.index('projectId').getAll(projectId)));
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* ignoré */ }
}
