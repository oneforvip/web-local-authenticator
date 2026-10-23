import type { Account, Kind } from '../types';
import { sanitizeSettings, type Settings } from '../settings';
import { base64ToBytes, base32Encode } from './encoding';
import { isEnvelope, type VaultEnvelope } from './crypto';
import { normalizeAccount, parseOtpUri, type RawAccount } from './otp';

export const ACCOUNTS_FORMAT = 'local-authenticator-accounts';
export const SETTINGS_FORMAT = 'local-authenticator-settings';

export type Parsed =
  | { kind: 'accounts'; source: string; accounts: Account[]; warnings: string[] }
  | { kind: 'vault'; envelope: VaultEnvelope }
  | { kind: 'settings'; settings: Partial<Settings> };

// ── Minimal protobuf reader (for Google Authenticator "Export accounts" QR codes) ──
interface Field { num: number; wire: number; int?: bigint; bytes?: Uint8Array }

function* protoFields(buf: Uint8Array): Generator<Field> {
  let i = 0;
  const varint = (): bigint => {
    let r = 0n, shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('Truncated migration data.');
      const b = buf[i++]!; r |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return r;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const tag = Number(varint());
    const num = tag >>> 3, wire = tag & 7;
    if (wire === 0) yield { num, wire, int: varint() };
    else if (wire === 2) { const n = Number(varint()); yield { num, wire, bytes: buf.subarray(i, i + n) }; i += n; }
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error('Unsupported migration data.');
  }
}

function splitIssuer(name: string, issuer: string): { issuer: string; label: string } {
  if (!issuer) { const i = name.indexOf(':'); if (i > 0) return { issuer: name.slice(0, i).trim(), label: name.slice(i + 1).trim() }; }
  else if (name.toLowerCase().startsWith(`${issuer.toLowerCase()}:`)) return { issuer, label: name.slice(issuer.length + 1).trim() };
  return { issuer, label: name };
}

function parseMigration(uri: string, warnings: string[]): Account[] {
  const data = /[?&]data=([^&\s]+)/.exec(uri)?.[1];
  if (!data) throw new Error('This migration link has no data.');
  const bytes = base64ToBytes(decodeURIComponent(data));
  const out: Account[] = [];
  const dec = new TextDecoder();
  for (const f of protoFields(bytes)) {
    if (f.num !== 1 || !f.bytes) continue;
    let secret: Uint8Array = new Uint8Array(), name = '', issuer = '', algo = 0, digits = 0, type = 0, counter = 0n;
    for (const p of protoFields(f.bytes)) {
      if (p.num === 1 && p.bytes) secret = p.bytes;
      else if (p.num === 2 && p.bytes) name = dec.decode(p.bytes);
      else if (p.num === 3 && p.bytes) issuer = dec.decode(p.bytes);
      else if (p.num === 4) algo = Number(p.int);
      else if (p.num === 5) digits = Number(p.int);
      else if (p.num === 6) type = Number(p.int);
      else if (p.num === 7) counter = p.int ?? 0n;
    }
    try {
      if (algo === 4) throw new Error('MD5 accounts are not supported');
      const { issuer: iss, label } = splitIssuer(name, issuer);
      out.push(normalizeAccount({
        kind: type === 1 ? 'hotp' : 'totp', issuer: iss, label, secret: base32Encode(secret),
        algorithm: ({ 2: 'SHA-256', 3: 'SHA-512' } as Record<number, 'SHA-256' | 'SHA-512'>)[algo] ?? 'SHA-1',
        digits: digits === 2 ? 8 : 6, counter: String(counter),
      }));
    } catch (e) { warnings.push(`${name || 'An account'}: ${(e as Error).message}`); }
  }
  return out;
}

// ── Format-specific JSON importers ───────────────────────────────────────────
type J = Record<string, unknown>;
const isObj = (x: unknown): x is J => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown) => (typeof x === 'string' ? x : '');

function fromAegis(root: J, warnings: string[]): Account[] {
  const header = root.header as J | undefined;
  if (header && header.slots) throw new Error('This Aegis export is encrypted. In Aegis, export as plain JSON (or decrypt it first), then import it here.');
  const entries = ((root.db as J)?.entries ?? []) as J[];
  const out: Account[] = [];
  for (const e of entries) {
    const info = (e.info ?? {}) as J; const type = str(e.type).toLowerCase();
    try {
      if (!['totp', 'hotp', 'steam'].includes(type)) throw new Error(`“${type}” entries are not supported`);
      out.push(normalizeAccount({
        kind: type as Kind, issuer: str(e.issuer), label: str(e.name), secret: str(info.secret),
        algorithm: ({ SHA256: 'SHA-256', SHA512: 'SHA-512' } as Record<string, 'SHA-256' | 'SHA-512'>)[str(info.algo).toUpperCase()] ?? 'SHA-1',
        digits: Number(info.digits), period: Number(info.period), counter: String(info.counter ?? 0), pinned: e.favorite === true,
      }));
    } catch (err) { warnings.push(`${str(e.issuer) || str(e.name) || 'Entry'}: ${(err as Error).message}`); }
  }
  return out;
}

/** Steam Desktop Authenticator .maFile: shared_secret is Base64. (identity_secret — trade confirmations — is intentionally ignored.) */
function fromMaFile(o: J): Account {
  return normalizeAccount({ kind: 'steam', issuer: 'Steam', label: str(o.account_name) || 'Steam account', secret: str(o.shared_secret), secretFormat: 'base64' });
}

function fromGeneric(list: unknown[], warnings: string[]): Account[] {
  const out: Account[] = [];
  for (const item of list) {
    try {
      if (typeof item === 'string') out.push(parseOtpUri(item));
      else if (isObj(item)) out.push(normalizeAccount({ ...(item as RawAccount), id: undefined }));
    } catch (e) { warnings.push((e as Error).message); }
  }
  return out;
}

/** Figure out what a blob of text is and parse it. Throws a human-readable Error when nothing is recognised. */
export function parseImportText(input: string): Parsed {
  const text = input.trim().replace(/^\uFEFF/, '');
  if (!text) throw new Error('There is nothing to import.');
  const warnings: string[] = [];

  if (text.startsWith('{') || text.startsWith('[')) {
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error('That looks like JSON but could not be read.'); }
    if (isEnvelope(json)) return { kind: 'vault', envelope: json };
    if (isObj(json)) {
      if (json.format === SETTINGS_FORMAT) return { kind: 'settings', settings: sanitizeSettings(json.settings) };
      if (json.format === ACCOUNTS_FORMAT && Array.isArray(json.accounts)) return { kind: 'accounts', source: 'Local Authenticator', accounts: fromGeneric(json.accounts, warnings), warnings };
      if (isObj(json.header) && json.header.slots && typeof json.db === 'string') fromAegis(json, warnings); // throws: encrypted export
      if (isObj(json.db) && Array.isArray(json.db.entries)) return { kind: 'accounts', source: 'Aegis', accounts: fromAegis(json, warnings), warnings };
      if (typeof json.shared_secret === 'string') return { kind: 'accounts', source: 'Steam (.maFile)', accounts: [fromMaFile(json)], warnings };
      if (Array.isArray(json.accounts)) return { kind: 'accounts', source: 'JSON', accounts: fromGeneric(json.accounts, warnings), warnings };
    }
    if (Array.isArray(json)) {
      const maf = json.filter((x): x is J => isObj(x) && typeof x.shared_secret === 'string');
      if (maf.length) return { kind: 'accounts', source: 'Steam (.maFile)', accounts: maf.map(fromMaFile), warnings };
      return { kind: 'accounts', source: 'JSON', accounts: fromGeneric(json, warnings), warnings };
    }
    throw new Error('This JSON file is not a format the app recognises.');
  }

  const accounts: Account[] = [];
  let found = 0;
  for (const m of text.matchAll(/otpauth(?:-migration)?:\/\/[^\s"'<>]+/gi)) {
    found++;
    try {
      if (/^otpauth-migration/i.test(m[0])) accounts.push(...parseMigration(m[0], warnings));
      else accounts.push(parseOtpUri(m[0]));
    } catch (e) { warnings.push((e as Error).message); }
  }
  if (!found) throw new Error('No accounts found. Paste otpauth:// links, or choose a backup/export file.');
  return { kind: 'accounts', source: /otpauth-migration/i.test(text) ? 'Google Authenticator export' : 'otpauth:// links', accounts, warnings };
}

// ── Merging ──────────────────────────────────────────────────────────────────
export type Status = 'new' | 'duplicate' | 'conflict';
export type Strategy = 'skip' | 'replace' | 'both';
const ident = (a: Pick<Account, 'issuer' | 'label'>) => `${a.issuer}\n${a.label}`.toLowerCase();

export function classify(existing: Account[], a: Account): Status {
  if (existing.some((e) => e.secret === a.secret && ident(e) === ident(a))) return 'duplicate';
  if (existing.some((e) => ident(e) === ident(a) || (e.secret === a.secret && e.kind === a.kind))) return 'conflict';
  return 'new';
}

export function mergeAccounts(existing: Account[], incoming: Account[], strategy: Strategy) {
  const next = [...existing];
  let added = 0, updated = 0, skipped = 0;
  for (const raw of incoming) {
    const a = { ...raw, id: crypto.randomUUID() };
    const status = classify(next, a);
    if (status === 'duplicate' || (status === 'conflict' && strategy === 'skip')) { skipped++; continue; }
    if (status === 'conflict' && strategy === 'replace') {
      const i = next.findIndex((e) => ident(e) === ident(a) || (e.secret === a.secret && e.kind === a.kind));
      const old = next[i]!;
      next[i] = { ...a, id: old.id, pinned: old.pinned, group: a.group || old.group, color: a.color || old.color, createdAt: old.createdAt };
      updated++; continue;
    }
    next.push(a); added++;
  }
  return { accounts: next, added, updated, skipped };
}
