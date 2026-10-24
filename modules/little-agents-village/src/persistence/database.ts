import { createPersistedWorld, migrateWorld, validateWorld, WORLD_ID, type PersistedWorld } from './worldData';
import type { Snapshot } from '../simulation/engine';
import { consolidateMemories } from '../memory/MemoryService';

const DB_NAME = 'little-agents-village';
const STORE = 'worlds';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'worldId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open world storage.'));
  });
}

export async function saveWorld(snapshot: Snapshot, checkpoints: Snapshot[] = []): Promise<PersistedWorld> {
  const created = createPersistedWorld(snapshot, checkpoints);
  const world = { ...created, memories: consolidateMemories(created.memories, 500) };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(world);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('World save failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('World save was interrupted.'));
  }).finally(() => db.close());
  return world;
}

export async function loadWorld(): Promise<PersistedWorld | null> {
  const db = await openDatabase();
  try {
    const world = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(WORLD_ID);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read saved world.'));
    });
    if (world === null) return null;
    try {
      const migrated = migrateWorld(world);
      if (!validateWorld(migrated)) throw new Error('Saved world failed validation.');
      if ((world as PersistedWorld).schemaVersion !== migrated.schemaVersion) await replaceWorld(migrated);
      return migrated;
    } catch (error) {
      const candidate = world as Partial<PersistedWorld>;
      const safeCheckpoints = Array.isArray(candidate.checkpoints) ? candidate.checkpoints.filter(isSnapshot) : [];
      const recovery = safeCheckpoints
        .sort((a, b) => b.tick - a.tick)[0];
      if (!recovery) throw error;
      const recovered = createPersistedWorld({ ...recovery, running: false }, safeCheckpoints);
      await replaceWorld(recovered);
      return recovered;
    }
  } finally {
    db.close();
  }
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<Snapshot>;
  return Number.isInteger(snapshot.tick) && (snapshot.tick ?? -1) >= 0
    && Array.isArray(snapshot.agents) && snapshot.agents.length > 0
    && Array.isArray(snapshot.events) && Array.isArray(snapshot.connections)
    && typeof snapshot.scenario === 'string';
}

export async function deleteWorld(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(WORLD_ID);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not reset saved world.'));
    });
  } finally {
    db.close();
  }
}

export async function replaceWorld(world: PersistedWorld): Promise<void> {
  if (!validateWorld(world)) throw new Error('Import rejected: invalid world file or unsupported schema version.');
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({ ...world, worldId: WORLD_ID });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Import write failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Import write was interrupted.'));
    });
  } finally {
    db.close();
  }
}
