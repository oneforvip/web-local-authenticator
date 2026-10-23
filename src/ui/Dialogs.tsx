import { useEffect, useRef, useState } from 'react';
import type { Account } from '../types';
import { toOtpUri } from '../core/otp';
import { closeDialog, createBrowserVault, toast, useStore } from '../store';
import { Icon } from './icons';
import { Dialog } from './Dialog';

function strength(pw: string): { label: string; level: 0 | 1 | 2 | 3 } {
  if (!pw) return { label: '', level: 0 };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const words = pw.trim().split(/\s+/).length;
  const score = pw.length * Math.log2(Math.max(2, classes * 12)) + (words >= 4 ? 20 : 0);
  return score < 40 ? { label: 'Weak — easy to guess', level: 1 } : score < 65 ? { label: 'Okay', level: 2 } : { label: 'Strong', level: 3 };
}

export function PasswordDialog({ purpose }: { purpose: 'create' | 'change' }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const iterations = useStore((s) => s.settings.kdfIterations);
  const st = strength(pw);
  const valid = !!pw && pw === confirm && understood;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!valid) return;
    setBusy(true);
    try { await createBrowserVault(pw); closeDialog(); toast(purpose === 'create' ? 'Vault created — changes now save automatically' : 'Password changed', 'success'); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <Dialog title={purpose === 'create' ? 'Protect with a password' : 'Change password'} subtitle="Your accounts are encrypted in this browser. The password never leaves your device." onClose={closeDialog}
      footer={<><button type="button" className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" type="submit" form="pw-form" disabled={!valid || busy}>{busy ? 'Encrypting…' : purpose === 'create' ? 'Create vault' : 'Change password'}</button></>}>
      <form id="pw-form" className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pw1">Password</label>
          <div className="input-action">
            <input id="pw1" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-autofocus />
            <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eyeOff' : 'eye'} /></button>
          </div>
          {pw && <div className={`meter l${st.level}`} aria-live="polite"><span /><span /><span /><em>{st.label}</em></div>}
        </div>
        <label className="field">Confirm password<input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>
        {pw && confirm && pw !== confirm && <div className="alert bad"><Icon name="alert" size={16} /> The passwords don’t match.</div>}
        <div className="alert warn"><Icon name="alert" size={16} /> <span><b>There is no password recovery.</b> If you forget it, the vault can’t be opened. Keep an encrypted backup.</span></div>
        <label className="check"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand I can’t recover a forgotten password.</label>
        <small className="muted">Encryption: AES-256-GCM · key derived with PBKDF2-SHA-256, {iterations.toLocaleString()} iterations (change in Settings → Security).</small>
        {error && <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
      </form>
    </Dialog>
  );
}

export function QrDialog({ account }: { account: Account }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const uri = toOtpUri(account);
  useEffect(() => {
    let live = true;
    import('qrcode').then(async (m) => { if (live && canvas.current) await m.default.toCanvas(canvas.current, uri, { width: 280, margin: 2, errorCorrectionLevel: 'M' }); }).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [uri]);
  async function download() {
    const m = await import('qrcode');
    const url = await m.default.toDataURL(uri, { width: 1000, margin: 2, errorCorrectionLevel: 'M' });
    const a = Object.assign(document.createElement('a'), { href: url, download: `${(account.issuer || account.label).replace(/[^\w-]+/g, '-').toLowerCase()}-qr.png` });
    a.click();
  }
  return (
    <Dialog title={account.issuer || account.label} subtitle="Scan this with another authenticator to copy the account." onClose={closeDialog}
      footer={<><button className="btn" onClick={closeDialog}>Close</button><button className="btn primary" onClick={() => void download()}><Icon name="download" size={18} /> Save PNG</button></>}>
      <div className="stack center">
        <canvas ref={canvas} className="qr" aria-label={`QR code for ${account.label}`} />
        <div className="alert warn"><Icon name="alert" size={16} /> This code contains the secret. Anyone who scans it can generate your codes.</div>
        {error && <div className="alert bad">{error}</div>}
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm }: { title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={closeDialog}
      footer={<><button className="btn" onClick={closeDialog} data-autofocus>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }}>{confirmLabel}</button></>}>
      <p>{message}</p>
    </Dialog>
  );
}

