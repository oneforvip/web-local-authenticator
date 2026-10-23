export type Kind = 'totp' | 'hotp' | 'steam';
export type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

/** One authenticator entry. `secret` is always stored as canonical Base32. */
export interface Account {
  id: string;
  kind: Kind;
  issuer: string;
  label: string;
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
  /** HOTP counter as a decimal string (full unsigned 64-bit range, stored as text). */
  counter: string;
  group: string;
  /** Optional #rrggbb avatar colour; empty = derived from the issuer name. */
  color: string;
  pinned: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export type Mode = 'session' | 'vault';
export type Phase = 'booting' | 'welcome' | 'locked' | 'ready';
