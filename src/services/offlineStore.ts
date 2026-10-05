export interface SavedResource<T> { data: T; ts: number; }
const volatile = new Map<string, SavedResource<unknown>>();
let database: Promise<IDBDatabase | null> | undefined;
const MAX_RESOURCES = 160;
let generation = 0;

function remember(key: string, entry: SavedResource<unknown>) {
  volatile.delete(key); volatile.set(key, entry);
  while (volatile.size > MAX_RESOURCES) volatile.delete(volatile.keys().next().value!);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!database) database = new Promise((resolve) => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('zutnik-offline', 2); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains('resources')
        ? request.transaction!.objectStore('resources') : request.result.createObjectStore('resources');
      if (!store.indexNames.contains('ts')) store.createIndex('ts', 'ts');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return database;
}

export async function readResource<T>(key: string): Promise<SavedResource<T> | null> {
  const started = generation;
  const memory = volatile.get(key);
  if (memory) return memory as SavedResource<T>;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction('resources').objectStore('resources').get(key);
    request.onsuccess = () => {
      if (started !== generation) { resolve(null); return; }
      if (request.result) remember(key, request.result); resolve(request.result ?? null);
    };
    request.onerror = () => resolve(null);
  });
}

export async function saveResource<T>(key: string, data: T, ts = Date.now()): Promise<void> {
  const started = generation;
  const entry = { data, ts };
  remember(key, entry);
  const db = await openDatabase();
  if (!db || started !== generation) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction('resources', 'readwrite');
    const store = transaction.objectStore('resources');
    store.put(entry, key);
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - MAX_RESOURCES;
      if (excess <= 0) return;
      const cursor = store.index('ts').openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result || excess-- <= 0) return;
        volatile.delete(String(cursor.result.primaryKey)); cursor.result.delete(); cursor.result.continue();
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export async function removeResources(prefix: string, exact = false): Promise<void> {
  generation++;
  const matches = (key: string) => exact ? key === prefix : key.startsWith(prefix);
  for (const key of volatile.keys()) if (matches(key)) volatile.delete(key);
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction('resources', 'readwrite');
    const request = transaction.objectStore('resources').openCursor();
    request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (matches(String(cursor.key))) cursor.delete(); cursor.continue(); };
    transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve(); transaction.onabort = () => resolve();
  });
}
