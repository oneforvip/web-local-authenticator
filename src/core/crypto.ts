import type { Account } from '../types';
import type { Settings } from '../settings';
import { base64ToBytes, bytesToBase64 } from './encoding';

export const VAULT_FORMAT = 'local-authenticator-vault';
export const VAULT_VERSION = 3;
const MIN_ITER = 100_000;
const MAX_ITER = 10_000_000; // a hostile file must not be able to freeze the tab with a huge count

export interface VaultEnvelope {
  format: typeof VAULT_FORMAT;
  version: typeof VAULT_VERSION;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: 'AES-256-GCM';
  iv: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

/** What lives inside the encryption. */
export interface Payload { schema: 2; accounts: Account[]; settings?: Partial<Settings>; savedAt: number }

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The header is authenticated (AES-GCM AAD): editing iterations/salt/format in the file makes decryption fail. */
const aad = (e: Pick<VaultEnvelope, 'format' | 'version' | 'kdf'>) =>
  enc.encode(`${e.format}|${e.version}|${e.kdf.name}|${e.kdf.iterations}|${e.kdf.salt}`);

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function seal(header: Omit<VaultEnvelope, 'iv' | 'ciphertext' | 'updatedAt'>, key: CryptoKey, payload: Payload): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header) as BufferSource }, key, enc.encode(JSON.stringify(payload)));
  return { ...header, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ct)), updatedAt: new Date().toISOString() };
}

/** Derives the key once and returns it so callers don't pay the PBKDF2 cost twice. */
export async function createVault(password: string, payload: Payload, iterations: number): Promise<{ envelope: VaultEnvelope; key: CryptoKey }> {
  if (!password) throw new Error('Enter a password to protect the vault.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, iterations);
  const header = {
    format: VAULT_FORMAT, version: VAULT_VERSION, cipher: 'AES-256-GCM',
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt) }, createdAt: new Date().toISOString(),
  } as const;
  return { envelope: await seal(header, key, payload), key };
}

export function isEnvelope(x: unknown): x is VaultEnvelope {
  const e = x as Partial<VaultEnvelope> | null;
  return !!e && typeof e === 'object' && e.format === VAULT_FORMAT;
}

export async function openVault(envelope: VaultEnvelope, password: string): Promise<{ payload: Payload; key: CryptoKey }> {
  if (envelope.version !== VAULT_VERSION) throw new Error('This vault was made by an incompatible version of the app.');
  const { kdf } = envelope;
  if (!kdf || kdf.name !== 'PBKDF2-SHA256' || !envelope.iv || !envelope.ciphertext || !kdf.salt) throw new Error('The vault file is incomplete or damaged.');
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITER || kdf.iterations > MAX_ITER) throw new Error('The vault uses unsupported key-derivation settings.');
  const key = await deriveKey(password, base64ToBytes(kdf.salt), kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) as BufferSource, additionalData: aad(envelope) as BufferSource },
      key, base64ToBytes(envelope.ciphertext) as BufferSource,
    );
    const payload = JSON.parse(dec.decode(plain)) as Payload;
    if (!payload || !Array.isArray(payload.accounts)) throw new Error('bad payload');
    return { payload, key };
  } catch {
    throw new WrongPassword();
  }
}

export class WrongPassword extends Error {
  constructor() { super('Wrong password, or the vault data is damaged.'); }
}
