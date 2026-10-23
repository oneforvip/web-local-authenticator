import { useEffect, useMemo, useState } from 'react';
import type { Account } from '../types';
import type { SecretFormat } from '../core/encoding';
import { ACCENTS } from '../settings';
import { PRESETS, counterAt, generateCode, groupCode, normalizeAccount, parseOtpUri, timeLeft, type RawAccount } from '../core/otp';
import { addAccount, closeDialog, getState, toast, updateAccount, useStore } from '../store';
import { useNow } from '../hooks';
import { Icon } from './icons';
import { Dialog } from './Dialog';

type Form = RawAccount & { preset: string; issuer: string; label: string; secret: string; secretFormat: SecretFormat; digits: number; period: number; counter: string; group: string; color: string; pinned: boolean };

const blank = (): Form => ({ preset: 'totp', kind: 'totp', issuer: '', label: '', secret: '', secretFormat: 'auto', algorithm: 'SHA-1', digits: 6, period: 30, counter: '0', group: '', color: '', pinned: false });

export function AccountDialog({ account }: { account?: Account }) {
  const [f, setF] = useState<Form>(() => account
    ? { ...blank(), ...account, preset: account.kind === 'steam' ? 'steam' : account.kind === 'hotp' ? 'hotp' : 'totp', secretFormat: 'base32' }
    : blank());
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const groups = useStore((s) => s.accounts).reduce<string[]>((l, a) => (a.group && !l.includes(a.group) ? [...l, a.group] : l), []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setError(''); setF((c) => ({ ...c, [k]: v })); };
  const isSteam = f.kind === 'steam', isHotp = f.kind === 'hotp';

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    setF((c) => ({ ...c, ...(p.patch as Partial<Form>), preset: id, secretFormat: p.format as SecretFormat, issuer: c.issuer || (p.patch as { issuer?: string }).issuer || '' }));
  }

  function onSecret(v: string) {
    if (/^otpauth:\/\//i.test(v.trim())) {           // pasted a full link → fill the whole form
      try { const a = parseOtpUri(v); setF({ ...blank(), ...a, preset: a.kind === 'totp' ? 'totp' : a.kind, secretFormat: 'base32' }); setError(''); toast('Filled in from the link'); return; }
      catch (e) { setError((e as Error).message); }
    }
    set('secret', v);
  }

  // Live preview: proves the secret decodes and shows the code it would generate.
  const now = useNow();
  const [preview, setPreview] = useState<{ code: string } | { err: string } | null>(null);
  const draft = useMemo(() => { try { return normalizeAccount({ ...f, label: f.label || f.issuer || 'x' }); } catch (e) { return (e as Error).message; } }, [f]);
  useEffect(() => {
    if (!f.secret.trim()) { setPreview(null); return; }
    if (typeof draft === 'string') { setPreview({ err: draft }); return; }
    let live = true;
    generateCode(draft, counterAt(draft, now)).then((code) => live && setPreview({ code })).catch(() => live && setPreview({ err: 'Could not generate a code.' }));
    return () => { live = false; };
  }, [draft, f.secret, now]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const next = normalizeAccount({ ...f, id: account?.id, createdAt: account?.createdAt, lastUsedAt: account?.lastUsedAt });
      const dup = getState().accounts.find((x) => x.id !== next.id && x.secret === next.secret);
      if (account) updateAccount(next); else addAccount(next);
      closeDialog();
      toast(account ? 'Account updated' : dup ? `Added — note: “${dup.issuer || dup.label}” uses the same secret` : 'Account added', 'success');
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <Dialog title={account ? 'Edit account' : 'Add account'} onClose={closeDialog}
      footer={<><button type="button" className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" type="submit" form="account-form">{account ? 'Save' : 'Add account'}</button></>}>
      <form id="account-form" onSubmit={submit} className="stack">
        {!account && (
          <fieldset className="presets">
            <legend>What kind of account?</legend>
            {PRESETS.map((p) => (
              <label key={p.id} className={f.preset === p.id ? 'on' : ''}>
                <input type="radio" name="preset" checked={f.preset === p.id} onChange={() => applyPreset(p.id)} />
                <strong>{p.title}</strong><span>{p.hint}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid2">
          <label className="field">Issuer<input value={f.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="GitHub" autoComplete="off" data-autofocus /></label>
          <label className="field">Account name<input value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="name@example.com" autoComplete="off" /></label>
        </div>
        <div className="field">
          <label htmlFor="secret">Secret key</label>
          <div className="input-action">
            <input id="secret" name="otp-secret" type={showSecret ? 'text' : 'password'} value={f.secret} onChange={(e) => onSecret(e.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="off" data-1p-ignore data-lpignore="true" data-bwignore="true" placeholder={f.preset === 'battlenet' ? '40 hex characters' : isSteam ? 'shared_secret (Base32 or Base64)' : 'JBSWY3DPEHPK3PXP — or paste an otpauth:// link'} />
            <button type="button" className="icon-btn" onClick={() => setShowSecret((v) => !v)} aria-label={showSecret ? 'Hide secret' : 'Show secret'}><Icon name={showSecret ? 'eyeOff' : 'eye'} /></button>
          </div>
          <small>{f.preset === 'battlenet' ? 'Blizzard’s secret is a 40-character hex string. Spaces and dashes are ignored.' : isSteam ? 'Steam’s shared_secret, e.g. from a Steam Desktop Authenticator .maFile. Steam codes can’t be enrolled offline.' : 'Spaces, dashes and padding are ignored.'}</small>
        </div>
        <div className={`preview ${preview && 'err' in preview ? 'bad' : preview ? 'good' : ''}`} aria-live="polite">
          {!preview && <span className="muted">Enter a secret to see a test code.</span>}
          {preview && 'err' in preview && <><Icon name="alert" size={16} /> {preview.err}</>}
          {preview && 'code' in preview && typeof draft !== 'string' && <><Icon name="check" size={16} /> Test code <code>{groupCode(preview.code, 'auto')}</code>{draft.kind !== 'hotp' && <span className="muted"> · {timeLeft(draft, now).remaining}s left</span>}<span className="muted"> — compare with the service to be sure.</span></>}
        </div>

        <div className="grid2">
          <label className="field"><span>Group <span className="opt">optional</span></span><input value={f.group} onChange={(e) => set('group', e.target.value)} list="groups" placeholder="Work, Gaming…" autoComplete="off" /><datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></label>
          <div className="field"><span>Colour <span className="opt">optional</span></span>
            <div className="swatches">
              <button type="button" className={`sw none ${!f.color ? 'on' : ''}`} onClick={() => set('color', '')} aria-label="Automatic colour" title="Automatic">A</button>
              {ACCENTS.map((c) => <button key={c} type="button" className={`sw ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} aria-label={`Colour ${c}`} />)}
            </div>
          </div>
        </div>

        {!isSteam && (
          <details className="adv">
            <summary>Advanced settings</summary>
            <div className="grid3">
              <label className="field">Algorithm<select value={f.algorithm} onChange={(e) => set('algorithm', e.target.value as Form['algorithm'])}><option>SHA-1</option><option>SHA-256</option><option>SHA-512</option></select></label>
              <label className="field">Digits<select value={f.digits} onChange={(e) => set('digits', Number(e.target.value))}><option>6</option><option>7</option><option>8</option></select></label>
              {isHotp
                ? <label className="field">Counter<input inputMode="numeric" value={f.counter} onChange={(e) => set('counter', e.target.value.replace(/\D/g, ''))} /></label>
                : <label className="field">Period (s)<input type="number" min={1} max={3600} value={f.period} onChange={(e) => set('period', Number(e.target.value))} /></label>}
            </div>
            <label className="field">Secret format
              <select value={f.secretFormat} onChange={(e) => set('secretFormat', e.target.value as SecretFormat)} disabled={!!account}>
                <option value="auto">Detect automatically</option><option value="base32">Base32 (most services)</option><option value="hex">Hex (Battle.net)</option><option value="base64">Base64 (Steam .maFile)</option>
              </select>
            </label>
          </details>
        )}
        <label className="check"><input type="checkbox" checked={f.pinned} onChange={(e) => set('pinned', e.target.checked)} /> Pin to the top of the list</label>
        {error && <div className="alert bad" role="alert"><Icon name="alert" size={16} /> {error}</div>}
      </form>
    </Dialog>
  );
}
