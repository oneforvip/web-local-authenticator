export interface Settings {
  // Appearance
  theme: 'system' | 'light' | 'dark' | 'black';
  accent: string;
  uiScale: number;
  radius: 'sharp' | 'soft' | 'round';
  motion: 'system' | 'on' | 'off';
  codeFont: 'mono' | 'sans';
  // Display
  layout: 'list' | 'grid';
  density: 'comfortable' | 'compact' | 'dense';
  grouping: 'auto' | '2' | '3' | 'none';
  codeSize: 'sm' | 'md' | 'lg';
  avatar: 'color' | 'plain' | 'none';
  showMeta: boolean;
  showNext: boolean;
  timer: 'ring' | 'bar' | 'number' | 'none';
  warnAt: number;
  hideCodes: 'off' | 'tap' | 'blur';
  revealSeconds: number;
  sort: 'manual' | 'issuer' | 'label' | 'recent' | 'created';
  pinnedFirst: boolean;
  // Behaviour
  rowClick: 'copy' | 'none';
  copyFormat: 'plain' | 'grouped';
  clipboardClear: number;
  hotpAdvance: boolean;
  deleteMode: 'undo' | 'confirm' | 'none';
  shortcuts: boolean;
  // Security
  autoLock: number;
  lockOnHide: number;
  privacyBlur: boolean;
  kdfIterations: number;
  backupReminder: number;
  // Bookkeeping (not shown in the UI)
  lastBackupAt: number;
}

export const DEFAULTS: Settings = {
  theme: 'system', accent: '#4f7cff', uiScale: 1, radius: 'soft', motion: 'system', codeFont: 'mono',
  layout: 'list', density: 'comfortable', grouping: 'auto', codeSize: 'md', avatar: 'color',
  showMeta: true, showNext: false, timer: 'ring', warnAt: 5, hideCodes: 'off', revealSeconds: 10,
  sort: 'manual', pinnedFirst: true,
  rowClick: 'copy', copyFormat: 'plain', clipboardClear: 0, hotpAdvance: true, deleteMode: 'undo', shortcuts: true,
  autoLock: 15, lockOnHide: 0, privacyBlur: false, kdfIterations: 600_000, backupReminder: 30,
  lastBackupAt: 0,
};

export type Section = 'appearance' | 'display' | 'behavior' | 'security';
type Opt = readonly [value: string | number, label: string];

export interface Def {
  key: keyof Settings;
  section: Section;
  label: string;
  hint?: string;
  control: 'select' | 'segmented' | 'toggle' | 'range' | 'color';
  options?: readonly Opt[];
  min?: number; max?: number; step?: number; unit?: string;
  showIf?: (s: Settings) => boolean;
}

export const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'display', label: 'Accounts list', icon: 'list' },
  { id: 'behavior', label: 'Behaviour', icon: 'pointer' },
  { id: 'security', label: 'Security', icon: 'shield' },
];

export const ACCENTS = ['#4f7cff', '#7c5cff', '#d94fd0', '#e5484d', '#f08a24', '#d4a017', '#30a46c', '#14a8b8', '#8b949e'];

export const DEFS: Def[] = [
  { key: 'theme', section: 'appearance', label: 'Theme', control: 'segmented', options: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'OLED black']] },
  { key: 'accent', section: 'appearance', label: 'Accent colour', control: 'color' },
  { key: 'uiScale', section: 'appearance', label: 'Interface size', hint: 'Scales all text and controls.', control: 'range', min: 0.85, max: 1.3, step: 0.05 },
  { key: 'radius', section: 'appearance', label: 'Corners', control: 'segmented', options: [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']] },
  { key: 'codeFont', section: 'appearance', label: 'Code font', control: 'segmented', options: [['mono', 'Monospace'], ['sans', 'Sans-serif']] },
  { key: 'motion', section: 'appearance', label: 'Animations', hint: '“System” follows your OS reduced-motion setting.', control: 'segmented', options: [['system', 'System'], ['on', 'On'], ['off', 'Off']] },

  { key: 'layout', section: 'display', label: 'Layout', control: 'segmented', options: [['list', 'List'], ['grid', 'Grid']] },
  { key: 'density', section: 'display', label: 'Density', hint: 'Dense fits the most accounts on screen.', control: 'segmented', options: [['comfortable', 'Comfortable'], ['compact', 'Compact'], ['dense', 'Dense']] },
  { key: 'sort', section: 'display', label: 'Sort by', hint: 'In “My order” you can drag rows, or use Move up / down in a row’s menu.', control: 'select', options: [['manual', 'My order'], ['issuer', 'Issuer A–Z'], ['label', 'Account A–Z'], ['recent', 'Recently used'], ['created', 'Recently added']] },
  { key: 'pinnedFirst', section: 'display', label: 'Pinned accounts first', control: 'toggle' },
  { key: 'codeSize', section: 'display', label: 'Code size', control: 'segmented', options: [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] },
  { key: 'grouping', section: 'display', label: 'Digit grouping', hint: 'Auto: 123 456 for 6 digits, 1234 5678 for 8.', control: 'select', options: [['auto', 'Auto'], ['3', 'Groups of 3'], ['2', 'Groups of 2'], ['none', 'No spacing']] },
  { key: 'avatar', section: 'display', label: 'Account icon', control: 'segmented', options: [['color', 'Coloured letter'], ['plain', 'Neutral letter'], ['none', 'Hidden']] },
  { key: 'showMeta', section: 'display', label: 'Show type badges', hint: 'e.g. TOTP · SHA-1 · 6 digits (comfortable density only).', control: 'toggle' },
  { key: 'showNext', section: 'display', label: 'Show upcoming code', hint: 'The next TOTP code, or next counter value for HOTP.', control: 'toggle' },
  { key: 'timer', section: 'display', label: 'Countdown style', control: 'segmented', options: [['ring', 'Ring'], ['bar', 'Bar'], ['number', 'Number'], ['none', 'None']] },
  { key: 'warnAt', section: 'display', label: 'Expiry warning', hint: 'Highlight the code when this many seconds remain. 0 disables.', control: 'range', min: 0, max: 15, step: 1, unit: 's', showIf: (s) => s.timer !== 'none' },
  { key: 'hideCodes', section: 'display', label: 'Hide codes', hint: 'Protects against shoulder-surfing and screen sharing.', control: 'segmented', options: [['off', 'Show'], ['tap', 'Tap to reveal'], ['blur', 'Blur']] },
  { key: 'revealSeconds', section: 'display', label: 'Re-hide after', control: 'range', min: 3, max: 60, step: 1, unit: 's', showIf: (s) => s.hideCodes !== 'off' },

  { key: 'rowClick', section: 'behavior', label: 'Clicking an account', control: 'segmented', options: [['copy', 'Copies the code'], ['none', 'Does nothing']] },
  { key: 'copyFormat', section: 'behavior', label: 'Copied format', control: 'segmented', options: [['plain', 'No spaces'], ['grouped', 'As displayed']] },
  { key: 'clipboardClear', section: 'behavior', label: 'Clear clipboard after', hint: 'Overwrites the clipboard with empty text. Only works while this tab stays focused.', control: 'select', options: [[0, 'Never'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute']] },
  { key: 'hotpAdvance', section: 'behavior', label: 'Advance HOTP counter on copy', control: 'toggle' },
  { key: 'deleteMode', section: 'behavior', label: 'Deleting an account', control: 'select', options: [['undo', 'Delete, with Undo'], ['confirm', 'Ask first'], ['none', 'Delete immediately']] },
  { key: 'shortcuts', section: 'behavior', label: 'Keyboard shortcuts', hint: '/ search · N new · L lock · , settings · ↑↓ move · Enter copy', control: 'toggle' },

  { key: 'autoLock', section: 'security', label: 'Auto-lock when idle', hint: 'Applies to encrypted vaults. Clears secrets from the app.', control: 'select', options: [[0, 'Never'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']] },
  { key: 'lockOnHide', section: 'security', label: 'Lock when tab is hidden', control: 'select', options: [[0, 'Never'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes']] },
  { key: 'privacyBlur', section: 'security', label: 'Blur when window loses focus', control: 'toggle' },
  { key: 'kdfIterations', section: 'security', label: 'Password hardening', hint: 'PBKDF2 iterations for new vaults, backups and password changes. Higher is slower for attackers — and for you.', control: 'select', options: [[300_000, '300,000 (fast)'], [600_000, '600,000 (recommended)'], [1_000_000, '1,000,000'], [2_000_000, '2,000,000 (slow devices may struggle)']] },
  { key: 'backupReminder', section: 'security', label: 'Backup reminder', control: 'select', options: [[0, 'Off'], [7, 'After 7 days'], [30, 'After 30 days'], [90, 'After 90 days']] },
];

/** Validate untrusted settings (imports, localStorage) against the schema. Unknown keys are dropped. */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = src[key];
    const fallback = DEFAULTS[key];
    if (typeof v !== typeof fallback) continue;
    const def = DEFS.find((d) => d.key === key);
    if (key === 'accent') { if (!/^#[0-9a-f]{6}$/i.test(String(v))) continue; }
    else if (def?.options) { if (!def.options.some(([o]) => o === v)) continue; }
    else if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      const min = def?.min ?? 0; const max = def?.max ?? Number.MAX_SAFE_INTEGER;
      if (v < min || v > max) continue;
    }
    out[key] = v;
  }
  return out as Partial<Settings>;
}
