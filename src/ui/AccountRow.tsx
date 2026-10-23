import { memo, useEffect, useRef, useState } from 'react';
import type { Account } from '../types';
import type { Settings } from '../settings';
import type { CodeInfo } from '../hooks';
import { useNow } from '../hooks';
import { groupCode, timeLeft, toOtpUri } from '../core/otp';
import { copyCode, deleteAccount, moveAccount, openDialog, patchAccount, toast } from '../store';
import { Icon } from './icons';
import { Menu, MenuItem, MenuSep } from './Dialog';

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initial = (a: Account) => ([...(a.issuer || a.label || '?').trim()][0] ?? '?').toUpperCase();

function Timer({ a, style, warn }: { a: Account; style: Settings['timer']; warn: boolean }) {
  const now = useNow();
  if (a.kind === 'hotp') return <span className="counter" title="HOTP counter">#{a.counter}</span>;
  if (style === 'none' || style === 'bar') return null;
  const { remaining, fraction } = timeLeft(a, now);
  if (style === 'number') return <span className={`timer-num ${warn ? 'warn' : ''}`}>{remaining}s</span>;
  const C = 2 * Math.PI * 11;
  return (
    <span className={`ring ${warn ? 'warn' : ''}`} role="timer" aria-label={`${remaining} seconds left`}>
      <svg viewBox="0 0 28 28" width="100%" height="100%">
        <circle cx="14" cy="14" r="11" className="ring-bg" />
        <circle cx="14" cy="14" r="11" className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} transform="rotate(-90 14 14)" />
      </svg>
      <span className="ring-n">{remaining}</span>
    </span>
  );
}

function Bar({ a, warn }: { a: Account; warn: boolean }) {
  const now = useNow();
  if (a.kind === 'hotp') return null;
  return <span className={`bar ${warn ? 'warn' : ''}`}><span style={{ transform: `scaleX(${timeLeft(a, now).fraction})` }} /></span>;
}

interface Props {
  account: Account; info: CodeInfo | undefined; settings: Settings;
  canReorder: boolean; onDrop: (fromId: string, toId: string) => void; canMove: boolean;
}

export const AccountRow = memo(function AccountRow({ account: a, info, settings: s, canReorder, onDrop, canMove }: Props) {
  const now = useNow();
  const [copied, setCopied] = useState(false);
  const [revealUntil, setRevealUntil] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);

  const hidden = s.hideCodes !== 'off' && now >= revealUntil && Date.now() >= revealUntil;
  const left = a.kind === 'hotp' ? null : timeLeft(a, now);
  const warn = !!left && s.warnAt > 0 && left.remaining <= s.warnAt;
  const code = info?.code ?? '';
  const shown = groupCode(code, s.grouping);
  const style = s.avatar === 'color' ? ({ '--c': a.color || `hsl(${hue(a.issuer + a.label)} 62% 52%)` } as React.CSSProperties) : undefined;

  async function activate() {
    if (hidden) { setRevealUntil(Date.now() + s.revealSeconds * 1000); if (s.rowClick !== 'copy' || s.hideCodes === 'tap') return; }
    if (s.rowClick !== 'copy') return;
    if (await copyCode(a)) {
      setCopied(true); clearTimeout(timeout.current); timeout.current = setTimeout(() => setCopied(false), 1400);
    }
  }

  const title = a.issuer || a.label;
  const sub = a.issuer ? a.label : '';
  const meta = `${a.kind === 'steam' ? 'Steam Guard' : a.kind.toUpperCase()}${a.kind === 'steam' ? '' : ` · ${a.algorithm} · ${a.digits} digits`}${a.kind === 'totp' && a.period !== 30 ? ` · ${a.period}s` : ''}`;

  return (
    <div
      className={`row ${copied ? 'copied' : ''} ${dragOver ? 'drag-over' : ''}`}
      data-hide={s.hideCodes} data-hidden={hidden} data-warn={warn}
      draggable={canReorder}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { if (canReorder) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const from = e.dataTransfer.getData('text/plain'); if (from) onDrop(from, a.id); }}
    >
      <button type="button" className="row-hit" onClick={() => void activate()} data-row aria-label={hidden ? `Reveal code for ${title} ${sub}` : `Copy code for ${title} ${sub}: ${shown}`} />
      {s.avatar !== 'none' && <div className="avatar" style={style} aria-hidden="true">{initial(a)}</div>}
      <div className="title">
        <span className="issuer">{a.pinned && <Icon name="pin" size={12} />}<span className="name">{title}</span></span>
        {sub && <span className="label">{sub}</span>}
        {s.showMeta && <span className="meta">{meta}{a.group ? ` · ${a.group}` : ''}</span>}
      </div>
      {copied && <span className="copied-badge" role="status"><Icon name="check" size={14} /> Copied</span>}
      <div className={`code ${s.codeSize} ${warn ? 'warn' : ''}`} aria-live="off">
        <span className="digits">{hidden && s.hideCodes === 'tap' ? '•'.repeat(code.length || 6).replace(/(.{3})(?=.)/g, '$1 ') : shown || '······'}</span>
        {s.showNext && !hidden && info?.next && <span className="next">{a.kind === 'hotp' ? 'next' : 'then'} {groupCode(info.next, s.grouping)}</span>}
      </div>
      <Timer a={a} style={s.timer} warn={warn} />
      <Menu className="icon-btn" label={`Actions for ${title}`} trigger={<Icon name="more" />}>
        <MenuItem icon="copy" onClick={() => void activate()}>Copy code</MenuItem>
        <MenuItem icon="edit" onClick={() => openDialog({ type: 'account', account: a })}>Edit…</MenuItem>
        <MenuItem icon="pin" onClick={() => patchAccount(a.id, { pinned: !a.pinned })}>{a.pinned ? 'Unpin' : 'Pin to top'}</MenuItem>
        {a.kind === 'hotp' && <MenuItem icon="refresh" onClick={() => { patchAccount(a.id, { counter: String(BigInt(a.counter) + 1n) }); toast('Counter advanced'); }}>Advance counter</MenuItem>}
        {canMove && <><MenuItem icon="up" onClick={() => moveAccount(a.id, -1)}>Move up</MenuItem><MenuItem icon="down" onClick={() => moveAccount(a.id, 1)}>Move down</MenuItem></>}
        <MenuSep />
        <MenuItem icon="qr" onClick={() => openDialog({ type: 'qr', account: a })}>Show QR code</MenuItem>
        <MenuItem icon="key" onClick={() => void navigator.clipboard.writeText(toOtpUri(a)).then(() => toast('Link copied — it contains the secret, so keep it private', 'info'))}>Copy otpauth:// link</MenuItem>
        <MenuSep />
        <MenuItem icon="trash" danger onClick={() => deleteAccount(a)}>Delete</MenuItem>
      </Menu>
      {s.timer === 'bar' && <Bar a={a} warn={warn} />}
    </div>
  );
});
