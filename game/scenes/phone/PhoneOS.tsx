// The unlocked evidence phone: a small, original phone OS (home screen + apps), drawn as
// DOM inside the one phone model — no extra 3D, nothing re-rendered but the screen.
// Navigation: every app has Back and Home; Escape goes back one step.
import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useUiStore } from '../../state/uiStore';
import { playKeyTick } from '../../audio/uiAudio';
import {
  CALLS, CONTACTS, DEVICE_INFO, NOTES, PHOTOS, THREADS, callDateLong, callDay, callTime, formatDuration, formatNumber,
  type CallRecord, type Contact,
} from '../../data/phone';

type Route =
  | { app: 'home' }
  | { app: 'phone'; tab: 'recents' | 'contacts' | 'keypad'; callId?: string | null; contactId?: string | null }
  | { app: 'messages'; thread?: string | null }
  | { app: 'contacts'; contactId?: string | null }
  | { app: 'gallery'; photo?: string | null }
  | { app: 'notes'; note?: string | null }
  | { app: 'settings' };

const APPS: { id: Exclude<Route['app'], 'home'>; label: string; bg: string; icon: React.JSX.Element }[] = [
  { id: 'phone', label: 'Phone', bg: 'linear-gradient(180deg,#45d26a,#1f9e46)', icon: <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" fill="#fff" /> },
  { id: 'messages', label: 'Messages', bg: 'linear-gradient(180deg,#5bd47c,#26a852)', icon: <path d="M4.5 11.5c0-3.9 3.4-6.5 7.5-6.5s7.5 2.6 7.5 6.5S16.1 18 12 18c-1 0-2-.1-2.9-.4L5.5 19l1.1-3.1c-1.3-1.2-2.1-2.7-2.1-4.4z" fill="none" stroke="#fff" strokeWidth="1.8" /> },
  { id: 'contacts', label: 'Contacts', bg: 'linear-gradient(180deg,#9aa0a8,#5d636b)', icon: <g fill="none" stroke="#fff" strokeWidth="1.8"><circle cx="12" cy="9" r="3.4" /><path d="M5.5 19c.9-3.2 3.4-4.8 6.5-4.8s5.6 1.6 6.5 4.8" /></g> },
  { id: 'gallery', label: 'Gallery', bg: 'linear-gradient(180deg,#f6b04a,#e2653a)', icon: <g fill="none" stroke="#fff" strokeWidth="1.8"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17" /></g> },
  { id: 'notes', label: 'Notes', bg: 'linear-gradient(180deg,#ffd862,#f0b23a)', icon: <path d="M6 7h12M6 11h12M6 15h8" fill="none" stroke="#5b4310" strokeWidth="1.8" strokeLinecap="round" /> },
  { id: 'settings', label: 'Settings', bg: 'linear-gradient(180deg,#62666d,#2c2f34)', icon: <g fill="none" stroke="#fff" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6" strokeLinecap="round" /></g> },
];

const fmtShort = (iso: string) => `${callDay(iso)} ${callTime(iso)}`;

export function PhoneOS({ onExit }: { onExit(): void }) {
  // the dev panel's "Inspect call history" opens a call record directly
  const [route, setRoute] = useState<Route>(() => {
    const id = useUiStore.getState().phoneCallId;
    return id ? { app: 'phone', tab: 'recents', callId: id } : { app: 'home' };
  });
  const [brightness, setBrightness] = useState(1);
  const [sounds, setSounds] = useState(true);
  const appRef = useRef<HTMLDivElement>(null);
  const lastApp = useRef(route.app);

  const tick = () => { if (sounds) playKeyTick(); };
  const go = (r: Route) => { tick(); setRoute(r); };
  const home = () => go({ app: 'home' });
  const back = () => {
    const r = route;
    tick();
    if (r.app === 'home') { onExit(); return; }
    if (r.app === 'phone' && (r.callId || r.contactId)) { setRoute({ ...r, callId: null, contactId: null }); return; }
    if (r.app === 'messages' && r.thread) { setRoute({ app: 'messages' }); return; }
    if (r.app === 'contacts' && r.contactId) { setRoute({ app: 'contacts' }); return; }
    if (r.app === 'gallery' && r.photo) { setRoute({ app: 'gallery' }); return; }
    if (r.app === 'notes' && r.note) { setRoute({ app: 'notes' }); return; }
    setRoute({ app: 'home' });
  };

  useEffect(() => { useUiStore.getState().setPhoneCallId(route.app === 'phone' ? route.callId ?? null : null); }, [route]);

  // Escape = back one step (never while typing in a field)
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as Element)?.closest?.('input,textarea,select')) return;
      e.preventDefault();
      backRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // opening / closing an app: a quick zoom from the launcher (CSS-transform only)
  useLayoutEffect(() => {
    if (route.app !== lastApp.current && appRef.current) {
      if (route.app !== 'home') gsap.fromTo(appRef.current, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: 'power2.out' });
      else gsap.fromTo(appRef.current, { scale: 1.06, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.24, ease: 'power2.out' });
    }
    lastApp.current = route.app;
  }, [route.app]);

  const title = route.app === 'home' ? '' : APPS.find((a) => a.id === route.app)?.label ?? '';

  return (
    <div className="os" data-testid="phone-os" data-app={route.app}>
      <StatusBar time="02:16" />
      <div className="os-app" ref={appRef}>
        {route.app === 'home' && (
          <div className="os-home" data-testid="phone-home">
            <div className="os-home__clock"><div className="os-home__time">02:16</div><div className="os-home__date">Tuesday, October 13</div></div>
            <div className="os-grid">
              {APPS.map((a) => (
                <button key={a.id} type="button" className="os-icon" data-app={a.id} onClick={() => go(a.id === 'phone' ? { app: 'phone', tab: 'recents' } : { app: a.id } as Route)}>
                  <span className="os-icon__img" style={{ background: a.bg }}><svg width="24" height="24" viewBox="0 0 24 24">{a.icon}</svg></span>
                  <span className="os-icon__label">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {route.app === 'phone' && <PhoneApp route={route} setRoute={(r) => go(r)} />}
        {route.app === 'messages' && <Messages thread={route.thread ?? null} open={(id) => go({ app: 'messages', thread: id })} />}
        {route.app === 'contacts' && <Contacts contactId={route.contactId ?? null} open={(id) => go({ app: 'contacts', contactId: id })} />}
        {route.app === 'gallery' && <Gallery photo={route.photo ?? null} open={(id) => go({ app: 'gallery', photo: id })} />}
        {route.app === 'notes' && <Notes note={route.note ?? null} open={(id) => go({ app: 'notes', note: id })} />}
        {route.app === 'settings' && <Settings brightness={brightness} setBrightness={setBrightness} sounds={sounds} setSounds={setSounds} />}
      </div>
      <nav className="os-nav" aria-label="Phone navigation">
        <button type="button" onClick={back} aria-label="Back">‹</button>
        <span className="os-nav__title">{title}</span>
        <button type="button" onClick={home} aria-label="Home" className="os-nav__home"><span /></button>
      </nav>
      {/* simulated screen brightness: one cheap overlay */}
      <div className="os-dim" style={{ opacity: 1 - brightness }} aria-hidden="true" />
    </div>
  );
}

function PhoneApp({ route, setRoute }: { route: Extract<Route, { app: 'phone' }>; setRoute(r: Route): void }) {
  const tabs = [['recents', 'Recents'], ['contacts', 'Contacts'], ['keypad', 'Keypad']] as const;
  return (
    <div className="os-phone">
      <div className="os-phone__body">
        {route.tab === 'recents' && <Recents openId={route.callId ?? null} setOpenId={(id) => setRoute({ ...route, callId: id })} />}
        {route.tab === 'contacts' && <Contacts contactId={route.contactId ?? null} open={(id) => setRoute({ ...route, contactId: id })} />}
        {route.tab === 'keypad' && <Dialer />}
      </div>
      <div className="os-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={route.tab === id} className={route.tab === id ? 'is-on' : ''}
            onClick={() => setRoute({ app: 'phone', tab: id })}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function Dialer() {
  const [n, setN] = useState('');
  const [msg, setMsg] = useState('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  return (
    <div className="os-dialer">
      <div className="os-dialer__num">{n || ' '}</div>
      <div className="os-dialer__msg" role="status">{msg}</div>
      <div className="os-dialer__pad">
        {keys.map((k) => <button key={k} type="button" onClick={() => { playKeyTick(); setMsg(''); setN((x) => (x.length < 14 ? x + k : x)); }}>{k}</button>)}
      </div>
      <div className="os-dialer__row">
        <button type="button" className="os-dialer__call" onClick={() => setMsg(n ? 'No signal. Calls are disabled on evidence.' : '')} aria-label="Call">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" fill="#fff" /></svg>
        </button>
        <button type="button" className="os-dialer__del" onClick={() => setN((x) => x.slice(0, -1))} aria-label="Delete">⌫</button>
      </div>
    </div>
  );
}

function Contacts({ contactId, open }: { contactId: string | null; open(id: string): void }) {
  const c = contactId ? CONTACTS.find((x) => x.id === contactId) : null;
  if (c) return <ContactCard c={c} />;
  return (
    <div className="os-list" data-testid="phone-contacts">
      <h2 className="os-h">Contacts</h2>
      {CONTACTS.map((x) => <button key={x.id} type="button" className="os-row" onClick={() => open(x.id)}><span className="os-av">{x.name[0]}</span><span>{x.name}</span></button>)}
    </div>
  );
}

function ContactCard({ c }: { c: Contact }) {
  const calls = CALLS.filter((x) => x.number === c.number).length;
  return (
    <div className="os-detail" data-testid="contact-detail">
      <div className="rc-avatar" aria-hidden="true">{c.name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
      <div className="rc-dname">{c.name}</div>
      <div className="rc-dnum">{formatNumber(c.number)}</div>
      <dl className="rc-facts">
        <div><dt>Label</dt><dd>{c.label}</dd></div>
        <div><dt>Calls on this device</dt><dd>{calls}</dd></div>
        {c.note && <div><dt>Note</dt><dd>{c.note}</dd></div>}
      </dl>
    </div>
  );
}

function Messages({ thread, open }: { thread: string | null; open(id: string): void }) {
  const t = thread ? THREADS.find((x) => x.id === thread) : null;
  if (t) {
    return (
      <div className="os-thread" data-testid="sms-thread">
        <h2 className="os-h os-h--small">{t.with}</h2>
        <div className="os-bubbles">
          {t.messages.map((m, i) => <div key={i} className={`os-bubble os-bubble--${m.from}`}><p>{m.text}</p><time>{fmtShort(m.at)}</time></div>)}
        </div>
      </div>
    );
  }
  return (
    <div className="os-list" data-testid="sms-list">
      <h2 className="os-h">Messages</h2>
      {THREADS.map((x) => {
        const last = x.messages[x.messages.length - 1];
        return (
          <button key={x.id} type="button" className="os-row os-row--two" onClick={() => open(x.id)}>
            <span className="os-av">{x.with[0]}</span>
            <span><b>{x.with}</b><small>{last.text}</small></span>
            <time>{callDay(last.at)}</time>
          </button>
        );
      })}
    </div>
  );
}

function Gallery({ photo, open }: { photo: string | null; open(id: string): void }) {
  const p = photo ? PHOTOS.find((x) => x.id === photo) : null;
  if (p) {
    return (
      <div className="os-photo" data-testid="photo-view">
        <div className="os-photo__img" style={{ background: p.css }} />
        <div className="os-photo__cap">{p.caption}<time>{callDateLong(p.at)} · {callTime(p.at)}</time></div>
      </div>
    );
  }
  return (
    <div className="os-list">
      <h2 className="os-h">Gallery</h2>
      <div className="os-thumbs">
        {PHOTOS.map((x) => <button key={x.id} type="button" className="os-thumb" style={{ background: x.css }} onClick={() => open(x.id)} aria-label={x.caption} />)}
      </div>
    </div>
  );
}

function Notes({ note, open }: { note: string | null; open(id: string): void }) {
  const n = note ? NOTES.find((x) => x.id === note) : null;
  if (n) return <div className="os-note"><h2 className="os-h os-h--small">{n.title}</h2><time>{fmtShort(n.at)}</time><p>{n.body}</p></div>;
  return (
    <div className="os-list os-list--notes">
      <h2 className="os-h">Notes</h2>
      {NOTES.map((x) => <button key={x.id} type="button" className="os-row os-row--two" onClick={() => open(x.id)}><span><b>{x.title}</b><small>{x.body.split('\n')[0]}</small></span><time>{callDay(x.at)}</time></button>)}
    </div>
  );
}

function Settings({ brightness, setBrightness, sounds, setSounds }: { brightness: number; setBrightness(v: number): void; sounds: boolean; setSounds(v: boolean): void }) {
  return (
    <div className="os-list os-settings" data-testid="phone-settings">
      <h2 className="os-h">Settings</h2>
      <label className="os-set"><span>Brightness</span><input type="range" min={0.35} max={1} step={0.05} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} /></label>
      <label className="os-set"><span>Notification sounds</span><input type="checkbox" checked={sounds} onChange={(e) => setSounds(e.target.checked)} /></label>
      <h3 className="os-sub">About this phone</h3>
      <dl className="rc-facts">{DEVICE_INFO.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}

export function StatusBar({ time }: { time: string }) {
  return (
    <div className="tg-sb ev-sb">
      <span>{time}</span>
      <span className="tg-sbi">
        <svg width="16" height="11" viewBox="0 0 16 11"><rect x="0" y="7" width="3" height="4" rx="0.8" fill="#fff" /><rect x="4.3" y="5" width="3" height="6" rx="0.8" fill="#fff" /><rect x="8.6" y="2.6" width="3" height="8.4" rx="0.8" fill="#fff" fillOpacity="0.35" /><rect x="12.9" y="0" width="3" height="11" rx="0.8" fill="#fff" fillOpacity="0.35" /></svg>
        <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="#fff" strokeOpacity="0.45" fill="none" /><rect x="2" y="2" width="3.5" height="8" rx="1.2" fill="#ff5a4f" /><path d="M23 4v4c.9-.3 1.5-1.1 1.5-2s-.6-1.7-1.5-2z" fill="#fff" fillOpacity="0.5" /></svg>
      </span>
    </div>
  );
}


// ---- Phone app: call history ------------------------------------------------------------

function DirIcon({ dir }: { dir: CallRecord['direction'] }) {
  if (dir === 'outgoing') return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 9l6-6M4.5 3H9v4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (dir === 'incoming') return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M9 3L3 9M7.5 9H3V4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 3.5l3 0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

const DIR_LABEL: Record<CallRecord['direction'], string> = { incoming: 'Incoming', outgoing: 'Outgoing', missed: 'Missed' };

function Recents({ openId, setOpenId }: { openId: string | null; setOpenId(id: string | null): void }) {
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const call = openId ? CALLS.find((c) => c.id === openId) ?? null : null;
  const calls = filter === 'missed' ? CALLS.filter((c) => c.direction === 'missed') : CALLS;


  const open = (id: string) => {
    scrollTop.current = listRef.current?.scrollTop ?? 0;
    setOpenId(id);
  };
  const close = () => {
    const el = detailRef.current;
    if (!el) { setOpenId(null); return; }
    gsap.to(el, { xPercent: 100, duration: 0.32, ease: 'power3.in', onComplete: () => setOpenId(null) });
  };

  useLayoutEffect(() => {
    if (call && detailRef.current) gsap.fromTo(detailRef.current, { xPercent: 100 }, { xPercent: 0, duration: 0.42, ease: 'power3.out' });
    if (!call && listRef.current) listRef.current.scrollTop = scrollTop.current;
  }, [call]);

  return (
    <div className="rc" data-testid="call-history">
      <StatusBar time="02:16" />
      <div className="rc-top">
        <div className="rc-seg" role="tablist" aria-label="Filter calls">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>All</button>
          <button type="button" role="tab" aria-selected={filter === 'missed'} className={filter === 'missed' ? 'is-on' : ''} onClick={() => setFilter('missed')}>Missed</button>
        </div>
        <h2 className="rc-title">Recents</h2>
      </div>
      <div className="rc-list" ref={listRef}>
        {calls.map((c) => (
          <button key={c.id} type="button" className={`rc-row rc-row--${c.direction}`} onClick={() => open(c.id)} data-call={c.id}>
            <span className="rc-row__name">{c.name ?? 'UNKNOWN'}</span>
            <span className="rc-row__when">{callTime(c.at)}</span>
            <span className="rc-row__num">{formatNumber(c.number)}</span>
            <span className="rc-row__day">{callDay(c.at)}</span>
            <span className="rc-row__dir"><DirIcon dir={c.direction} />{DIR_LABEL[c.direction]}{c.duration ? ` · ${formatDuration(c.duration)}` : ''}</span>
            <span className="rc-row__info" aria-hidden="true">i</span>
          </button>
        ))}
      </div>
      <nav className="rc-tabs" aria-hidden="true">
        <span>Favourites</span><span className="is-on">Recents</span><span>Contacts</span><span>Keypad</span>
      </nav>
      <div className="tg-homebar" />

      {call && (
        <div className="rc-detail" ref={detailRef} role="dialog" aria-label={`Call record: ${call.name ?? 'Unknown'}`} data-testid="call-detail">
          <StatusBar time="02:16" />
          <button type="button" className="rc-back" onClick={close}>‹ Back to Call History</button>
          <div className="rc-avatar" aria-hidden="true">{call.name ? call.name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2) : '?'}</div>
          <div className="rc-dname">{call.name ?? 'UNKNOWN'}</div>
          <div className="rc-dnum" data-testid="call-number">{formatNumber(call.number)}</div>
          <dl className="rc-facts">
            <div><dt>Direction</dt><dd className={`is-${call.direction}`}><DirIcon dir={call.direction} /> {DIR_LABEL[call.direction]}</dd></div>
            <div><dt>Date</dt><dd>{callDateLong(call.at)}</dd></div>
            <div><dt>Time</dt><dd>{callTime(call.at)}</dd></div>
            <div><dt>Duration</dt><dd>{call.duration ? formatDuration(call.duration) : 'Not connected'}</dd></div>
            <div><dt>Contact</dt><dd>{call.name ? 'Saved contact' : 'Not saved in contacts'}</dd></div>
          </dl>
          <div className="rc-notes"><span>Evidence notes</span><p>{call.notes}</p></div>
        </div>
      )}
    </div>
  );
}
