export interface PlayLevelEntry {
  id: string;
  name: string; // filename
  title: string;
  artist: string;
  charter: string;
  mode: string;
  timestamp: number;
  blob: Blob;
  bgBlob?: Blob; // To show thumbnail in the list
  difficulties: string[];
}

const DB_NAME = 'IRIS_PlayDB';
const STORE_NAME = 'play_levels';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePlayLevelToDB(entry: PlayLevelEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('IndexedDB transaction aborted'));
    };
    tx.onerror = () => {
      // Let IndexedDB abort the transaction; onabort reports the failure.
    };
    try {
      tx.objectStore(STORE_NAME).put(entry);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        db.close();
        reject(error);
      }
    }
  });
}

export async function getPlayLevelFromDB(id: string): Promise<PlayLevelEntry | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get level from IndexedDB', err);
    return undefined;
  }
}

export async function getAllPlayLevelsFromDB(): Promise<PlayLevelEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const results: PlayLevelEntry[] = request.result || [];
        results.sort((a, b) => b.timestamp - a.timestamp);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get all levels from IndexedDB', err);
    return [];
  }
}

export async function deletePlayLevelFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete level from IndexedDB', err);
  }
}
