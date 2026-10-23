import { useEffect, useState } from 'react';
import { ACCENTS, DEFS, SECTIONS, type Def, type Settings } from '../settings';
import { closeDialog, confirmDialog, lock, openDialog, resetSettings, updateSettings, useStore, wipeEverything } from '../store';
import { isPersisted, requestPersistence } from '../core/storage';
import { Icon } from './icons';
import { Dialog, Segmented } from './Dialog';

function Control({ def, value }: { def: Def; value: Settings[keyof Settings] }) {
  const set = (v: unknown) => updateSettings({ [def.key]: v } as Partial<Settings>);
  switch (def.control) {
    case 'segmented': return <Segmented label={def.label} value={value as string} options={def.options as readonly (readonly [string, string])[]} onChange={set} />;
    case 'select': return (
      <select aria-label={def.label} value={String(value)} onChange={(e) => set(def.options!.find(([o]) => String(o) === e.target.value)![0])}>
        {def.options!.map(([o, l]) => <option key={String(o)} value={String(o)}>{l}</option>)}
      </select>);
    case 'toggle': return <input type="checkbox" role="switch" className="switch" aria-label={def.label} checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />;
    case 'range': return (
      <div className="range"><input type="range" aria-label={def.label} min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => set(Number(e.target.value))} />
        <output>{def.key === 'uiScale' ? `${Math.round(Number(value) * 100)}%` : `${value}${def.unit ?? ''}`}</output></div>);
    case 'color': return (
      <div className="swatches">
        {ACCENTS.map((c) => <button key={c} type="button" className={`sw ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set(c)} aria-label={`Accent ${c}`} />)}
        <label className="sw custom" title="Custom colour"><input type="color" value={String(value)} onChange={(e) => set(e.target.value)} aria-label="Custom accent colour" /></label>
      </div>);
  }
}

function SchemaPanel({ section }: { section: string }) {
  const s = useStore((x) => x.settings);
  return <>{DEFS.filter((d) => d.section === section && (!d.showIf || d.showIf(s))).map((d) => (
    <div className="setting" key={d.key}><div><b>{d.label}</b>{d.hint && <small>{d.hint}</small>}</div><Control def={d} value={s[d.key]} /></div>
  ))}</>;
}

function DataPanel() {
  const mode = useStore((s) => s.mode);
  const count = useStore((s) => s.accounts.length);
  const last = useStore((s) => s.settings.lastBackupAt);
  const persisted = useStore((s) => s.persisted);
  const [p, setP] = useState(persisted);
  useEffect(() => { void isPersisted().then(setP); }, []);
  return (
    <>
      <div className="setting"><div><b>Accounts</b><small>{count} stored · {mode === 'vault' ? 'encrypted in this browser' : 'session only (not saved)'}</small></div></div>
      <div className="setting"><div><b>Import</b><small>From a file, QR code, screenshot or pasted text.</small></div><button className="btn" onClick={() => openDialog({ type: 'import' })}><Icon name="upload" size={18} /> Import…</button></div>
      <div className="setting"><div><b>Export / back up</b><small>{last ? `Last backup: ${new Date(last).toLocaleDateString()}` : 'No backup made yet.'}</small></div><button className="btn" onClick={() => openDialog({ type: 'export' })}><Icon name="download" size={18} /> Export…</button></div>
      {mode === 'vault' ? (
        <>
          <div className="setting"><div><b>Vault password</b><small>Re-encrypts the vault with a new password and salt.</small></div><button className="btn" onClick={() => openDialog({ type: 'password', purpose: 'change' })}><Icon name="key" size={18} /> Change…</button></div>
          <div className="setting"><div><b>Lock now</b></div><button className="btn" onClick={() => void lock()}><Icon name="lock" size={18} /> Lock</button></div>
          <div className="setting"><div><b>Protected from eviction</b><small>{p === null ? 'Not reported by this browser.' : p ? 'Yes — the browser won’t clear the vault under storage pressure.' : 'No — browsers may delete site data if space runs low (Safari after ~7 days unused). Keep a backup.'}</small></div>
            {p === false && <button className="btn" onClick={() => void requestPersistence().then(() => isPersisted().then(setP))}>Request</button>}</div>
        </>
      ) : (
        <div className="setting"><div><b>Save in this browser</b><small>Encrypt your accounts and keep them between visits.</small></div><button className="btn primary" onClick={() => openDialog({ type: 'password', purpose: 'create' })}><Icon name="lock" size={18} /> Set up…</button></div>
      )}
      <div className="setting"><div><b>Reset settings</b><small>Restores every preference to its default. Accounts are untouched.</small></div><button className="btn" onClick={() => confirmDialog({ title: 'Reset all settings?', message: 'Your appearance and behaviour preferences go back to the defaults. Accounts are not affected.', confirmLabel: 'Reset', onConfirm: () => { closeDialog(); resetSettings(); } })}>Reset</button></div>
      <div className="setting danger-zone"><div><b>Erase everything</b><small>Deletes the vault, all accounts and all settings from this browser. Irreversible without a backup.</small></div>
        <button className="btn danger" onClick={() => confirmDialog({ title: 'Erase all data?', message: 'This permanently deletes the encrypted vault, every account and every setting stored by this app in this browser. Export a backup first if you might need it.', confirmLabel: 'Erase everything', danger: true, onConfirm: wipeEverything })}>Erase…</button></div>
    </>
  );
}

function AboutPanel() {
  return (
    <div className="about">
      <h3>What this app does</h3>
      <ul>
        <li><b>Generates one-time codes</b> (TOTP, HOTP and Steam Guard) with your browser’s built-in Web Crypto. No server is involved.</li>
        <li><b>Has no network access.</b> The page’s Content-Security-Policy is <code>connect-src 'none'</code>, so the browser itself refuses any request that could carry data out. After the first visit it works offline.</li>
        <li><b>Stores only ciphertext.</b> Vault mode keeps an AES-256-GCM-encrypted blob in IndexedDB. Your password and key exist only in memory and are dropped on lock.</li>
        <li><b>Keeps preferences in localStorage</b> — theme, layout and so on. They contain no secrets.</li>
        <li><b>Uses the camera only while scanning.</b> Frames are decoded on-device, never saved or sent, and the camera stops when you close the panel.</li>
      </ul>
      <h3>Supported services</h3>
      <ul>
        <li><b>Standard TOTP/HOTP</b> — Google, GitHub, Microsoft, banks, almost everything.</li>
        <li><b>Steam Guard</b> — import an existing <code>shared_secret</code> (e.g. from a <code>.maFile</code>). Enrolling a <i>new</i> Steam authenticator needs Steam’s servers, so it can’t be done here. Trade confirmations aren’t supported.</li>
        <li><b>Battle.net</b> — standard 8-digit TOTP with a hex secret; add via the Battle.net preset. Creating a new authenticator needs Blizzard’s servers.</li>
      </ul>
      <h3>Keyboard shortcuts</h3>
      <p className="muted"><kbd>/</kbd> search · <kbd>N</kbd> add · <kbd>L</kbd> lock · <kbd>,</kbd> settings · <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> copy</p>
    </div>
  );
}

export function SettingsDialog({ tab }: { tab?: string }) {
  const [cur, setCur] = useState(tab ?? 'appearance');
  const tabs = [...SECTIONS, { id: 'data', label: 'Data & backup', icon: 'database' }, { id: 'about', label: 'About & privacy', icon: 'info' }];
  return (
    <Dialog title="Settings" subtitle="Changes apply instantly." onClose={closeDialog} side>
      <div className="tabs" role="tablist">
        {tabs.map((t) => <button key={t.id} role="tab" aria-selected={cur === t.id} className={cur === t.id ? 'on' : ''} onClick={() => setCur(t.id)}><Icon name={t.icon} size={16} />{t.label}</button>)}
      </div>
      <div role="tabpanel" className="panel">
        {cur === 'data' ? <DataPanel /> : cur === 'about' ? <AboutPanel /> : <SchemaPanel section={cur} />}
      </div>
    </Dialog>
  );
}
