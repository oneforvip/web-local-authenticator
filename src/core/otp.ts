import type { Account, Algorithm, Kind } from '../types';
import { base32Decode, toBase32Secret, type SecretFormat } from './encoding';

export const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';
const MAX_U64 = 18446744073709551615n;

type Params = Pick<Account, 'kind' | 'secret' | 'algorithm' | 'digits' | 'period'>;

/** Steam Guard is fixed: HMAC-SHA1, 30 s, 5 characters from a custom alphabet. */
export function effective(a: Params): { algorithm: Algorithm; digits: number; period: number } {
  return a.kind === 'steam' ? { algorithm: 'SHA-1', digits: 5, period: 30 } : { algorithm: a.algorithm, digits: a.digits, period: a.period };
}

// Importing the HMAC key is the expensive step, so each (algorithm, secret) pair is imported once.
const keys = new Map<string, Promise<CryptoKey>>();
export const clearKeyCache = () => keys.clear();

function hmacKey(secret: string, algorithm: Algorithm): Promise<CryptoKey> {
  const id = `${algorithm}:${secret}`;
  let k = keys.get(id);
  if (!k) {
    k = crypto.subtle.importKey('raw', base32Decode(secret) as BufferSource, { name: 'HMAC', hash: algorithm }, false, ['sign']);
    keys.set(id, k);
  }
  return k;
}

export async function generateCode(a: Params, counter: bigint): Promise<string> {
  const { algorithm, digits } = effective(a);
  const msg = new DataView(new ArrayBuffer(8));
  msg.setBigUint64(0, BigInt.asUintN(64, counter), false);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(a.secret, algorithm), msg));
  const o = mac[mac.length - 1]! & 0x0f;
  let bin = ((mac[o]! & 0x7f) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!;
  if (a.kind === 'steam') {
    let out = '';
    for (let i = 0; i < 5; i++) { out += STEAM_ALPHABET[bin % 26]; bin = Math.floor(bin / 26); }
    return out;
  }
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function counterAt(a: Pick<Account, 'kind' | 'counter' | 'period'>, nowMs: number): bigint {
  if (a.kind === 'hotp') return BigInt(a.counter);
  return BigInt(Math.floor(nowMs / 1000 / (a.kind === 'steam' ? 30 : a.period)));
}

/** Seconds left (1…period) and the fraction of the period remaining. */
export function timeLeft(a: Pick<Account, 'kind' | 'period'>, nowMs: number) {
  const period = a.kind === 'steam' ? 30 : a.period;
  const left = period - ((nowMs / 1000) % period);
  return { remaining: Math.ceil(left), fraction: left / period, period };
}

export function groupCode(code: string, mode: 'auto' | '2' | '3' | 'none'): string {
  if (mode === 'none' || code.length <= 5 || !/^\d+$/.test(code)) return code;
  const size = mode === 'auto' ? (code.length === 8 ? 4 : 3) : Number(mode);
  const parts: string[] = [];
  for (let i = 0; i < code.length; i += size) parts.push(code.slice(i, i + size));
  // Avoid a dangling single digit (e.g. 7 digits in groups of 3 → 3 4 rather than 3 3 1).
  if (parts.length > 1 && parts[parts.length - 1]!.length === 1) { const last = parts.pop()!; parts[parts.length - 1] += last; }
  return parts.join(' ');
}

// ── Account construction & validation ────────────────────────────────────────

export interface RawAccount extends Partial<Omit<Account, 'secret'>> { secret?: string; secretFormat?: SecretFormat }

export function normalizeAccount(raw: RawAccount): Account {
  const kind: Kind = raw.kind === 'hotp' || raw.kind === 'steam' ? raw.kind : 'totp';
  const secret = toBase32Secret(String(raw.secret ?? ''), raw.secretFormat ?? 'auto');
  const algorithm: Algorithm = (['SHA-1', 'SHA-256', 'SHA-512'] as const).find((x) => x === raw.algorithm) ?? 'SHA-1';
  const digits = [6, 7, 8].includes(Number(raw.digits)) ? Number(raw.digits) : 6;
  const p = Number(raw.period);
  const period = Number.isInteger(p) && p >= 1 && p <= 3600 ? p : 30;
  let counter = '0';
  if (kind === 'hotp') {
    counter = String(raw.counter ?? '0').trim() || '0';
    if (!/^\d{1,20}$/.test(counter) || BigInt(counter) > MAX_U64) throw new Error('The counter must be a whole number between 0 and 18446744073709551615.');
    counter = String(BigInt(counter));
  }
  const label = String(raw.label ?? '').trim();
  const issuer = String(raw.issuer ?? '').trim();
  if (!label && !issuer) throw new Error('Give the account a name (issuer or label).');
  const now = Date.now();
  return {
    id: raw.id || crypto.randomUUID(), kind, issuer, label: label || issuer, secret,
    algorithm: kind === 'steam' ? 'SHA-1' : algorithm, digits: kind === 'steam' ? 5 : digits, period: kind === 'steam' ? 30 : period,
    counter, group: String(raw.group ?? '').trim().slice(0, 40),
    color: /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color! : '',
    pinned: Boolean(raw.pinned), createdAt: Number(raw.createdAt) || now, lastUsedAt: Number(raw.lastUsedAt) || 0,
  };
}

// ── otpauth:// URIs ──────────────────────────────────────────────────────────

const safeDecode = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, '%20')); } catch { return s; } };

export function parseOtpUri(uri: string): Account {
  const m = /^otpauth:\/\/(totp|hotp|steam)\/([^?#]*)\??([^#]*)/i.exec(uri.trim());
  if (!m) throw new Error('Not a valid otpauth:// link.');
  const type = m[1]!.toLowerCase();
  const q = new URLSearchParams(m[3]);
  let label = safeDecode(m[2]!);
  let issuer = q.get('issuer')?.trim() ?? '';
  if (issuer && label.toLowerCase().startsWith(`${issuer.toLowerCase()}:`)) label = label.slice(issuer.length + 1);
  else { // legacy "Issuer:account" label prefix — drop it when the issuer is given separately and differs (e.g. “AWS:root” + issuer “Amazon Web Services”)
    const i = label.indexOf(':');
    if (i > 0) { if (!issuer) issuer = label.slice(0, i); label = label.slice(i + 1); }
  }
  label = label.trim().replace(/:$/, '').trim();
  const steam = type === 'steam' || q.get('encoder')?.toLowerCase() === 'steam';
  const algo = (q.get('algorithm') ?? 'SHA1').toUpperCase().replace('-', '');
  const algorithm = ({ SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' } as const)[algo as 'SHA1'];
  if (!algorithm) throw new Error(`Unsupported algorithm “${q.get('algorithm')}”.`);
  const digits = Number(q.get('digits') ?? 6);
  if (!steam && ![6, 7, 8].includes(digits)) throw new Error('Digits must be 6, 7 or 8.');
  const period = Number(q.get('period') ?? 30);
  if (!Number.isInteger(period) || period < 1 || period > 3600) throw new Error('Invalid period.');
  return normalizeAccount({
    kind: steam ? 'steam' : (type as Kind), issuer, label, secret: q.get('secret') ?? '', algorithm, digits, period, counter: q.get('counter') ?? '0',
  });
}

export function toOtpUri(a: Account): string {
  const name = a.issuer && a.label ? `${a.issuer}:${a.label}` : a.issuer || a.label;
  const p = new URLSearchParams({ secret: a.secret });
  if (a.issuer) p.set('issuer', a.issuer);
  if (a.kind === 'steam') return `otpauth://steam/${encodeURIComponent(name)}?${p}&digits=5&period=30`;
  p.set('algorithm', a.algorithm.replace('-', ''));
  p.set('digits', String(a.digits));
  if (a.kind === 'totp') p.set('period', String(a.period)); else p.set('counter', a.counter);
  return `otpauth://${a.kind}/${encodeURIComponent(name)}?${p}`;
}

/** Presets shown when adding an account by hand. */
export const PRESETS = [
  { id: 'totp', title: 'Standard', hint: 'Google, GitHub, most websites', patch: { kind: 'totp', algorithm: 'SHA-1', digits: 6, period: 30 }, format: 'auto' },
  { id: 'steam', title: 'Steam Guard', hint: '5-letter codes', patch: { kind: 'steam', algorithm: 'SHA-1', digits: 5, period: 30 }, format: 'auto' },
  { id: 'battlenet', title: 'Battle.net', hint: 'Blizzard · 8 digits, hex key', patch: { kind: 'totp', algorithm: 'SHA-1', digits: 8, period: 30, issuer: 'Battle.net' }, format: 'hex' },
  { id: 'hotp', title: 'Counter-based', hint: 'HOTP · some banks & hardware', patch: { kind: 'hotp', algorithm: 'SHA-1', digits: 6 }, format: 'auto' },
] as const;
