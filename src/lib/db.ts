export interface HistoryEntry {
  id: string;
  name: string;
  fileName: string;
  format: string;
  timestamp: number;
  fileSize?: number;
  blob?: Blob;
  critiqueLogs?: any[];
  correctionLogs?: any[];
  isImproved?: boolean;
  engine?: string;
  stylePreset?: string;
}

const DB_NAME = 'AutoCharterDB';
const STORE_NAME = 'charts';
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

function writeTransaction(db: IDBDatabase, operation: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    let operationError: unknown;
    try {
      transaction = db.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      reject(operationError || transaction.error || new Error('IndexedDB transaction aborted'));
    };
    transaction.onerror = () => {
      // The default handler aborts the transaction; onabort reports the failure.
    };

    try {
      operation(transaction.objectStore(STORE_NAME));
    } catch (error) {
      operationError = error;
      try {
        transaction.abort();
      } catch {
        db.close();
        reject(error);
      }
    }
  });
}

export async function saveChartToDB(entry: Omit<HistoryEntry, 'blob'>, blob: Blob): Promise<void> {
  const db = await openDB();
  const data: HistoryEntry = { ...entry, blob, fileSize: blob.size };
  await writeTransaction(db, store => { store.put(data); });
}

export async function getChartFromDB(id: string): Promise<HistoryEntry | undefined> {
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
    console.error('Failed to get chart from IndexedDB', err);
    return undefined;
  }
}

export async function getAllChartsFromDB(): Promise<HistoryEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const results: HistoryEntry[] = request.result || [];
        const historyOnly = results.filter(item => !item.id.startsWith('draft_'));
        historyOnly.sort((a, b) => b.timestamp - a.timestamp);
        resolve(historyOnly);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get all charts from IndexedDB', err);
    return [];
  }
}

export interface DraftSlot {
  id: string; // e.g. 'draft_auto' or 'draft_slot_1'
  name: string; // "Song Name - Auto-Save" or "My Custom Slot"
  timestamp: number;
  activeTab: string;
  songName: string;
  artist: string;
  charterName: string;
  audioRegions: any[];
  silenceThreshold: number;
  enableHoldNotes: boolean;
  useTripletRhythm: boolean;
  useFreeOnset: boolean;
  isSingleDiffOnly: boolean;
  difficulties: any[];
  tabDifficulties?: Record<string, any[]>;
  editingHistoryId: string | null;
  charterEngineMode?: 'standard' | 'beta';
  betaOptions?: any;
  
  // Files stored as Blobs/Files
  audioFile?: File | Blob | null;
  chartingAudioFile?: File | Blob | null;
  bgFile?: File | Blob | null;
  videoFile?: File | Blob | null;
  audioFileName?: string;
  chartingAudioFileName?: string;
  bgFileName?: string;
  videoFileName?: string;
  importedChart?: import('./chartParser').ParsedChart | null;
}

export async function saveDraftToDB(draft: DraftSlot): Promise<void> {
  const db = await openDB();
  await writeTransaction(db, store => { store.put(draft); });
}

export async function getDraftFromDB(id: string): Promise<DraftSlot | undefined> {
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
    console.error('Failed to get draft from IndexedDB', err);
    return undefined;
  }
}

export async function getAllDraftsFromDB(): Promise<DraftSlot[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const results: any[] = request.result || [];
        const drafts = results.filter(item => item.id.startsWith('draft_'));
        drafts.sort((a, b) => b.timestamp - a.timestamp);
        resolve(drafts);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get all drafts from IndexedDB', err);
    return [];
  }
}

export async function deleteDraftFromDB(id: string): Promise<void> {
  const db = await openDB();
  await writeTransaction(db, store => { store.delete(id); });
}

export async function deleteChartFromDB(id: string): Promise<void> {
  const db = await openDB();
  await writeTransaction(db, store => { store.delete(id); });
}

export async function clearAllChartsFromDB(): Promise<void> {
  const db = await openDB();
  await writeTransaction(db, store => {
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result as Array<{ id: string }>;
      for (const entry of entries) {
        if (!entry.id.startsWith('draft_')) store.delete(entry.id);
      }
    };
  });
}
