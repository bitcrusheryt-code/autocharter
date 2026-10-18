import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAllChartsFromDB, saveDraftToDB, type DraftSlot } from '../src/lib/db.ts';

function installIndexedDbMock(options: { openError?: Error; abortWrites?: boolean } = {}) {
  const records = new Map<string, any>();
  const database = {
    close() {},
    transaction() {
      const transaction: any = {
        error: null,
        objectStore() {
          return {
            getAll() {
              const request: any = { result: Array.from(records.values()) };
              queueMicrotask(() => {
                request.onsuccess?.();
                queueMicrotask(() => transaction.oncomplete?.());
              });
              return request;
            },
            put(value: any) {
              const request: any = { result: value };
              if (options.abortWrites) {
                queueMicrotask(() => {
                  transaction.error = new Error('write failed');
                  transaction.onabort?.();
                });
              } else {
                records.set(value.id, value);
                queueMicrotask(() => transaction.oncomplete?.());
              }
              return request;
            },
            delete(id: string) {
              records.delete(id);
            }
          };
        },
        abort() {
          queueMicrotask(() => transaction.onabort?.());
        }
      };
      return transaction;
    }
  };
  const indexedDb = {
    open() {
      const request: any = { result: database, error: options.openError };
      queueMicrotask(() => {
        if (options.openError) request.onerror?.();
        else request.onsuccess?.();
      });
      return request;
    }
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDb });
  return {
    records,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
      else delete (globalThis as any).indexedDB;
    }
  };
}

test('clearing chart history preserves saved draft slots', async () => {
  const mock = installIndexedDbMock();
  try {
    mock.records.set('chart-1', { id: 'chart-1', name: 'History chart' });
    mock.records.set('draft_auto', { id: 'draft_auto', name: 'Auto-save' });
    mock.records.set('draft_slot_1', { id: 'draft_slot_1', name: 'Manual draft' });

    await clearAllChartsFromDB();

    assert.deepEqual(Array.from(mock.records.keys()).sort(), ['draft_auto', 'draft_slot_1']);
  } finally {
    mock.restore();
  }
});

test('saving a draft rejects when IndexedDB cannot be opened', async () => {
  const mock = installIndexedDbMock({ openError: new Error('database blocked') });
  try {
    const draft = { id: 'draft_slot_1' } as DraftSlot;
    await assert.rejects(saveDraftToDB(draft), /database blocked/);
  } finally {
    mock.restore();
  }
});

test('saving a draft rejects when its IndexedDB transaction aborts', async () => {
  const mock = installIndexedDbMock({ abortWrites: true });
  try {
    const draft = { id: 'draft_slot_1' } as DraftSlot;
    await assert.rejects(saveDraftToDB(draft), /write failed/);
  } finally {
    mock.restore();
  }
});
