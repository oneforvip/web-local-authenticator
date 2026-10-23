import { useEffect, useMemo, useRef, useState } from 'react';
import { boot, copyCode, dismissToast, getState, initGuards, lock, openDialog, reorder, setGroup, setSearch, toast, updateSettings, useStore, visibleAccounts } from '../store';
import { useCodes } from '../hooks';
import { Icon } from './icons';
import { Menu, MenuItem, MenuSep, Segmented } from './Dialog';
import { AccountRow } from './AccountRow';
import { AccountDialog } from './AccountDialog';
import { ImportDialog } from './ImportDialog';
import { ExportDialog } from './ExportDialog';
import { SettingsDialog } from './SettingsDialog';
import { ConfirmDialog, PasswordDialog, QrDialog } from './Dialogs';
import { Locked, Welcome } from './Screens';

function VaultChip() {
  const mode = useStore((s) => s.mode);
  const save = useStore((s) => s.saveState);
  if (mode === 'session') {
    return (
      <Menu className="chip warn" label="Storage" trigger={<><Icon name="alert" size={16} /><span className="hide-sm">Not saved</span></>}>
        <MenuItem icon="lock" onClick={() => openDialog({ type: 'password', purpose: 'create' })}>Save in this browser…</MenuItem>
        <MenuItem icon="download" onClick={() => openDialog({ type: 'export' })}>Back up to file…</MenuItem>
      </Menu>
    );
  }
  const label = save === 'saving' ? 'Saving…' : save === 'error' ? 'Save failed' : 'Encrypted';
  return (
    <Menu className={`chip ${save === 'error' ? 'bad' : 'good'}`} label="Vault" trigger={<><Icon name={save === 'error' ? 'alert' : 'shield'} size={16} /><span className="hide-sm">{label}</span></>}>
      <MenuItem icon="lock" onClick={() => void lock()}>Lock now</MenuItem>
      <MenuItem icon="download" onClick={() => openDialog({ type: 'export' })}>Back up to file…</MenuItem>
      <MenuItem icon="key" onClick={() => openDialog({ type: 'password', purpose: 'change' })}>Change password…</MenuItem>
      <MenuSep />
      <MenuItem icon="sliders" onClick={() => openDialog({ type: 'settings', tab: 'data' })}>Vault settings</MenuItem>
    </Menu>
  );
}

function TopBar() {
  const mode = useStore((s) => s.mode);
  return (
    <header className="topbar">
      <div className="brand"><span className="logo"><Icon name="logo" size={22} /></span><b className="hide-sm">Authenticator</b></div>
      <div className="grow" />
      <VaultChip />
      {mode === 'vault' && <button className="icon-btn" onClick={() => void lock()} aria-label="Lock now" title="Lock now (L)"><Icon name="lock" /></button>}
      <Menu className="btn primary" label="Add account" trigger={<><Icon name="plus" size={18} /><span>Add</span></>}>
        <MenuItem icon="camera" onClick={() => openDialog({ type: 'import', start: 'camera' })}>Scan QR code</MenuItem>
        <MenuItem icon="edit" onClick={() => openDialog({ type: 'account' })}>Enter manually</MenuItem>
        <MenuItem icon="upload" onClick={() => openDialog({ type: 'import' })}>Import from file or text…</MenuItem>
      </Menu>
      <button className="icon-btn" onClick={() => openDialog({ type: 'settings' })} aria-label="Settings" title="Settings (,)"><Icon name="sliders" /></button>
    </header>
  );
}

function ViewMenu() {
  const s = useStore((x) => x.settings);
  return (
    <Menu className="icon-btn" label="View options" keepOpen trigger={<Icon name={s.layout === 'grid' ? 'grid' : 'list'} />}>
      <div className="view-pop" role="group">
        <b>Layout</b><Segmented label="Layout" value={s.layout} options={[['list', 'List'], ['grid', 'Grid']]} onChange={(v) => updateSettings({ layout: v })} />
        <b>Density</b><Segmented label="Density" value={s.density} options={[['comfortable', 'Comfy'], ['compact', 'Compact'], ['dense', 'Dense']]} onChange={(v) => updateSettings({ density: v })} />
        <b>Sort</b>
        <select aria-label="Sort" value={s.sort} onChange={(e) => updateSettings({ sort: e.target.value as typeof s.sort })}>
          <option value="manual">My order</option><option value="issuer">Issuer A–Z</option><option value="label">Account A–Z</option><option value="recent">Recently used</option><option value="created">Recently added</option>
        </select>
        <label className="check"><input type="checkbox" checked={s.showNext} onChange={(e) => updateSettings({ showNext: e.target.checked })} /> Show upcoming code</label>
        <label className="check"><input type="checkbox" checked={s.hideCodes !== 'off'} onChange={(e) => updateSettings({ hideCodes: e.target.checked ? 'tap' : 'off' })} /> Hide codes until tapped</label>
        <button type="button" className="link" onClick={() => openDialog({ type: 'settings', tab: 'display' })}>More options…</button>
      </div>
    </Menu>
  );
}

function Banners() {
  const mode = useStore((s) => s.mode);
  const count = useStore((s) => s.accounts.length);
  const days = useStore((s) => s.settings.backupReminder);
  const last = useStore((s) => s.settings.lastBackupAt);
  const [hidden, setHidden] = useState(false);
  if (hidden || !count) return null;
  if (mode === 'session') return (
    <div className="banner warn"><Icon name="alert" size={18} /><span>These accounts exist only in this tab and will be lost when you close it.</span>
      <button className="btn sm primary" onClick={() => openDialog({ type: 'password', purpose: 'create' })}>Save in this browser</button>
      <button className="icon-btn sm" onClick={() => setHidden(true)} aria-label="Dismiss"><Icon name="x" size={16} /></button></div>
  );
  const due = days > 0 && (!last || Date.now() - last > days * 86_400_000);
  if (!due) return null;
  return (
    <div className="banner"><Icon name="info" size={18} /><span>{last ? `Your last backup was ${Math.floor((Date.now() - last) / 86_400_000)} days ago.` : 'You haven’t made a backup yet.'} Browsers can lose site data — keep a copy.</span>
      <button className="btn sm" onClick={() => openDialog({ type: 'export' })}>Back up</button>
      <button className="icon-btn sm" onClick={() => setHidden(true)} aria-label="Dismiss"><Icon name="x" size={16} /></button></div>
  );
}

function Home() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const search = useStore((s) => s.search);
  const group = useStore((s) => s.group);
  const list = useMemo(() => visibleAccounts(accounts, settings, search, group), [accounts, settings, search, group]);
  const codes = useCodes(list);
  const groups = useMemo(() => [...new Set(accounts.map((a) => a.group).filter(Boolean))].sort(), [accounts]);
  const canReorder = settings.sort === 'manual' && !search && !group;

  const nav = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); e.preventDefault();
  };

  if (!accounts.length) return (
    <section className="empty">
      <h2>Add your first account</h2><p className="muted">Most services show a QR code when you turn on two-factor authentication.</p>
      <div className="source-grid">
        <button className="source" onClick={() => openDialog({ type: 'import', start: 'camera' })}><Icon name="camera" size={22} /><b>Scan a QR code</b><span>Camera, screen or screenshot</span></button>
        <button className="source" onClick={() => openDialog({ type: 'account' })}><Icon name="edit" size={22} /><b>Enter a key</b><span>Including Steam &amp; Battle.net</span></button>
        <button className="source" onClick={() => openDialog({ type: 'import' })}><Icon name="upload" size={22} /><b>Import</b><span>Backup or another app</span></button>
      </div>
    </section>
  );

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={18} />
          <input id="search" type="search" placeholder="Search accounts   ( / )" value={search} autoComplete="off" aria-label="Search accounts" onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[0]) void copyCode(list[0]).then((ok) => ok && toast(`Copied code for ${list[0]!.issuer || list[0]!.label}`, 'success'));
              if (e.key === 'ArrowDown') document.querySelector<HTMLElement>('[data-row]')?.focus();
              if (e.key === 'Escape') { setSearch(''); (e.target as HTMLElement).blur(); }
            }} />
        </div>
        <ViewMenu />
      </div>
      {groups.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by group">
          <button className={!group ? 'on' : ''} onClick={() => setGroup('')}>All</button>
          {groups.map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
      )}
      {list.length === 0
        ? <p className="muted center pad">No accounts match “{search || group}”.</p>
        : <div className="list" data-layout={settings.layout} data-density={settings.density} onKeyDown={nav}>
            {list.map((a) => <AccountRow key={a.id} account={a} info={codes[a.id]} settings={settings} canReorder={canReorder} canMove={settings.sort === 'manual' && !search && !group} onDrop={reorder} />)}
          </div>}
    </>
  );
}

function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.type) {
    case 'account': return <AccountDialog account={d.account} />;
    case 'import': return <ImportDialog start={d.start} />;
    case 'export': return <ExportDialog />;
    case 'settings': return <SettingsDialog tab={d.tab} />;
    case 'password': return <PasswordDialog purpose={d.purpose} />;
    case 'qr': return <QrDialog account={d.account} />;
    case 'confirm': return <ConfirmDialog {...d} />;
  }
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dialog = useStore((s) => s.dialog);
  const el = useRef<HTMLDivElement>(null);
  // Popover = top layer: toasts stay visible above modal dialogs. Re-showing moves it above a newly opened dialog.
  useEffect(() => {
    const n = el.current; if (!n) return;
    try { n.hidePopover(); if (toasts.length) n.showPopover(); } catch { /* popover API unavailable */ }
  }, [toasts.length, dialog]);
  return (
    <div className="toasts" popover="manual" ref={el} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          <button className="x" onClick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const phase = useStore((s) => s.phase);
  const blurred = useStore((s) => s.blurred);

  useEffect(() => {
    void boot();
    const off = initGuards();
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    return off;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      if (!s.settings.shortcuts || s.dialog || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (s.phase !== 'ready') return;
      const k = e.key.toLowerCase();
      if (k === '/') { e.preventDefault(); document.getElementById('search')?.focus(); }
      else if (k === 'n') { e.preventDefault(); openDialog({ type: 'account' }); }
      else if (k === 'l' && s.mode === 'vault') void lock();
      else if (k === ',') { e.preventDefault(); openDialog({ type: 'settings' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (phase === 'booting') return null;
  return (
    <div className={`app ${blurred ? 'blurred' : ''}`}>
      {phase === 'welcome' && <Welcome />}
      {phase === 'locked' && <Locked />}
      {phase === 'ready' && <><TopBar /><main className="shell"><Banners /><Home /></main></>}
      <Dialogs />
      <Toasts />
      {blurred && <div className="privacy-cover"><Icon name="eyeOff" size={28} /><span>Hidden while this window is in the background</span></div>}
    </div>
  );
}
