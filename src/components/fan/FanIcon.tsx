type IconName = 'shield' | 'guide' | 'write' | 'lookup' | 'evidence' | 'info'

export function FanIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths = {
    shield: <><path d="M12 2.5 20 6v5.5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3.5Z" /><path d="m9 12 2 2 4-4" /></>,
    guide: <><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></>,
    write: <><path d="M12 5v14M5 12h14" /><circle cx="12" cy="12" r="9" /></>,
    lookup: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3.5h6M8 10h8M8 14h5m2 1 2 2 3-3" /></>,
    evidence: <><path d="M8 12.5 15 5.5a3 3 0 0 1 4.2 4.2l-9.1 9.1a5 5 0 0 1-7.1-7.1l9-9" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}
