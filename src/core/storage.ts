import type { VaultEnvelope } from './crypto';
import { DEFAULTS, sanitizeSettings, type Settings } from '../settings';

// ── Encrypted vault: IndexedDB (only ever holds ciphertext) ───────────────────
const DB = 'local-authenticator', STORE = 'kv', KEY = 'vault';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; resolve(r.result); };
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => { const r = run(store); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export const loadVault = async () => ((await tx('readonly', (s) => s.get(KEY))) as VaultEnvelope | undefined) ?? null;
export const saveVault = (e: VaultEnvelope) => tx('readwrite', (s) => s.put(e, KEY)).then(() => undefined);
export const deleteVault = () => tx('readwrite', (s) => s.delete(KEY)).then(() => undefined);

/** Ask the browser not to evict our storage under pressure (Safari is aggressive about this). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
export async function isPersisted(): Promise<boolean | null> {
  try { return (await navigator.storage?.persisted?.()) ?? null; } catch { return null; }
}

// ── Settings: localStorage (non-sensitive preferences only) ───────────────────
const SETTINGS_KEY = 'la:settings:v2';

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')) }; } catch { return { ...DEFAULTS }; }
}
export function persistSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* preferences are optional */ }
}
export function clearSettings() { try { localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ } }
