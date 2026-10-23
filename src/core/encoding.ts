const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!clean) throw new Error('The secret is empty.');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error(`“${ch}” is not a valid Base32 character (Base32 uses A–Z and 2–7).`);
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  if (!out.length) throw new Error('The secret is too short.');
  return Uint8Array.from(out);
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/\s/g, '');
  if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2) throw new Error('Hex secrets need an even number of 0–9 / A–F characters.');
  return Uint8Array.from(h.match(/../g)!.map((p) => parseInt(p, 16)));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}

export function base64ToBytes(value: string): Uint8Array {
  const v = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(v.padEnd(Math.ceil(v.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export type SecretFormat = 'auto' | 'base32' | 'hex' | 'base64';

/** Accepts a secret in any common encoding and returns canonical Base32. */
export function toBase32Secret(input: string, format: SecretFormat = 'auto'): string {
  const raw = input.trim();
  if (!raw) throw new Error('The secret is empty.');
  let f = format;
  if (f === 'auto') {
    const b32 = raw.replace(/[\s-]/g, '');
    if (/^[A-Za-z2-7]+=*$/.test(b32)) f = 'base32';
    else if (/^[0-9a-fA-F\s]+$/.test(raw) && raw.replace(/\s/g, '').length % 2 === 0) f = 'hex';
    else if (/^[A-Za-z0-9+/_\-\s]+=*$/.test(raw)) f = 'base64';
    else throw new Error('Could not recognise the secret format. Pick Base32, Hex or Base64 explicitly.');
  }
  const bytes = f === 'base32' ? base32Decode(raw) : f === 'hex' ? hexToBytes(raw) : base64ToBytes(raw);
  if (!bytes.length) throw new Error('The secret is too short.');
  return base32Encode(bytes);
}
