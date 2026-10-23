import { useState } from 'react';
import { confirmDialog, closeDialog, openDialog, startSession, unlock, useStore, wipeEverything } from '../store';
import { WrongPassword } from '../core/crypto';
import { Icon } from './icons';

export function Welcome() {
  return (
    <main className="center-screen">
      <div className="hero">
        <div className="logo-lg"><Icon name="logo" size={34} /></div>
        <h1>Local Authenticator</h1>
        <p className="lead">One-time codes for your accounts — generated on this device, stored encrypted, never sent anywhere.</p>
        <div className="choices big">
          <button className="choice primary" onClick={() => openDialog({ type: 'password', purpose: 'create' })}>
            <Icon name="lock" size={22} /><span><b>Create an encrypted vault</b><small>Recommended. Protected by your password and saved in this browser.</small></span>
          </button>
          <button className="choice" onClick={() => openDialog({ type: 'import' })}>
            <Icon name="upload" size={22} /><span><b>Restore or import</b><small>Encrypted backup, Google Authenticator, Aegis, Steam .maFile, QR code.</small></span>
          </button>
          <button className="choice" onClick={startSession}>
            <Icon name="eye" size={22} /><span><b>Just try it</b><small>Nothing is saved. Everything is gone when you close the tab.</small></span>
          </button>
        </div>
        <ul className="facts"><li><Icon name="globeOff" size={16} /> No network access</li><li><Icon name="shield" size={16} /> AES-256 encrypted</li><li><Icon name="refresh" size={16} /> Works offline</li></ul>
      </div>
    </main>
  );
}

export function Locked() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const everything = useStore((s) => s.accounts.length);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await unlock(pw); }
    catch (err) { setError(err instanceof WrongPassword ? 'That password didn’t unlock the vault. Check caps lock and try again.' : (err as Error).message); setBusy(false); setPw(''); }
  }
  return (
    <main className="center-screen">
      <form className="hero narrow" onSubmit={submit}>
        <div className="logo-lg"><Icon name="lock" size={32} /></div>
        <h1>Vault locked</h1>
        <p className="lead">Enter your password to see your codes.</p>
        <label className="field">Password
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus aria-invalid={!!error} aria-describedby={error ? 'unlock-err' : undefined} />
        </label>
        {error && <div id="unlock-err" className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
        <button className="btn primary block" disabled={!pw || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        <div className="links">
          <button type="button" className="link" onClick={() => openDialog({ type: 'import' })}>Restore from backup</button>
          {!everything && <button type="button" className="link" onClick={startSession}>Use without saving</button>}
          <button type="button" className="link danger" onClick={() => confirmDialog({
            title: 'Forgot your password?', message: 'There is no way to recover it. You can erase this vault and start fresh — or cancel and restore from an encrypted backup instead. Erasing permanently deletes everything stored in this browser.',
            confirmLabel: 'Erase vault', danger: true, onConfirm: async () => { await wipeEverything(); closeDialog(); },
          })}>Forgot password?</button>
        </div>
      </form>
    </main>
  );
}
