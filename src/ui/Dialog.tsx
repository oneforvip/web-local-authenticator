import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

interface Props { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean; subtitle?: string }

/**
 * Built on the native <dialog> element: the browser provides the focus trap, Esc handling,
 * inert background and top-layer stacking — no hand-rolled (and usually buggy) equivalents.
 */
export function Dialog({ title, subtitle, onClose, children, footer, wide, side }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('.dlg-body input:not([type=checkbox]):not([type=radio]), .dlg-body textarea'))?.focus();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dlg ${wide ? 'wide' : ''} ${side ? 'side' : ''}`}
      aria-labelledby="dlg-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // Only a press that STARTS on the backdrop closes it, so dragging a text selection out of a field never discards work.
      onPointerDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && pressedBackdrop.current) onClose(); }}
    >
      <div className="dlg-panel">
        <header className="dlg-head">
          <div><h2 id="dlg-title">{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close"><Icon name="x" /></button>
        </header>
        <div className="dlg-body">{children}</div>
        {footer && <footer className="dlg-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** Dropdown menu with outside-click, Escape and arrow-key support. */
export function Menu({ trigger, label, children, keepOpen, className = '', align = 'end' }: { trigger: ReactNode; label: string; children: ReactNode; keepOpen?: boolean; className?: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); wrap.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...wrap.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); e.preventDefault();
      }
    };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>{trigger}</button>
      {open && <div className={`menu ${align}`} role="menu" onClick={keepOpen ? undefined : () => setOpen(false)}>{children}</div>}
    </div>
  );
}

export function MenuItem({ icon, children, danger, ...rest }: { icon?: string; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" role="menuitem" className={`menu-item ${danger ? 'danger' : ''}`} {...rest}>{icon && <Icon name={icon} size={18} />}<span>{children}</span></button>;
}
export const MenuSep = () => <hr className="menu-sep" />;

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}
