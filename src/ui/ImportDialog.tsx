import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account } from '../types';
import type { Settings } from '../settings';
import { normalizeAccount } from '../core/otp';
import { decodeFrame, decodeImage, decoderName } from '../core/qr';
import { classify, parseImportText, type Parsed, type Status, type Strategy } from '../core/importers';
import { openVault, WrongPassword, type Payload, type VaultEnvelope } from '../core/crypto';
import { closeDialog, importAccounts, restoreBackup, restoreSettings, toast, useStore } from '../store';
import { Icon } from './icons';
import { Dialog } from './Dialog';

// ── Scanner ──────────────────────────────────────────────────────────────────
function friendly(e: unknown): string {
  const n = (e as DOMException)?.name;
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device. You can still scan from your screen, open a screenshot, or paste a link.';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permission was denied. Allow camera (or screen) access in your browser’s site settings and try again.';
  if (n === 'NotReadableError') return 'The camera is being used by another app.';
  return (e as Error)?.message || 'Could not start the scanner.';
}

function Scanner({ mode, onText, onCancel }: { mode: 'camera' | 'screen'; onText: (t: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    let stopped = false; let stream: MediaStream | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices) throw new Error('Camera access needs a secure page (https:// or localhost).');
        stream = mode === 'screen'
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
          : await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } } });
        // The panel may have been closed while the permission prompt was open — release the camera immediately.
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (mode === 'camera') {
          setActive(stream.getVideoTracks()[0]?.getSettings().deviceId ?? '');
          setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
        }
        stream.getVideoTracks()[0]?.addEventListener('ended', () => !stopped && setError('The video source stopped.'));
        const v = video.current!; v.srcObject = stream; await v.play();
        const loop = async () => {
          if (stopped) return;
          const text = await decodeFrame(v, 720).catch(() => null);
          if (stopped) return;
          if (text && /^otpauth(-migration)?:\/\//i.test(text)) { stopped = true; stream?.getTracks().forEach((t) => t.stop()); onText(text); return; }
          if (text) setHint('That QR code isn’t an authenticator code — keep looking.');
          timer = setTimeout(loop, 140);
        };
        loop();
      } catch (e) { if (!stopped) setError(friendly(e)); }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [mode, deviceId, onText]);

  return (
    <div className="scanner">
      {error ? <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div> : (
        <>
          <div className="viewfinder"><video ref={video} playsInline muted /><div className="reticle" /></div>
          <p className="muted small">{hint || (mode === 'screen' ? 'Choose the window or screen showing the QR code.' : 'Hold the QR code inside the square.')}</p>
        </>
      )}
      {mode === 'camera' && devices.length > 1 && (
        <label className="field">Camera<select value={deviceId || active} onChange={(e) => setDeviceId(e.target.value)}>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>
      )}
      <details className="explain"><summary>What is this doing?</summary>
        <p>Your browser gives this page a live video feed. Several times a second, one frame is copied to a hidden canvas and checked for a QR code using <b>{decoderName()}</b>, running on your device. Frames are never recorded, stored or sent anywhere — the app has no network access at all — and the camera switches off when a code is found or you close this panel.</p>
      </details>
      <div className="row-end"><button type="button" className="btn" onClick={onCancel}>Back</button></div>
    </div>
  );
}

// ── Import dialog ────────────────────────────────────────────────────────────
interface Preview { source: string; accounts: Account[]; warnings: string[] }
const BADGE: Record<Status, string> = { new: 'New', duplicate: 'Already here', conflict: 'Name clash' };

export function ImportDialog({ start }: { start?: 'camera' }) {
  const vaultExists = useStore((s) => s.vaultExists);
  const existing = useStore((s) => s.accounts);
  const mode = useStore((s) => s.mode);
  const [scan, setScan] = useState<null | 'camera' | 'screen'>(start ?? null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<Strategy>('both');
  const [vault, setVault] = useState<VaultEnvelope | null>(null);
  const [password, setPassword] = useState('');
  const [backup, setBackup] = useState<{ payload: Payload; key: CryptoKey; envelope: VaultEnvelope } | null>(null);
  const [withSettings, setWithSettings] = useState(true);
  const [how, setHow] = useState<'merge' | 'replace'>('merge');
  const [settingsPatch, setSettingsPatch] = useState<Partial<Settings> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A fresh browser with nothing in it can adopt the backup directly as its vault (same password, one step).
  const canAdopt = backup !== null && !vaultExists && mode === 'session' && existing.length === 0;

  const show = useCallback((p: Parsed) => {
    setError(''); setScan(null);
    if (p.kind === 'vault') { setVault(p.envelope); return; }
    if (p.kind === 'settings') { setSettingsPatch(p.settings); return; }
    if (!p.accounts.length) { setError(p.warnings[0] ?? 'No usable accounts were found.'); return; }
    setPreview({ source: p.source, accounts: p.accounts, warnings: p.warnings });
    setPicked(new Set(p.accounts.map((a) => a.id)));
  }, []);

  const ingestText = useCallback((t: string) => { try { show(parseImportText(t)); } catch (e) { setError((e as Error).message); setScan(null); } }, [show]);

  const ingestFiles = useCallback(async (files: File[]) => {
    setBusy(true); setError('');
    try {
      const texts: string[] = [];
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          const t = await decodeImage(f);
          if (!t) throw new Error(`No QR code could be read in “${f.name || 'the image'}”. Try a sharper or larger screenshot.`);
          texts.push(t);
        } else texts.push(await f.text());
      }
      // Multiple plain-text/QR sources are joined; a single JSON/vault file is passed through untouched.
      ingestText(texts.length === 1 ? texts[0]! : texts.join('\n'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [ingestText]);

  // Paste a screenshot (Win+Shift+S → Ctrl+V), or drop files anywhere on the dialog.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); void ingestFiles(files); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [ingestFiles]);

  async function unlockBackup(e: React.FormEvent) {
    e.preventDefault(); if (!vault) return;
    setBusy(true); setError('');
    try {
      const { payload, key } = await openVault(vault, password);
      const accounts = payload.accounts.map((a) => normalizeAccount({ ...a, secretFormat: 'base32' }));
      setBackup({ payload, key, envelope: vault });
      setVault(null);
      setPreview({ source: 'Encrypted backup', accounts, warnings: [] });
      setPicked(new Set(accounts.map((a) => a.id)));
    } catch (err) { setError(err instanceof WrongPassword ? err.message : (err as Error).message); } finally { setBusy(false); }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      if (backup && canAdopt) {
        const n = await restoreBackup(backup.envelope, backup.key, backup.payload, 'adopt', strategy, withSettings);
        toast(`Restored ${n} account${n === 1 ? '' : 's'} — this browser now keeps your vault (same password)`, 'success');
      } else if (backup && how === 'replace' && picked.size === preview.accounts.length) {
        const n = await restoreBackup(backup.envelope, backup.key, backup.payload, 'replace', strategy, withSettings);
        toast(`Replaced your accounts with ${n} from the backup`, 'success'); closeDialog();
      } else {
        const chosen = preview.accounts.filter((a) => picked.has(a.id));
        if (backup && withSettings && backup.payload.settings) restoreSettings(backup.payload.settings);
        const r = importAccounts(chosen, strategy);
        toast(`${r.added} added${r.updated ? ` · ${r.updated} updated` : ''}${r.skipped ? ` · ${r.skipped} skipped` : ''}`, 'success'); closeDialog();
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const statuses = preview ? preview.accounts.map((a) => classify(existing, a)) : [];
  const hasConflict = statuses.includes('conflict');

  let body: React.ReactNode;
  if (settingsPatch) {
    body = (<div className="stack"><div className="alert"><Icon name="info" size={16} /> This file contains <b>{Object.keys(settingsPatch).length}</b> settings and no accounts.</div>
      <div className="row-end"><button className="btn" onClick={() => setSettingsPatch(null)}>Back</button><button className="btn primary" onClick={() => { restoreSettings(settingsPatch); toast('Settings imported', 'success'); closeDialog(); }}>Apply settings</button></div></div>);
  } else if (vault) {
    body = (<form onSubmit={unlockBackup} className="stack"><div className="alert"><Icon name="lock" size={16} /> This is an encrypted backup. Enter the password it was created with.</div>
      <label className="field">Backup password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" data-autofocus /></label>
      {error && <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
      <div className="row-end"><button type="button" className="btn" onClick={() => { setVault(null); setError(''); }}>Back</button><button className="btn primary" disabled={busy || !password}>{busy ? 'Decrypting…' : 'Decrypt'}</button></div></form>);
  } else if (preview) {
    const n = picked.size;
    body = (
      <div className="stack">
        <p className="muted">Found <b>{preview.accounts.length}</b> account{preview.accounts.length === 1 ? '' : 's'} from <b>{preview.source}</b>.</p>
        {preview.warnings.length > 0 && <details className="alert warn"><summary>{preview.warnings.length} item{preview.warnings.length === 1 ? '' : 's'} skipped</summary><ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
        <ul className="pick-list">
          {preview.accounts.map((a, i) => (
            <li key={a.id}><label>
              <input type="checkbox" checked={picked.has(a.id)} onChange={(e) => setPicked((p) => { const c = new Set(p); if (e.target.checked) c.add(a.id); else c.delete(a.id); return c; })} />
              <span className="grow"><b>{a.issuer || a.label}</b>{a.issuer && <span className="muted"> · {a.label}</span>}</span>
              <span className="muted small">{a.kind === 'steam' ? 'Steam' : a.kind.toUpperCase()}</span>
              <span className={`badge ${statuses[i]}`}>{BADGE[statuses[i]!]}</span>
            </label></li>
          ))}
        </ul>
        {backup && (
          <div className="stack tight">
            {backup.payload.settings && <label className="check"><input type="checkbox" checked={withSettings} onChange={(e) => setWithSettings(e.target.checked)} /> Also restore the settings saved in this backup</label>}
            {canAdopt
              ? <div className="alert good"><Icon name="check" size={16} /> This browser has no vault yet, so the backup will become your vault here — same password, autosaved.</div>
              : <div className="field">When restoring<select value={how} onChange={(e) => setHow(e.target.value as 'merge' | 'replace')}><option value="merge">Add to my current accounts</option><option value="replace">Replace all my current accounts</option></select></div>}
          </div>
        )}
        {hasConflict && !canAdopt && how !== 'replace' && (
          <div className="field">If an account with the same name or secret already exists
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)}>
              <option value="both">Keep both (nothing is lost)</option><option value="skip">Keep mine (skip the imported one)</option><option value="replace">Replace mine with the imported one</option>
            </select></div>
        )}
        {error && <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
        <div className="row-end"><button className="btn" onClick={() => { setPreview(null); setBackup(null); }}>Back</button>
          <button className="btn primary" disabled={busy || (!n && !canAdopt)} onClick={() => void commit()}>{canAdopt ? 'Restore backup' : `Import ${n}`}</button></div>
      </div>
    );
  } else if (scan) {
    body = <Scanner mode={scan} onText={ingestText} onCancel={() => setScan(null)} />;
  } else {
    body = (
      <div className="stack">
        <div className="source-grid">
          <button className="source" onClick={() => setScan('camera')}><Icon name="camera" size={22} /><b>Scan with camera</b><span>Phone or webcam</span></button>
          <button className="source" onClick={() => setScan('screen')}><Icon name="monitor" size={22} /><b>Scan from screen</b><span>QR shown in a window</span></button>
          <button className="source" onClick={() => fileRef.current?.click()}><Icon name="file" size={22} /><b>Choose file</b><span>Backup, JSON, screenshot</span></button>
        </div>
        <input ref={fileRef} type="file" hidden multiple accept="image/*,.json,.txt,.maFile,.lavault,application/json,text/plain" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void ingestFiles(f); }} />
        <label className="field">…or paste text
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'otpauth://totp/GitHub:me?secret=…\notpauth-migration://offline?data=…'} spellCheck={false} data-autofocus />
          <small>You can also paste or drop a screenshot of a QR code anywhere in this window.</small></label>
        {busy && <p className="muted">Reading…</p>}
        {error && <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
        <details className="explain"><summary>Supported formats</summary>
          <ul><li><b>otpauth://</b> links and QR codes (Google, GitHub, most services, Battle.net, Aegis-style Steam)</li>
            <li><b>Google Authenticator</b> “Export accounts” QR / <code>otpauth-migration://</code> links</li>
            <li><b>Aegis</b> plain-JSON exports · <b>Steam Desktop Authenticator</b> <code>.maFile</code></li>
            <li><b>This app’s</b> encrypted backups, account lists and settings files</li></ul></details>
        <div className="row-end"><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={!text.trim()} onClick={() => ingestText(text)}>Continue</button></div>
      </div>
    );
  }

  return (
    <Dialog title={scan ? (scan === 'camera' ? 'Scan with camera' : 'Scan from screen') : 'Import accounts'} subtitle={scan || preview || vault || settingsPatch ? undefined : 'Everything is read on this device. Nothing is uploaded.'} onClose={closeDialog} wide={!!preview}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files]; if (f.length) void ingestFiles(f); }}>{body}</div>
    </Dialog>
  );
}

