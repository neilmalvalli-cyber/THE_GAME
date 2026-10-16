// /team/inbox and /team/inbox/:messageId — THE GAME · Intelligence Mail.
// Familiar webmail layout (folder list, search, message list, reader) in the
// game's own dark style. Folder and search live in the URL so Back/Forward work.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import type { MailMessage } from '../data/mail';
import { paths } from '../orchestration/routes';
import { formatFull, formatMailDate, formatRemaining } from '../lib/time';
import {
  IconArchive, IconArrowLeft, IconDrop, IconInbox, IconRead, IconSearch, IconStar, IconSystem, IconUnarchive, IconUnread, IconClose,
} from '../ui/icons';
import { useLeave } from '../lib/useLeave';
import './inbox.css';

type Folder = 'inbox' | 'unread' | 'starred' | 'deadDrops' | 'system' | 'archived';

const FOLDERS: { id: Folder; label: string; icon: ReactNode }[] = [
  { id: 'inbox', label: 'Inbox', icon: <IconInbox /> },
  { id: 'unread', label: 'Unread', icon: <IconUnread /> },
  { id: 'starred', label: 'Starred', icon: <IconStar /> },
  { id: 'deadDrops', label: 'Dead Drops', icon: <IconDrop /> },
  { id: 'system', label: 'System Updates', icon: <IconSystem /> },
  { id: 'archived', label: 'Archived', icon: <IconArchive /> },
];

function inFolder(m: MailMessage, f: Folder): boolean {
  switch (f) {
    case 'inbox': return !m.archived;
    case 'unread': return !m.read && !m.archived;
    case 'starred': return m.starred;
    case 'deadDrops': return m.category === 'deadDrop' && !m.archived;
    case 'system': return m.category === 'system' && !m.archived;
    case 'archived': return m.archived;
  }
}

function matches(m: MailMessage, q: string): boolean {
  if (!q) return true;
  const hay = `${m.from} ${m.subject} ${m.preview} ${m.body} ${m.deadDrop?.title ?? ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Re-render every second while something is counting down. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const CATEGORY_LABEL: Record<MailMessage['category'], string> = { general: 'Update', deadDrop: 'Dead Drop', blackMarket: 'Black Market', system: 'System', warning: 'Warning', market: 'Market' };

export function InboxPage() {
  const { messageId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const messages = useGameStore((s) => s.inbox.messages);
  const lastDeskPath = useUiStore((s) => s.lastDeskPath);
  const folder = (FOLDERS.some((f) => f.id === params.get('folder')) ? params.get('folder') : 'inbox') as Folder;
  const q = params.get('q') ?? '';
  const [query, setQuery] = useState(q);
  useEffect(() => setQuery(q), [q]);
  const [leaving, leave] = useLeave(180);
  const toDesk = () => leave(() => navigate(lastDeskPath));

  const counts = useMemo(() => {
    const c = {} as Record<Folder, number>;
    for (const f of FOLDERS) c[f.id] = messages.filter((m) => inFolder(m, f.id) && (f.id === 'starred' || f.id === 'archived' ? true : !m.read)).length;
    return c;
  }, [messages]);

  const list = useMemo(() => messages.filter((m) => inFolder(m, folder) && matches(m, q)).sort((a, b) => b.at - a.at), [messages, folder, q]);

  const setFolder = (f: Folder) => {
    const next = new URLSearchParams(params);
    if (f === 'inbox') next.delete('folder'); else next.set('folder', f);
    navigate({ pathname: paths.inbox, search: next.toString() ? `?${next}` : '' });
  };
  const submitSearch = (value: string) => {
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('q', value.trim()); else next.delete('q');
    if (messageId) navigate({ pathname: paths.inbox, search: `?${next}` });
    else setParams(next, { replace: true });
  };

  return (
    <div className={`mail${leaving ? ' is-leaving' : ''}`} role="main">
      <header className="mail__head">
        <div className="mail__brand"><span className="mail__brand-game">THE GAME</span><span className="mail__brand-sep">—</span><span>Intelligence Mail</span></div>
        <form className="mail__search" role="search" onSubmit={(e) => { e.preventDefault(); submitSearch(query); }}>
          <IconSearch />
          <input value={query} onChange={(e) => { setQuery(e.target.value); if (!messageId) submitSearch(e.target.value); }} placeholder="Search intelligence" aria-label="Search mail" />
          {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); submitSearch(''); }}><IconClose /></button>}
        </form>
        <button type="button" className="btn btn--ghost mail__desk" onClick={toDesk}><IconArrowLeft />Back to Desk</button>
      </header>

      <div className="mail__body">
        <nav className="mail__nav" aria-label="Mail folders">
          {FOLDERS.map((f) => (
            <button key={f.id} type="button" className={`mail__folder${folder === f.id ? ' is-active' : ''}`} onClick={() => setFolder(f.id)} aria-current={folder === f.id ? 'page' : undefined}>
              {f.icon}<span>{f.label}</span>{counts[f.id] > 0 && <em>{counts[f.id]}</em>}
            </button>
          ))}
        </nav>

        <section className="mail__main">
          {messageId ? <Reader id={messageId} onDesk={toDesk} /> : <MessageList list={list} folder={folder} q={q} />}
        </section>
      </div>
    </div>
  );
}

function MessageList({ list, folder, q }: { list: MailMessage[]; folder: Folder; q: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { setStarred, setArchived, setRead } = useGameStore.getState();
  const label = FOLDERS.find((f) => f.id === folder)!.label;
  return (
    <>
      <div className="mail__toolbar">
        <span>{q ? `Results for “${q}” in ${label}` : label}</span>
        <span className="mail__count">{list.length} {list.length === 1 ? 'message' : 'messages'}</span>
      </div>
      {list.length === 0 ? (
        <div className="mail__empty">{q ? 'No intelligence matches your search.' : folder === 'archived' ? 'Nothing archived.' : 'Nothing here. Quiet nights do not last.'}</div>
      ) : (
        <ul className="mail__list">
          {list.map((m) => (
            <li key={m.id} className={`row${m.read ? '' : ' is-unread'}`}>
              <button type="button" className={`row__star${m.starred ? ' is-on' : ''}`} onClick={() => setStarred(m.id, !m.starred)} aria-label={m.starred ? 'Unstar' : 'Star'} aria-pressed={m.starred}>
                <IconStar filled={m.starred} />
              </button>
              <button type="button" className="row__open" onClick={() => navigate(paths.message(m.id), { state: { fromList: location.pathname + location.search } })}>
                <span className="row__from">{m.from}</span>
                <span className="row__text">
                  {m.category === 'deadDrop' && <span className="row__tag">Dead Drop</span>}
                  <span className="row__subject">{m.subject}</span>
                  <span className="row__preview"> — {m.preview}</span>
                </span>
                <time className="row__time" dateTime={new Date(m.at).toISOString()}>{formatMailDate(m.at)}</time>
              </button>
              <span className="row__actions">
                <button type="button" onClick={() => setArchived(m.id, !m.archived)} aria-label={m.archived ? 'Move to inbox' : 'Archive'} title={m.archived ? 'Move to inbox' : 'Archive'}>{m.archived ? <IconUnarchive /> : <IconArchive />}</button>
                <button type="button" onClick={() => setRead(m.id, !m.read)} aria-label={m.read ? 'Mark unread' : 'Mark read'} title={m.read ? 'Mark unread' : 'Mark read'}>{m.read ? <IconUnread /> : <IconRead />}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Reader({ id, onDesk }: { id: string; onDesk: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const msg = useGameStore((s) => s.inbox.messages.find((m) => m.id === id));
  const { setStarred, setArchived, setRead } = useGameStore.getState();
  const now = useNow(!!msg?.deadDrop);

  useEffect(() => { if (msg && !msg.read) setRead(msg.id, true); }, [msg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const backToInbox = () => {
    const from = (location.state as { fromList?: string } | null)?.fromList;
    if (from) navigate(-1); else navigate(paths.inbox);
  };

  if (!msg) {
    return (
      <div className="reader reader--missing" role="alert">
        <h2>Message not found</h2>
        <p>This intelligence does not exist, or it has been destroyed.</p>
        <div className="reader__nav"><button type="button" className="btn" onClick={() => navigate(paths.inbox)}><IconArrowLeft />Back to Inbox</button></div>
      </div>
    );
  }

  const dd = msg.deadDrop;
  const remaining = dd ? formatRemaining(dd.expiresAt, now) : null;

  return (
    <article className="reader" aria-labelledby="reader-subject">
      <div className="reader__nav">
        <button type="button" className="btn btn--ghost" onClick={backToInbox}><IconArrowLeft />Back to Inbox</button>
        <span className="reader__tools">
          <button type="button" onClick={() => setStarred(msg.id, !msg.starred)} aria-pressed={msg.starred} aria-label={msg.starred ? 'Unstar' : 'Star'} title={msg.starred ? 'Unstar' : 'Star'} className={msg.starred ? 'is-on' : ''}><IconStar filled={msg.starred} /></button>
          <button type="button" onClick={() => { setArchived(msg.id, !msg.archived); if (!msg.archived) backToInbox(); }} aria-label={msg.archived ? 'Move to inbox' : 'Archive'} title={msg.archived ? 'Move to inbox' : 'Archive'}>{msg.archived ? <IconUnarchive /> : <IconArchive />}</button>
          <button type="button" onClick={() => { setRead(msg.id, false); backToInbox(); }} aria-label="Mark unread" title="Mark unread"><IconUnread /></button>
        </span>
      </div>

      <h1 id="reader-subject" className="reader__subject">{msg.subject}<span className="reader__label">{CATEGORY_LABEL[msg.category]}</span></h1>
      <div className="reader__meta">
        <span className="reader__avatar" aria-hidden="true">{msg.from.charAt(0)}</span>
        <div className="reader__who">
          <div><b>{msg.from}</b></div>
          <div className="reader__to">to {msg.to}</div>
        </div>
        <time className="reader__time" dateTime={new Date(msg.at).toISOString()}>{formatFull(msg.at)}</time>
      </div>

      {dd && (
        <section className={`classified${remaining ? '' : ' is-expired'}`} aria-label="Classified intelligence">
          <div className="classified__head"><span>Classified intelligence</span><span className="classified__status">{remaining ? 'Active' : 'Expired'}</span></div>
          <h2 className="classified__title">{dd.title}</h2>
          <p className="classified__brief">“{dd.briefing}”</p>
          <pre className="classified__clue">{dd.clue}</pre>
          <dl className="classified__facts">
            <div><dt>Location</dt><dd>{dd.location}</dd></div>
            <div><dt>Reward</dt><dd>{dd.reward} coins</dd></div>
            <div><dt>Status</dt><dd>{remaining ? 'ACTIVE' : 'EXPIRED'}</dd></div>
            <div><dt>Time remaining</dt><dd className="classified__timer">{remaining ?? 'EXPIRED'}</dd></div>
          </dl>
          <p className="classified__fine">Mock event — Dead Drop validation is not implemented yet. Expires {formatFull(dd.expiresAt)}.</p>
        </section>
      )}

      <div className="reader__body">{msg.body.split('\n').map((p, i) => (p ? <p key={i}>{p}</p> : <br key={i} />))}</div>

      <div className="reader__foot">
        <button type="button" className="btn" onClick={backToInbox}><IconArrowLeft />Back to Inbox</button>
        <button type="button" className="btn btn--ghost" onClick={onDesk}>Back to Desk</button>
      </div>
    </article>
  );
}
