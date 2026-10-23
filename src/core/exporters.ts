import type { Account } from '../types';
import type { Settings } from '../settings';
import { createVault, type Payload, type VaultEnvelope } from './crypto';
import { ACCOUNTS_FORMAT, SETTINGS_FORMAT } from './importers';
import { toOtpUri } from './otp';

export function downloadFile(filename: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const stamp = () => new Date().toISOString().slice(0, 10);

export const accountsJson = (accounts: Account[]) =>
  JSON.stringify({ format: ACCOUNTS_FORMAT, version: 1, exportedAt: new Date().toISOString(), accounts }, null, 2);

export const urisText = (accounts: Account[]) => accounts.map(toOtpUri).join('\n') + '\n';

export const settingsJson = (settings: Settings) =>
  JSON.stringify({ format: SETTINGS_FORMAT, version: 1, exportedAt: new Date().toISOString(), settings }, null, 2);

/** A self-contained encrypted file: accounts (+ optionally settings), protected by its own password. */
export async function encryptedBackup(accounts: Account[], settings: Settings | null, password: string, iterations: number): Promise<VaultEnvelope> {
  const payload: Payload = { schema: 2, accounts, savedAt: Date.now(), ...(settings ? { settings } : {}) };
  return (await createVault(password, payload, iterations)).envelope;
}
