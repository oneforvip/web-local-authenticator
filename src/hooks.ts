import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Account } from './types';
import { counterAt, generateCode } from './core/otp';

// One shared clock for the whole app, aligned to real second boundaries (no drift, no stale codes).
const subs = new Set<() => void>();
let snap = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
const tick = () => { snap = Date.now(); subs.forEach((f) => f()); timer = setTimeout(tick, 1000 - (snap % 1000) + 4); };
const subscribe = (f: () => void) => {
  if (!subs.size) { snap = Date.now(); timer = setTimeout(tick, 1000 - (snap % 1000) + 4); }
  subs.add(f);
  return () => { subs.delete(f); if (!subs.size) clearTimeout(timer); };
};
/** Current time in ms; re-renders the caller once per second. */
export const useNow = () => useSyncExternalStore(subscribe, () => snap);

export interface CodeInfo { sig: string; code: string; next: string }

/**
 * Codes are (re)computed only when an account's counter actually changes — once per period,
 * not once per second — and the next code is derived in the same pass.
 */
export function useCodes(accounts: Account[]): Record<string, CodeInfo> {
  const now = useNow();
  const [codes, setCodes] = useState<Record<string, CodeInfo>>({});
  const cache = useRef<Record<string, CodeInfo>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, CodeInfo> = {};
      let changed = Object.keys(cache.current).length !== accounts.length;
      for (const a of accounts) {
        const c = counterAt(a, now);
        const sig = `${a.kind}|${a.secret}|${a.algorithm}|${a.digits}|${a.period}|${c}`;
        const old = cache.current[a.id];
        if (old?.sig === sig) { next[a.id] = old; continue; }
        try { next[a.id] = { sig, code: await generateCode(a, c), next: await generateCode(a, c + 1n) }; }
        catch { next[a.id] = { sig, code: '', next: '' }; }
        changed = true;
      }
      if (cancelled) return;
      cache.current = next;
      if (changed) setCodes(next);
    })();
    return () => { cancelled = true; };
  }, [accounts, now]);
  return codes;
}
