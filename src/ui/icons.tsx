import type { ReactNode } from 'react';

const P = (d: string) => <path d={d} />;
const paths: Record<string, ReactNode> = {
  plus: P('M12 5v14M5 12h14'),
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
  more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>,
  check: P('m5 12.5 4.5 4.5L19 7.5'),
  x: P('M6 6l12 12M18 6 6 18'),
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  download: P('M12 4v11m0 0-4-4m4 4 4-4M5 20h14'),
  upload: P('M12 16V5m0 0L8 9m4-4 4 4M5 20h14'),
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h3v-3" /></>,
  camera: <><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 21h8M12 16v5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-8 8" /></>,
  edit: P('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  trash: P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'),
  pin: P('M12 17v5M8 3h8l-1.5 6 3.5 4H6l3.5-4z'),
  shield: P('M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z'),
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.5C3.6 9.3 2 12 2 12s3.5 6 10 6c1.4 0 2.6-.3 3.7-.7" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>,
  list: P('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'),
  chevron: P('m6 9 6 6 6-6'),
  up: P('M12 19V5m0 0-6 6m6-6 6 6'),
  down: P('M12 5v14m0 0 6-6m-6 6-6-6'),
  refresh: P('M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4'),
  alert: P('M12 4 2.5 20h19zM12 10v4.5M12 17.5v.01'),
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r=".8" /><circle cx="10" cy="7" r=".8" /><circle cx="15" cy="7" r=".8" /></>,
  pointer: P('M9 4v9l2.5-2 2 4.5 2-1-2-4.4H17zM9 4l0 0'),
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  file: P('M6 3h8l4 4v14H6zM14 3v4h4'),
  globeOff: <><circle cx="12" cy="12" r="9" /><path d="M3 3l18 18M3 12h8M12 3c2 2.3 3 5.3 3 9" /></>,
  logo: <><circle cx="12" cy="12" r="7.5" opacity=".35" /><path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.info}
    </svg>
  );
}
