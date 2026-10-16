// Small line icons (1.6 stroke), drawn for this project.
import type { SVGProps } from 'react';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
type P = SVGProps<SVGSVGElement>;

export const IconMail = (p: P) => <svg {...base} {...p}><rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="M3.5 7l8.5 6 8.5-6" /></svg>;
export const IconWallet = (p: P) => <svg {...base} {...p}><path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18V7.5z" /><path d="M4 7.5l11-3v3" /><path d="M20 11.5h-4a1.5 1.5 0 0 0 0 3h4" /></svg>;
export const IconDoor = (p: P) => <svg {...base} {...p}><path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" /><path d="M3.5 20.5h17" /><circle cx="14.5" cy="12.5" r="0.9" fill="currentColor" /></svg>;
export const IconBack = (p: P) => <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>;
export const IconArrowLeft = (p: P) => <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /><path d="M8 12h12" /></svg>;
export const IconClose = (p: P) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconStar = ({ filled, ...p }: P & { filled?: boolean }) => <svg {...base} {...p} fill={filled ? 'currentColor' : 'none'}><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z" /></svg>;
export const IconArchive = (p: P) => <svg {...base} {...p}><rect x="3.5" y="4" width="17" height="4" rx="1" /><path d="M5 8v10.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>;
export const IconUnarchive = (p: P) => <svg {...base} {...p}><rect x="3.5" y="4" width="17" height="4" rx="1" /><path d="M5 8v10.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M12 17v-6M9.5 13.5L12 11l2.5 2.5" /></svg>;
export const IconUnread = (p: P) => <svg {...base} {...p}><rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="M3.5 7l8.5 6 8.5-6" /><circle cx="19" cy="6" r="2.6" fill="currentColor" stroke="none" /></svg>;
export const IconRead = (p: P) => <svg {...base} {...p}><path d="M3 10l9-6 9 6v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10z" /><path d="M3.5 10.5l8.5 5.5 8.5-5.5" /></svg>;
export const IconInbox = (p: P) => <svg {...base} {...p}><path d="M3.5 13.5l2.4-7.2a1 1 0 0 1 .9-.8h10.4a1 1 0 0 1 .9.8l2.4 7.2v4.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-4.5z" /><path d="M3.5 13.5h5l1 2h5l1-2h5" /></svg>;
export const IconDrop = (p: P) => <svg {...base} {...p}><path d="M4 8.5l8-4.5 8 4.5v7L12 20l-8-4.5v-7z" /><path d="M4 8.5l8 4.5 8-4.5M12 13v7" /></svg>;
export const IconSystem = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const IconSearch = (p: P) => <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>;
export const IconSound = ({ muted, ...p }: P & { muted?: boolean }) => (
  <svg {...base} {...p}><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />{muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></>}</svg>
);
export const IconMenu = (p: P) => <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
export const IconLock = (p: P) => <svg {...base} {...p}><rect x="5" y="10.5" width="14" height="10" rx="1.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;
export const IconFolder = (p: P) => <svg {...base} {...p}><path d="M3.5 6.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-12z" /></svg>;
export const IconPhone = (p: P) => <svg {...base} {...p}><rect x="7" y="2.8" width="10" height="18.4" rx="2" /><path d="M10.5 5.5h3" /><circle cx="12" cy="17.8" r="0.8" fill="currentColor" stroke="none" /></svg>;
export const IconShop = (p: P) => <svg {...base} {...p}><path d="M4 9.5l1.4-5h13.2l1.4 5" /><path d="M4 9.5c0 1.4 1.1 2.3 2.3 2.3S8.7 10.9 8.7 9.5c0 1.4 1.1 2.3 2.3 2.3h2c1.3 0 2.3-.9 2.3-2.3 0 1.4 1.1 2.3 2.4 2.3S20 10.9 20 9.5" /><path d="M5.5 11.6v8.4h13v-8.4" /><path d="M10 20v-4.5h4V20" /></svg>;
export const IconExit = (p: P) => <svg {...base} {...p}><path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" /><path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" /></svg>;
