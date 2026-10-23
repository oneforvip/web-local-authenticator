import { useState } from 'react';
import { accountsJson, downloadFile, encryptedBackup, settingsJson, stamp, urisText } from '../core/exporters';
import { closeDialog, markBackedUp, toast, useStore } from '../store';
import { Icon } from './icons';
import { Dialog } from './Dialog';

type Kind = 'backup' | 'json' | 'links' | 'settings';
const OPTIONS: { id: Kind; icon: string; title: string; hint: string; plain?: boolean }[] = [
  { id: 'backup', icon: 'lock', title: 'Encrypted backup', hint: 'Recommended. One file, protected by a password you choose. Restores on any device.' },
  { id: 'json', icon: 'file', title: 'Accounts as JSON', hint: 'Readable file with all account details, including secrets.', plain: true },
  { id: 'links', icon: 'key', title: 'otpauth:// links', hint: 'One link per account — the standard way to move accounts to other authenticator apps.', plain: true },
  { id: 'settings', icon: 'sliders', title: 'Settings only', hint: 'Your appearance and behaviour preferences. No accounts, no secrets.' },
];

export function ExportDialog() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const [kind, setKind] = useState<Kind>(accounts.length ? 'backup' : 'settings');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [withSettings, setWithSettings] = useState(true);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const opt = OPTIONS.find((o) => o.id === kind)!;
  const needsAccounts = kind !== 'settings';
  const ready = needsAccounts ? accounts.length > 0 : true;
  const valid = ready && (kind === 'backup' ? !!password && password === confirm : opt.plain ? ack : true);

  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (kind === 'backup') downloadFile(`authenticator-backup-${stamp()}.lavault.json`, JSON.stringify(await encryptedBackup(accounts, withSettings ? settings : null, password, settings.kdfIterations), null, 2));
      else if (kind === 'json') downloadFile(`authenticator-accounts-${stamp()}.json`, accountsJson(accounts));
      else if (kind === 'links') downloadFile(`authenticator-links-${stamp()}.txt`, urisText(accounts), 'text/plain');
      else downloadFile(`authenticator-settings-${stamp()}.json`, settingsJson(settings));
      if (needsAccounts) markBackedUp();
      toast('Export downloaded', 'success'); closeDialog();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog title="Export" subtitle="Files are created on this device and saved by your browser." onClose={closeDialog}
      footer={<><button type="button" className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" type="submit" form="export-form" disabled={!valid || busy}><Icon name="download" size={18} /> {busy ? 'Encrypting…' : 'Download'}</button></>}>
      <form id="export-form" className="stack" onSubmit={run}>
        <fieldset className="choices">
          <legend className="sr">What to export</legend>
          {OPTIONS.map((o) => (
            <label key={o.id} className={kind === o.id ? 'on' : ''}>
              <input type="radio" name="kind" checked={kind === o.id} onChange={() => { setKind(o.id); setError(''); }} />
              <Icon name={o.icon} /><span><b>{o.title}</b><small>{o.hint}</small></span>
            </label>
          ))}
        </fieldset>
        {!ready && <div className="alert warn"><Icon name="info" size={16} /> There are no accounts to export yet.</div>}
        {ready && kind === 'backup' && (
          <div className="stack tight">
            <div className="grid2">
              <label className="field">Backup password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" data-autofocus /></label>
              <label className="field">Confirm<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>
            </div>
            {password && confirm && password !== confirm && <div className="alert bad"><Icon name="alert" size={16} /> The passwords don’t match.</div>}
            <label className="check"><input type="checkbox" checked={withSettings} onChange={(e) => setWithSettings(e.target.checked)} /> Include my settings in the backup</label>
            <small className="muted">This password is separate from your browser vault’s and can’t be recovered — without it the file can’t be opened.</small>
          </div>
        )}
        {ready && opt.plain && (
          <div className="stack tight">
            <div className="alert warn"><Icon name="alert" size={16} /> <span><b>Not encrypted.</b> Anyone with this file can generate your codes. Store it somewhere safe and delete it when you’re done.</span></div>
            <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand this file is not protected.</label>
          </div>
        )}
        {error && <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
      </form>
    </Dialog>
  );
}
