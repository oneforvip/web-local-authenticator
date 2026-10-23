import { useSyncExternalStore } from 'react';
import type { Account, Mode, Phase } from './types';
import { DEFAULTS, sanitizeSettings, type Settings } from './settings';
import { clearKeyCache, counterAt, generateCode, groupCode, normalizeAccount } from './core/otp';
import { createVault, openVault, seal, type Payload, type VaultEnvelope } from './core/crypto';
import { mergeAccounts, type Strategy } from './core/importers';
import { clearSettings, deleteVault, isPersisted, loadSettings, loadVault, persistSettings, requestPersistence, saveVault } from './core/storage';

export type DialogState =
  | { type: 'account'; account?: Account }
  | { type: 'import'; start?: 'camera' }
  | { type: 'export' }
  | { type: 'settings'; tab?: string }
  | { type: 'password'; purpose: 'create' | 'change' }
  | { type: 'qr'; account: Account }
  | { type: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void> };

export interface Toast { id: number; text: string; kind: 'info' | 'success' | 'error'; action?: { label: string; run: () => void } }

export interface State {
  phase: Phase;
  mode: Mode;
  vaultExists: boolean;
  accounts: Account[];
  settings: Settings;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: number;
  dialog: DialogState | null;
  toasts: Toast[];
  search: string;
  group: string;
  persisted: boolean | null;
  blurred: boolean;
}

let state: State = {
  phase: 'booting', mode: 'session', vaultExists: false, accounts: [], settings: loadSettings(), saveState: 'idle', savedAt: 0,
  dialog: null, toasts: [], search: '', group: '', persisted: null, blurred: false,
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export const getState = () => state;
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => selector(state));
}

// Secrets that must never enter React state live here: the derived vault key and the last-saved envelope.
let vaultKey: CryptoKey | null = null;
let vaultHeader: VaultEnvelope | null = null;

// ── Toasts & dialogs ─────────────────────────────────────────────────────────
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  set({ toasts: [...state.toasts.slice(-2), { id, text, kind, ...(action ? { action } : {}) }] });
  setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : action ? 6000 : 2600);
}
export const dismissToast = (id: number) => set({ toasts: state.toasts.filter((t) => t.id !== id) });
export const openDialog = (d: DialogState) => set({ dialog: d });
export const closeDialog = () => set({ dialog: null });
export const confirmDialog = (d: Omit<Extract<DialogState, { type: 'confirm' }>, 'type'>) => openDialog({ type: 'confirm', ...d });

// ── Settings ─────────────────────────────────────────────────────────────────
export function applySettings(s: Settings) {
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = s.theme === 'system' ? (dark ? 'dark' : 'light') : s.theme;
  root.dataset.theme = theme;
  root.dataset.radius = s.radius; root.dataset.motion = s.motion; root.dataset.font = s.codeFont;
  root.style.setProperty('--accent', s.accent);
  const n = parseInt(s.accent.slice(1), 16);
  const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  root.style.setProperty('--on-accent', lum > 0.6 ? '#0b0d10' : '#ffffff');
  root.style.setProperty('--ui', String(s.uiScale));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5f7' : theme === 'black' ? '#000000' : '#0f1115');
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  persistSettings(settings); applySettings(settings); set({ settings });
}
export const resetSettings = () => { clearSettings(); updateSettings({ ...DEFAULTS, lastBackupAt: state.settings.lastBackupAt }); toast('Settings reset to defaults', 'success'); };
export const restoreSettings = (s: Partial<Settings>) => updateSettings(sanitizeSettings(s));
export const markBackedUp = () => updateSettings({ lastBackupAt: Date.now() });

// ── Persistence (vault mode autosaves every change) ──────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();

const payload = (): Payload => ({ schema: 2, accounts: getState().accounts, savedAt: Date.now() });

function scheduleSave() {
  if (state.mode !== 'vault' || !vaultKey) return;
  set({ saveState: 'saving' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 250);
}

export function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  saveChain = saveChain.then(async () => {
    if (state.mode !== 'vault' || !vaultKey || !vaultHeader) return;
    try {
      const { iv: _iv, ciphertext: _ct, updatedAt: _u, ...header } = vaultHeader;
      const envelope = await seal(header, vaultKey, payload());
      await saveVault(envelope);
      vaultHeader = envelope;
      set({ saveState: 'saved', savedAt: Date.now() });
    } catch (e) {
      set({ saveState: 'error' });
      toast(`Could not save the vault: ${(e as Error).message}`, 'error', { label: 'Retry', run: () => void flushSave() });
    }
  });
  return saveChain;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export async function boot() {
  applySettings(state.settings);
  let exists = false;
  try { exists = Boolean(await loadVault()); } catch { /* IndexedDB unavailable (e.g. some private modes) → session only */ }
  set({ vaultExists: exists, phase: exists ? 'locked' : 'welcome', persisted: await isPersisted() });
}

export function startSession() { set({ phase: 'ready', mode: 'session' }); }

export async function unlock(password: string) {
  const envelope = await loadVault();
  if (!envelope) throw new Error('No vault was found in this browser.');
  const { payload: p, key } = await openVault(envelope, password);
  let accounts = p.accounts.map((a) => normalizeAccount({ ...a, secretFormat: 'base32' }));
  // If the user worked in a session while the vault was locked, fold those accounts in rather than dropping them.
  const session = state.mode === 'session' && state.phase === 'ready' ? state.accounts : [];
  let merged = 0;
  if (session.length) { const r = mergeAccounts(accounts, session, 'skip'); accounts = r.accounts; merged = r.added; }
  vaultKey = key; vaultHeader = envelope;
  set({ accounts, mode: 'vault', phase: 'ready', vaultExists: true, saveState: 'saved', savedAt: Date.now() });
  if (merged) { scheduleSave(); toast(`Unlocked · added ${merged} account${merged === 1 ? '' : 's'} from this session`, 'success'); }
}

/** Create (or replace) the browser vault from whatever is currently loaded. */
export async function createBrowserVault(password: string) {
  const { envelope, key } = await createVault(password, payload(), state.settings.kdfIterations);
  await saveVault(envelope);
  vaultKey = key; vaultHeader = envelope;
  set({ mode: 'vault', phase: 'ready', vaultExists: true, saveState: 'saved', savedAt: Date.now() });
  void requestPersistence().then(async () => set({ persisted: await isPersisted() }));
}

export async function lock(reason: 'manual' | 'auto' = 'manual') {
  if (state.mode !== 'vault' || state.phase !== 'ready') return;
  await flushSave();
  vaultKey = null; vaultHeader = null; clearKeyCache();
  set({ accounts: [], phase: 'locked', dialog: null, search: '', group: '', saveState: 'idle', toasts: [] });
  if (reason === 'auto') toast('Locked after inactivity', 'info');
}

export async function wipeEverything() {
  clearTimeout(saveTimer);
  await deleteVault().catch(() => undefined);
  clearSettings(); vaultKey = null; vaultHeader = null; clearKeyCache();
  set({ accounts: [], vaultExists: false, mode: 'session', phase: 'welcome', dialog: null, settings: { ...DEFAULTS }, saveState: 'idle' });
  applySettings(DEFAULTS);
}

/** Load a decrypted backup. Returns how many accounts were added. */
export async function restoreBackup(envelope: VaultEnvelope, key: CryptoKey, p: Payload, how: 'adopt' | 'merge' | 'replace', strategy: Strategy, withSettings: boolean) {
  const incoming = p.accounts.map((a) => normalizeAccount({ ...a, secretFormat: 'base32' }));
  if (withSettings && p.settings) restoreSettings(p.settings);
  if (how === 'adopt') {
    await saveVault(envelope);
    vaultKey = key; vaultHeader = envelope;
    set({ accounts: incoming, mode: 'vault', phase: 'ready', vaultExists: true, saveState: 'saved', savedAt: Date.now(), dialog: null });
    void requestPersistence().then(async () => set({ persisted: await isPersisted() }));
    return incoming.length;
  }
  if (how === 'replace') { setAccounts(() => incoming); return incoming.length; }
  const r = mergeAccounts(state.accounts, incoming, strategy);
  setAccounts(() => r.accounts);
  return r.added + r.updated;
}

// ── Accounts ─────────────────────────────────────────────────────────────────
export function setAccounts(fn: (a: Account[]) => Account[]) {
  set({ accounts: fn(state.accounts) });
  scheduleSave();
}
export const addAccount = (a: Account) => setAccounts((l) => [...l, a]);
export const updateAccount = (a: Account) => setAccounts((l) => l.map((x) => (x.id === a.id ? a : x)));
export const patchAccount = (id: string, patch: Partial<Account>) => setAccounts((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));

export function importAccounts(list: Account[], strategy: Strategy) {
  const r = mergeAccounts(state.accounts, list, strategy);
  setAccounts(() => r.accounts);
  return r;
}

export function deleteAccount(a: Account) {
  const run = () => {
    const index = state.accounts.findIndex((x) => x.id === a.id);
    setAccounts((l) => l.filter((x) => x.id !== a.id));
    if (state.settings.deleteMode === 'undo') {
      toast(`Deleted “${a.issuer || a.label}”`, 'info', { label: 'Undo', run: () => setAccounts((l) => { const c = [...l]; c.splice(Math.min(index, c.length), 0, a); return c; }) });
    }
  };
  if (state.settings.deleteMode === 'confirm') confirmDialog({ title: 'Delete account?', message: `“${a.issuer ? `${a.issuer} · ` : ''}${a.label}” will be removed. Make sure you can still sign in to that service without it.`, confirmLabel: 'Delete', danger: true, onConfirm: () => { closeDialog(); run(); } });
  else run();
}

export function moveAccount(id: string, dir: -1 | 1) {
  setAccounts((l) => {
    const i = l.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const c = [...l]; [c[i], c[j]] = [c[j]!, c[i]!]; return c;
  });
}
export function reorder(fromId: string, toId: string) {
  setAccounts((l) => {
    const from = l.findIndex((x) => x.id === fromId), to = l.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return l;
    const c = [...l]; const [m] = c.splice(from, 1); c.splice(to, 0, m!); return c;
  });
}

let clipTimer: ReturnType<typeof setTimeout> | undefined;

/** Computes a fresh code (never a cached one), copies it, and handles HOTP advance + clipboard clearing. */
export async function copyCode(a: Account): Promise<boolean> {
  const s = state.settings;
  try {
    const code = await generateCode(a, counterAt(a, Date.now()));
    const text = s.copyFormat === 'grouped' ? groupCode(code, s.grouping) : code;
    await navigator.clipboard.writeText(text);
    const patch: Partial<Account> = { lastUsedAt: Date.now() };
    if (a.kind === 'hotp' && s.hotpAdvance) patch.counter = String(BigInt(a.counter) + 1n);
    patchAccount(a.id, patch);
    clearTimeout(clipTimer);
    if (s.clipboardClear > 0) clipTimer = setTimeout(() => void navigator.clipboard.writeText('').catch(() => undefined), s.clipboardClear * 1000);
    return true;
  } catch {
    toast('Your browser blocked clipboard access. Click the page and try again.', 'error');
    return false;
  }
}

// ── Search & filtering ───────────────────────────────────────────────────────
export const setSearch = (search: string) => set({ search });
export const setGroup = (group: string) => set({ group });

export function visibleAccounts(accounts: Account[], s: Settings, search: string, group: string): Account[] {
  const q = search.trim().toLowerCase();
  let list = accounts.filter((a) => (!group || a.group === group) && (!q || `${a.issuer} ${a.label} ${a.group}`.toLowerCase().includes(q)));
  const by: Record<string, ((a: Account, b: Account) => number) | undefined> = {
    issuer: (a, b) => (a.issuer || a.label).localeCompare(b.issuer || b.label, undefined, { sensitivity: 'base' }),
    label: (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    recent: (a, b) => b.lastUsedAt - a.lastUsedAt,
    created: (a, b) => b.createdAt - a.createdAt,
  };
  const cmp = by[s.sort];
  if (cmp) list = [...list].sort(cmp);
  if (s.pinnedFirst) list = [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];
  return list;
}

// ── Guards: auto-lock, hidden-tab lock, privacy blur, unsaved-work warning ────
export function initGuards(): () => void {
  let idle: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idle);
    const m = state.settings.autoLock;
    if (m > 0 && state.mode === 'vault' && state.phase === 'ready') idle = setTimeout(() => void lock('auto'), m * 60_000);
  };
  const onVisibility = () => {
    clearTimeout(hiddenTimer);
    const m = state.settings.lockOnHide;
    if (document.hidden && m > 0 && state.mode === 'vault') hiddenTimer = setTimeout(() => void lock('auto'), m * 60_000);
  };
  const onBlur = () => state.settings.privacyBlur && set({ blurred: true });
  const onFocus = () => state.blurred && set({ blurred: false });
  const onUnload = (e: BeforeUnloadEvent) => {
    if ((state.mode === 'session' && state.accounts.length > 0) || state.saveState === 'saving') { e.preventDefault(); e.returnValue = ''; }
  };
  const onScheme = () => applySettings(state.settings);
  const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
  events.forEach((n) => window.addEventListener(n, arm, { passive: true }));
  const unsub = (() => { listeners.add(arm); return () => listeners.delete(arm); })(); // re-arm when settings/phase change
  const mq = matchMedia('(prefers-color-scheme: dark)');
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
  window.addEventListener('beforeunload', onUnload); mq.addEventListener('change', onScheme);
  arm();
  return () => {
    clearTimeout(idle); clearTimeout(hiddenTimer);
    events.forEach((n) => window.removeEventListener(n, arm)); unsub();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
    window.removeEventListener('beforeunload', onUnload); mq.removeEventListener('change', onScheme);
  };
}
