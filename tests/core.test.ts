import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base32Encode, toBase32Secret } from '../src/core/encoding';
import { STEAM_ALPHABET, generateCode, groupCode, normalizeAccount, parseOtpUri, timeLeft, toOtpUri } from '../src/core/otp';
import { createVault, openVault, seal, WrongPassword } from '../src/core/crypto';
import { classify, mergeAccounts, parseImportText } from '../src/core/importers';
import { encryptedBackup } from '../src/core/exporters';
import { DEFAULTS, sanitizeSettings } from '../src/settings';

const ascii = (s: string) => base32Encode(new TextEncoder().encode(s));
const acct = (o: Partial<Parameters<typeof normalizeAccount>[0]> = {}) => normalizeAccount({ issuer: 'X', label: 'y', secret: 'JBSWY3DPEHPK3PXP', ...o });

describe('HOTP / TOTP (RFC 4226 / 6238 vectors)', () => {
  it('RFC 4226 counters 0–9', async () => {
    const exp = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    for (let i = 0; i < 10; i++) expect(await generateCode({ kind: 'hotp', secret: ascii('12345678901234567890'), algorithm: 'SHA-1', digits: 6, period: 30 }, BigInt(i))).toBe(exp[i]);
  });
  it('RFC 6238 SHA-1/256/512 (8 digits)', async () => {
    const cases: [string, 'SHA-1' | 'SHA-256' | 'SHA-512', number, string][] = [
      ['12345678901234567890', 'SHA-1', 59, '94287082'], ['12345678901234567890', 'SHA-1', 1111111109, '07081804'],
      ['12345678901234567890123456789012', 'SHA-256', 59, '46119246'],
      ['1234567890123456789012345678901234567890123456789012345678901234', 'SHA-512', 59, '90693936'],
    ];
    for (const [k, algorithm, t, code] of cases) expect(await generateCode({ kind: 'totp', secret: ascii(k), algorithm, digits: 8, period: 30 }, BigInt(Math.floor(t / 30)))).toBe(code);
  });
  it('handles counters beyond 2^32', async () => {
    expect(await generateCode({ kind: 'hotp', secret: ascii('12345678901234567890'), algorithm: 'SHA-1', digits: 6, period: 30 }, 2n ** 40n)).toBe('445672');
  });
});

describe('Steam Guard', () => {
  // Independent reference implementation using node:crypto.
  function ref(secretAscii: string, counter: number) {
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
    const mac = createHmac('sha1', secretAscii).update(buf).digest();
    const o = mac[19]! & 15;
    let n = ((mac[o]! & 0x7f) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!;
    let s = ''; for (let i = 0; i < 5; i++) { s += STEAM_ALPHABET[n % 26]; n = Math.floor(n / 26); }
    return s;
  }
  it('matches the reference and always uses 5 chars from the Steam alphabet', async () => {
    for (const c of [0, 1, 57_000_000, 58_123_456]) {
      const code = await generateCode({ kind: 'steam', secret: ascii('steam-shared-secret!'), algorithm: 'SHA-256', digits: 8, period: 99 }, BigInt(c));
      expect(code).toBe(ref('steam-shared-secret!', c));
      expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
    }
  });
  it('forces Steam parameters and accepts a Base64 shared_secret', () => {
    const a = acct({ kind: 'steam', digits: 8, period: 60, algorithm: 'SHA-512' });
    expect([a.digits, a.period, a.algorithm]).toEqual([5, 30, 'SHA-1']);
    expect(toBase32Secret(Buffer.from('steam-shared-secret!').toString('base64'), 'base64')).toBe(ascii('steam-shared-secret!'));
  });
});

describe('Battle.net hex secrets', () => {
  it('hex and base32 forms of the same key give the same code', async () => {
    const hex = '0123456789abcdef0123456789abcdef01234567';
    const b32 = toBase32Secret(hex, 'hex');
    expect(b32).toBe(base32Encode(Uint8Array.from(Buffer.from(hex, 'hex'))));
    const a = acct({ secret: hex, secretFormat: 'hex', digits: 8 });
    expect(await generateCode(a, 5n)).toBe(await generateCode({ ...a, secret: b32 }, 5n));
    expect(toBase32Secret(hex)).toBe(b32); // auto-detect picks hex (contains 0/1/8/9)
  });
});

describe('otpauth URIs', () => {
  it('round-trips awkward issuers and labels', () => {
    for (const [issuer, label] of [['A:B', 'x y@z'], ['Plain', 'me@example.com'], ['', 'solo'], ['Ünï', '名前']]) {
      const a = parseOtpUri(toOtpUri(acct({ issuer, label })));
      expect([a.issuer, a.label]).toEqual([issuer, label]);
    }
  });
  it('parses Battle.net-style and Steam-style links', () => {
    const b = parseOtpUri('otpauth://totp/Battle.net:EU123412341234:?secret=ASFAS75ASDF75889G9AD7S69AS7697AS&issuer=Battle.net&digits=8');
    expect([b.issuer, b.label, b.digits]).toEqual(['Battle.net', 'EU123412341234', 8]);
    expect(parseOtpUri('otpauth://steam/Steam:bob?secret=JBSWY3DPEHPK3PXP&issuer=Steam').kind).toBe('steam');
    expect(parseOtpUri('otpauth://totp/Steam:bob?secret=JBSWY3DPEHPK3PXP&encoder=steam').digits).toBe(5);
  });
  it('drops a legacy label prefix that differs from the issuer parameter', () => {
    const a = parseOtpUri('otpauth://totp/AWS:root@x.com?secret=JBSWY3DPEHPK3PXP&issuer=Amazon%20Web%20Services');
    expect([a.issuer, a.label]).toEqual(['Amazon Web Services', 'root@x.com']);
  });
  it('rejects bad input with clear errors', () => {
    expect(() => parseOtpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=9')).toThrow(/Digits/);
    expect(() => parseOtpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0')).toThrow(/period/i);
    expect(() => parseOtpUri('https://example.com')).toThrow();
    expect(() => acct({ kind: 'hotp', counter: '18446744073709551616' })).toThrow(/counter/i);
    expect(acct({ kind: 'hotp', counter: '' }).counter).toBe('0');
  });
});

describe('display helpers', () => {
  it('groups digits', () => {
    expect(groupCode('123456', 'auto')).toBe('123 456');
    expect(groupCode('12345678', 'auto')).toBe('1234 5678');
    expect(groupCode('1234567', 'auto')).toBe('123 4567');
    expect(groupCode('123456', '2')).toBe('12 34 56');
    expect(groupCode('ABCDE', 'auto')).toBe('ABCDE');
    expect(groupCode('123456', 'none')).toBe('123456');
  });
  it('reports time left', () => {
    expect(timeLeft({ kind: 'totp', period: 30 }, 30_000).remaining).toBe(30);
    expect(timeLeft({ kind: 'totp', period: 30 }, 59_001).remaining).toBe(1);
  });
});

describe('encrypted vault', () => {
  const payload = { schema: 2 as const, accounts: [acct()], savedAt: 1 };
  it('round-trips and saves with the same key', async () => {
    const { envelope, key } = await createVault('hunter2', payload, 100_000);
    const opened = await openVault(envelope, 'hunter2');
    expect(opened.payload.accounts[0]!.secret).toBe('JBSWY3DPEHPK3PXP');
    const resaved = await seal(envelope, key, { ...payload, savedAt: 2 });
    expect((await openVault(resaved, 'hunter2')).payload.savedAt).toBe(2);
  });
  it('rejects a wrong password and never reveals plaintext in the file', async () => {
    const { envelope } = await createVault('right', payload, 100_000);
    await expect(openVault(envelope, 'wrong')).rejects.toBeInstanceOf(WrongPassword);
    expect(JSON.stringify(envelope)).not.toContain('JBSWY3DPEHPK3PXP');
  });
  it('detects tampering with the authenticated header', async () => {
    const { envelope } = await createVault('pw', payload, 150_000);
    await expect(openVault({ ...envelope, kdf: { ...envelope.kdf, iterations: 150_001 } }, 'pw')).rejects.toBeInstanceOf(WrongPassword);
  });
  it('refuses absurd iteration counts instead of hanging', async () => {
    const { envelope } = await createVault('pw', payload, 100_000);
    await expect(openVault({ ...envelope, kdf: { ...envelope.kdf, iterations: 1e12 } }, 'pw')).rejects.toThrow(/unsupported/);
  });
  it('encryptedBackup can carry settings', async () => {
    const env = await encryptedBackup([acct()], DEFAULTS, 'pw', 100_000);
    expect((await openVault(env, 'pw')).payload.settings?.theme).toBe('system');
  });
});

describe('importers', () => {
  it('finds otpauth links inside arbitrary text and reports bad lines', () => {
    const r = parseImportText('hello\notpauth://totp/A:a?secret=JBSWY3DPEHPK3PXP&issuer=A\nnot this\notpauth://totp/B:b?secret=!!!');
    expect(r.kind === 'accounts' && r.accounts.length).toBe(1);
    expect(r.kind === 'accounts' && r.warnings.length).toBe(1);
  });
  it('reads a Google Authenticator migration QR', () => {
    const str = (n: number, s: Uint8Array) => [(n << 3) | 2, s.length, ...s];
    const te = new TextEncoder();
    const secret = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const otp = [...str(1, secret), ...str(2, te.encode('Acme:carol')), ...str(3, te.encode('Acme')), 0x20, 2, 0x28, 2, 0x30, 2];
    const data = Buffer.from(Uint8Array.from(str(1, Uint8Array.from(otp)))).toString('base64');
    const r = parseImportText(`otpauth-migration://offline?data=${encodeURIComponent(data)}`);
    if (r.kind !== 'accounts') throw new Error('expected accounts');
    const a = r.accounts[0]!;
    expect([a.issuer, a.label, a.algorithm, a.digits, a.kind, a.secret]).toEqual(['Acme', 'carol', 'SHA-256', 8, 'totp', base32Encode(secret)]);
  });
  it('reads Aegis plain JSON, Steam maFile and own formats; refuses encrypted Aegis', () => {
    const aegis = { version: 1, header: { slots: null }, db: { version: 2, entries: [
      { type: 'totp', name: 'me', issuer: 'Site', info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA256', digits: 8, period: 60 } },
      { type: 'yandex', name: 'x', issuer: 'Y', info: { secret: 'JBSWY3DPEHPK3PXP' } }] } };
    const a = parseImportText(JSON.stringify(aegis));
    expect(a.kind === 'accounts' && a.accounts.map((x) => [x.algorithm, x.digits, x.period])).toEqual([['SHA-256', 8, 60]]);
    expect(a.kind === 'accounts' && a.warnings.length).toBe(1);
    expect(() => parseImportText(JSON.stringify({ header: { slots: [{}] }, db: 'enc' }))).toThrow(/encrypted/);
    const ma = parseImportText(JSON.stringify({ shared_secret: Buffer.from('abcdefghij').toString('base64'), account_name: 'gabe', identity_secret: 'zzz' }));
    expect(ma.kind === 'accounts' && [ma.accounts[0]!.kind, ma.accounts[0]!.label]).toEqual(['steam', 'gabe']);
    expect(parseImportText(JSON.stringify({ format: 'local-authenticator-settings', settings: { theme: 'black', evil: 1 } }))).toEqual({ kind: 'settings', settings: { theme: 'black' } });
  });
  it('classifies and merges without silent overwrites', () => {
    const existing = [acct({ issuer: 'GitHub', label: 'me' })];
    expect(classify(existing, acct({ issuer: 'github', label: 'ME' }))).toBe('duplicate');
    const changed = acct({ issuer: 'GitHub', label: 'me', secret: 'GEZDGNBVGY3TQOJQ' });
    expect(classify(existing, changed)).toBe('conflict');
    expect(mergeAccounts(existing, [changed], 'skip').accounts[0]!.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(mergeAccounts(existing, [changed], 'replace').accounts[0]!.secret).toBe('GEZDGNBVGY3TQOJQ');
    expect(mergeAccounts(existing, [changed], 'both').accounts).toHaveLength(2);
  });
});

describe('settings validation', () => {
  it('drops unknown keys and out-of-range / wrong-typed values', () => {
    expect(sanitizeSettings({ theme: 'dark', accent: 'red', uiScale: 50, density: 'dense', junk: 1, warnAt: '5', autoLock: 15 }))
      .toEqual({ theme: 'dark', density: 'dense', autoLock: 15 });
  });
});
