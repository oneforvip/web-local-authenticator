# Local Authenticator

A private, offline authenticator for **TOTP, HOTP and Steam Guard** (plus Battle.net). It runs entirely in your browser: no account, no server, no analytics, and the browser is told not to allow *any* network request.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # RFC vectors, crypto, importers (22 tests)
npm run build      # type-check + production build into dist/
```

Needs a secure context (`https://` or `localhost`) for Web Crypto and the camera.

## Using it

| You want to… | Do this |
|---|---|
| Keep accounts between visits | **Create an encrypted vault** — AES-256-GCM, autosaved in this browser, unlocked with your password |
| Try it without committing | **Just try it** — nothing is stored; a banner and a tab-close warning remind you |
| Add an account | **Add ▾ → Scan QR / Enter manually / Import** (paste an `otpauth://` link into the secret field and the form fills itself) |
| Move to another device | **Export → Encrypted backup**, then **Restore** on the other device (a fresh browser adopts it as its vault, same password) |
| Migrate from another app | Import Google Authenticator export QRs, Aegis plain-JSON, Steam `.maFile`, `otpauth://` lists |
| Tune everything | **Settings** (the `⚙` drawer) — ~35 options, applied live; export/import them as a file |

Keyboard: `/` search · `Enter` (in search) copy top match · `↑↓` move · `Enter` copy · `N` add · `L` lock · `,` settings.

## Steam Guard and Battle.net

* **Steam Guard** is HMAC-SHA1/30 s like TOTP, but renders the result as 5 characters from `23456789BCDFGHJKMNPQRTVWXY`. Import an existing `shared_secret` (Base64 in a `.maFile`, or an Aegis-style `otpauth://steam/…` link). *Enrolling a new* Steam authenticator needs Steam's servers and is out of scope for an offline app; trade confirmations (`identity_secret`) are not supported.
* **Battle.net** is ordinary TOTP — 8 digits, SHA-1, 30 s — with a 40-char **hex** secret. Use the *Battle.net* preset (hex secrets are accepted everywhere via the *Secret format* option). Creating a new Blizzard authenticator needs Blizzard's servers.

## How "everything is local" is enforced

* Production CSP: `default-src 'none'; script-src 'self'; connect-src 'none'; form-action 'none'` — the browser refuses any outbound request, even if a dependency were compromised. (Verified in the e2e run: 0 external requests, 0 CSP violations.)
* One-time codes use Web Crypto (`HMAC`); QR decoding uses the native `BarcodeDetector` when present, otherwise bundled `jsQR` — both on-device. The camera is only opened while a scan panel is visible and is released when it closes.
* Vault: PBKDF2-SHA-256 (default 600k iterations, configurable) → AES-256-GCM with a random IV per save. The file header is authenticated (AAD), so tampering fails decryption; iteration counts from files are range-checked. The derived key is non-extractable and lives only in memory until lock.
* Storage: ciphertext in IndexedDB; non-secret preferences in `localStorage`. The service worker only caches same-origin files for offline use.

## Layout

```
src/core/   otp · encoding · crypto · storage · qr · importers · exporters   (no React, fully tested)
src/store.ts  tiny external store (useSyncExternalStore): vault lifecycle, autosave, auto-lock, guards
src/settings.ts  one schema → validation, defaults and the Settings UI
src/ui/     App · AccountRow · dialogs (native <dialog>) · Settings drawer
tests/      RFC 4226/6238 vectors, Steam cross-check, vault tamper tests, importers
```

## Deploy (GitHub Pages)

Commit `package-lock.json`, push to `main`, and enable **Settings → Pages → GitHub Actions**. Prefer a custom domain: on `user.github.io` every project page shares one origin (and therefore one IndexedDB/localStorage).

## Known limits / ideas

No passkey (WebAuthn-PRF) unlock yet; PBKDF2 rather than Argon2 (Web Crypto has no Argon2 — adding a WASM build would need a CSP `wasm-unsafe-eval`). The password can't be recovered by design.
