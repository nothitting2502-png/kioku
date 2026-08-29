/* IndexedDB ラッパー。
   セッション（文字・メモ）と音声を別ストアに分けて保存する。
   音声は容量が大きいので、必要なときだけ読み出す。 */

const DB_NAME = 'kioku';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_AUDIO = 'audio';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('この端末のブラウザは IndexedDB に対応していません。'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('データベースを開けませんでした。'));
  });
  return dbPromise;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllSessions() {
  const db = await openDb();
  const list = await wrap(tx(db, STORE_SESSIONS, 'readonly').getAll());
  return list || [];
}

export async function getSession(id) {
  const db = await openDb();
  return wrap(tx(db, STORE_SESSIONS, 'readonly').get(id));
}

export async function putSession(session) {
  const db = await openDb();
  await wrap(tx(db, STORE_SESSIONS, 'readwrite').put(session));
  return session;
}

export async function putSessions(sessions) {
  const db = await openDb();
  const store = tx(db, STORE_SESSIONS, 'readwrite');
  await Promise.all(sessions.map((s) => wrap(store.put(s))));
  return sessions.length;
}

export async function deleteSession(id) {
  const db = await openDb();
  await wrap(tx(db, STORE_SESSIONS, 'readwrite').delete(id));
  await deleteAudio(id);
}

export async function clearAll() {
  const db = await openDb();
  await wrap(tx(db, STORE_SESSIONS, 'readwrite').clear());
  await wrap(tx(db, STORE_AUDIO, 'readwrite').clear());
}

export async function putAudio(sessionId, blob) {
  const db = await openDb();
  await wrap(tx(db, STORE_AUDIO, 'readwrite').put({ sessionId, blob, savedAt: new Date().toISOString() }));
  return { mimeType: blob.type || 'audio/webm', size: blob.size };
}

export async function getAudio(sessionId) {
  const db = await openDb();
  const rec = await wrap(tx(db, STORE_AUDIO, 'readonly').get(sessionId));
  return rec ? rec.blob : null;
}

export async function deleteAudio(sessionId) {
  const db = await openDb();
  await wrap(tx(db, STORE_AUDIO, 'readwrite').delete(sessionId));
}

/** 端末の保存容量の見込み（設定画面に表示する） */
export async function estimateUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    } catch {
      /* 取得できない環境は表示を省く */
    }
  }
  return null;
}
