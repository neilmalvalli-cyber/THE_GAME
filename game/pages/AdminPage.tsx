// /admin — the control centre. Isolated from the team interface (no 3D, no scenes).
// Requires the admin session (mock); every number comes from the same team saves the
// team interface writes (services/teams.ts) — no separate figures.
//
// Sections: Overview · Teams · Scores · Market Operations · Mail Operations · Activity Log
import { getCatalogItem } from '../data/market';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { paths } from '../orchestration/routes';
import { useAuth, logoutAdmin } from '../services/auth';
import { useTeams, type TeamSummary } from '../services/teams';
import { ADMIN_MAIL_TYPES, BODY_MAX, SUBJECT_MAX, deliveryStatus, newDraftId, refreshSentRemote, sendMessage, sendMessageRemote, useOutbox, type AdminMailType } from '../services/mail';
import { adminMiniGame, adminSetMarket, adminSyncMarket, isServerBackend, type AdminMiniGame } from '../services/backend';
import {
  activateBlackMarket, closeNormalMarket, deactivateBlackMarket, openNormalMarket,
  useMarketStore, MARKET_EVENT_LABEL,
} from '../services/marketState';
import { CASES, MAX_SCORE, pad2 } from '../data/cases';
import './admin.css';

type Section = 'overview' | 'teams' | 'scores' | 'market' | 'mail' | 'activity';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'teams', label: 'Teams' },
  { id: 'scores', label: 'Scores' },
  { id: 'market', label: 'Market Operations' },
  { id: 'mail', label: 'Mail Operations' },
  { id: 'activity', label: 'Activity Log' },
];

function fmt(at: number) {
  const d = new Date(at);
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

export function AdminPage() {
  const admin = useAuth((s) => s.admin);
  if (!admin) return <Navigate to={paths.roleSelect} replace />;
  return <Dashboard />;
}

function Dashboard() {
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>('overview');
  const [teamId, setTeamId] = useState<string | null>(null);
  const teams = useTeams((s) => s.teams);
  // pick up teams created / updated in this browser (other tabs also push storage events)
  useEffect(() => {
    const pull = () => {
      useTeams.getState().refresh();
      if (isServerBackend) { void adminSyncMarket(); void refreshSentRemote(); }
    };
    pull();
    const t = window.setInterval(pull, 4000);
    return () => window.clearInterval(t);
  }, []);

  const open = (id: string) => { setTeamId(id); setSection('teams'); };

  return (
    <main className="admin admin--dash">
      <header className="admin__bar">
        <Logo />
        <nav className="admin__nav" aria-label="Admin sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={section === s.id ? 'is-on' : ''} aria-current={section === s.id ? 'page' : undefined}
              onClick={() => { setSection(s.id); if (s.id !== 'teams') setTeamId(null); }}>{s.label}</button>
          ))}
        </nav>
        <button type="button" className="btn btn--ghost admin__exit" onClick={() => { logoutAdmin(); navigate(paths.roleSelect, { replace: true }); }}>Exit Admin</button>
      </header>
      <section className="admin__body admin__body--ops">
        <div className="kicker">Restricted</div>
        <h1 className="admin__title">Admin Control Center</h1>
        <hr className="admin__rule" />
        {section === 'overview' && <Overview teams={teams} />}
        {section === 'teams' && (teamId ? <TeamDetail team={teams.find((t) => t.id === teamId)} onBack={() => setTeamId(null)} /> : <TeamsTable teams={teams} onOpen={open} />)}
        {section === 'scores' && <Scores teams={teams} onOpen={open} />}
        {section === 'market' && <MarketOps />}
        {section === 'mail' && <MailOps teams={teams} />}
        {section === 'activity' && <Activity teams={teams} />}
        <p className="ops__note">
          Prototype: accounts, progress and messages live in this browser. Tabs of this browser update live;
          other computers will not, until the game server is connected.
        </p>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- overview
function Overview({ teams }: { teams: TeamSummary[] }) {
  const normal = useMarketStore((s) => s.normalMarketStatus);
  const black = useMarketStore((s) => s.blackMarketStatus);
  const now = Date.now();
  const tiles = [
    { label: 'Total teams', value: teams.length },
    { label: 'Active (15 min)', value: teams.filter((t) => now - t.lastActivity < 15 * 60_000).length },
    { label: 'Levels completed', value: teams.reduce((n, t) => n + t.levelsCompleted, 0) },
    { label: 'Cases solved', value: teams.reduce((n, t) => n + t.casesSolved, 0) },
    { label: 'Normal Market', value: normal === 'open' ? 'Open' : 'Closed' },
    { label: 'Black Market', value: black === 'active' ? 'Active' : 'Locked' },
  ];
  return (
    <section className="ops" aria-labelledby="ov-title">
      <h2 id="ov-title" className="ops__title">Overview</h2>
      <div className="tiles" data-testid="overview">
        {tiles.map((t) => <div key={t.label} className="tile"><span>{t.label}</span><b>{t.value}</b></div>)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- teams
function TeamsTable({ teams, onOpen }: { teams: TeamSummary[]; onOpen(id: string): void }) {
  const [q, setQ] = useState('');
  const [byScore, setByScore] = useState(true);
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = teams.filter((t) => !k || t.name.toLowerCase().includes(k) || t.id.toLowerCase().includes(k));
    return byScore ? [...list].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)) : [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, q, byScore]);
  return (
    <section className="ops" aria-labelledby="teams-title">
      <h2 id="teams-title" className="ops__title">Teams</h2>
      <div className="ops__toolbar">
        <input className="ops__search" type="search" placeholder="Search teams" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search teams" />
        <button type="button" className="btn btn--ghost" onClick={() => setByScore((v) => !v)}>Sort: {byScore ? 'Score' : 'Name'}</button>
      </div>
      <div className="table-wrap">
        <table className="dtable" data-testid="teams-table">
          <thead><tr><th>Team Name</th><th>Team ID</th><th className="num">Total Score</th><th className="num">Coins</th><th className="num">Cases Solved</th><th className="num">Levels</th><th>Last Activity</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} onClick={() => onOpen(t.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t.id); }}>
                <td><b>{t.name}</b></td><td className="mono">{t.id}</td><td className="num">{t.score}</td><td className="num">{t.coins}</td>
                <td className="num">{t.casesSolved}/{CASES.length}</td><td className="num">{t.levelsCompleted}/{CASES.length * 4}</td><td className="mono">{fmt(t.lastActivity)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamDetail({ team, onBack }: { team?: TeamSummary; onBack(): void }) {
  if (!team) return <section className="ops"><p>Team not found.</p><button type="button" className="btn" onClick={onBack}>Back to teams</button></section>;
  return (
    <section className="ops" aria-labelledby="td-title" data-testid="team-detail">
      <button type="button" className="btn btn--ghost" onClick={onBack}>← All teams</button>
      <h2 id="td-title" className="ops__title ops__title--big">{team.name} <span className="mono">{team.id}</span></h2>
      <div className="tiles">
        <div className="tile"><span>Total score</span><b>{team.score}</b></div>
        <div className="tile"><span>Coin balance</span><b>{team.coins}</b></div>
        <div className="tile"><span>Cases completed</span><b>{team.casesSolved}/{CASES.length}</b></div>
        <div className="tile"><span>Levels completed</span><b>{team.levelsCompleted}/{CASES.length * 4}</b></div>
        <div className="tile"><span>Phone</span><b>{team.phoneUnlocked ? 'Unlocked' : 'Locked'}</b></div>
        <div className="tile"><span>Levels skipped</span><b>{Object.keys(team.skipped).length}</b></div>
      </div>
      <p className="ops__note" data-testid="team-inventory">Power-ups: {Object.entries(team.inventory).filter(([, n]) => n > 0).map(([id, n]) => `${getCatalogItem(id)?.name ?? id} ×${n}`).join(', ') || 'none'}</p>
      <ol className="case-list">
        {team.cases.map((c) => (
          <li key={c.id} className={`case-row case-row--${c.status.replace(' ', '-').toLowerCase()}`}>
            <span className="mono">CASE {pad2(c.id)}</span><span>{c.title}</span><span>{c.done}/{c.total} LEVELS</span><b>{c.status}</b><span className="num">{c.score} pts</span>
          </li>
        ))}
      </ol>
      <h3 className="ops__sub">Completed levels</h3>
      <LevelLines lines={team.breakdown.lines} />
    </section>
  );
}

function LevelLines({ lines }: { lines: TeamSummary['breakdown']['lines'] }) {
  if (!lines.length) return <p className="empty">No levels completed yet.</p>;
  return (
    <table className="dtable dtable--compact">
      <thead><tr><th>Level</th><th>Title</th><th className="num">Score</th><th>Completed</th></tr></thead>
      <tbody>{[...lines].sort((a, b) => a.at - b.at).map((l) => <tr key={l.key}><td className="mono">{pad2(l.caseId)}-{pad2(l.level)}</td><td>{l.title}</td><td className="num">{l.score}</td><td className="mono">{fmt(l.at)}</td></tr>)}</tbody>
    </table>
  );
}

// ---------------------------------------------------------------- scores
function Scores({ teams, onOpen }: { teams: TeamSummary[]; onOpen(id: string): void }) {
  const ranked = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <section className="ops" aria-labelledby="sc-title">
      <h2 id="sc-title" className="ops__title">Scores</h2>
      <p className="ops__card-text">Score ranks teams; coins are a separate currency. Maximum base score: {MAX_SCORE}.</p>
      <div className="table-wrap">
        <table className="dtable" data-testid="scores-table">
          <thead><tr><th>#</th><th>Team</th>{CASES.map((c) => <th key={c.id} className="num">C{pad2(c.id)}</th>)}<th className="num">Total</th><th className="num">Coins</th></tr></thead>
          <tbody>
            {ranked.map((t, i) => (
              <tr key={t.id} onClick={() => onOpen(t.id)}>
                <td className="num">{i + 1}</td><td><b>{t.name}</b></td>
                {CASES.map((c) => <td key={c.id} className="num">{t.breakdown.byCase[c.id] || '—'}</td>)}
                <td className="num"><b>{t.score}</b></td><td className="num">{t.coins}</td>
              </tr>
            ))}
            {ranked.length === 0 && <tr><td colSpan={CASES.length + 4} className="empty">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- market operations
type Action = 'shutdown' | 'reopen' | 'activate' | 'deactivate';
const CONFIRM: Record<Action, { title: string; body: string; ok: string } | null> = {
  shutdown: { title: 'Shut down the Normal Market?', body: 'Team purchases will be suspended and the store will be sealed as a crime scene.', ok: 'Confirm shutdown' },
  activate: { title: 'Activate the Black Market?', body: 'Teams will receive an anonymous message and a new door will appear in their navigation.', ok: 'Confirm activation' },
  deactivate: { title: 'Deactivate the Black Market?', body: 'New entries and purchases will be blocked. Teams already inside can only leave.', ok: 'Confirm deactivation' },
  reopen: null,
};
const RUN: Record<Action, () => boolean> = { shutdown: closeNormalMarket, reopen: openNormalMarket, activate: activateBlackMarket, deactivate: deactivateBlackMarket };

/** Surprise mini-game (Supabase backend): the payout an armed Overclock doubles. */
function MiniGameOps() {
  const [game, setGame] = useState<AdminMiniGame | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [coins, setCoins] = useState(30);
  const [minutes, setMinutes] = useState(5);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { const r = await adminMiniGame({ action: 'status' }); if (r.ok) setGame(r.game ?? null); };
  useEffect(() => { void refresh(); const t = window.setInterval(() => { void refresh(); }, 4000); return () => window.clearInterval(t); }, []);
  const act = async (input: Parameters<typeof adminMiniGame>[0]) => {
    setBusy(true); setMsg(null);
    try {
      const r = await adminMiniGame(input);
      if (!r.ok) { setMsg(r.message ?? 'Could not do that.'); return; }
      if (input.action === 'launch') { setQuestion(''); setAnswer(''); setMsg('Mini-game launched. Teams see it within a few seconds.'); }
      await refresh();
    } finally { setBusy(false); }
  };
  return (
    <article className="ops-card ops-card--wide" data-testid="minigame-ops">
      <header className="ops-card__head">
        <span className="ops-card__name">Surprise Mini-game</span>
        <span className={`ops-status ops-status--${game ? 'live' : 'idle'}`}><span className="ops-status__dot" />{game ? 'Live' : 'None'}</span>
      </header>
      {game ? (
        <>
          <p className="ops-card__text">“{game.question}” · {game.coins} coins · {game.solvedBy} team{game.solvedBy === 1 ? '' : 's'} solved · ends {new Date(game.endsAt).toLocaleTimeString()}</p>
          <button type="button" className="btn" disabled={busy} onClick={() => act({ action: 'end' })}>End mini-game</button>
        </>
      ) : (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void act({ action: 'launch', question, answer, coins, minutes }); }}>
          <p className="ops-card__text">Each team's first correct answer pays the reward — doubled for teams with an armed Overclock.</p>
          <label className="composer__field"><span>Question</span><input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} /></label>
          <label className="composer__field"><span>Answer</span><input value={answer} maxLength={200} onChange={(e) => setAnswer(e.target.value)} /></label>
          <label className="composer__field"><span>Reward (coins)</span><input type="number" min={1} max={1000} value={coins} onChange={(e) => setCoins(Number(e.target.value))} /></label>
          <label className="composer__field"><span>Time limit (minutes)</span><input type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
          <div className="composer__actions"><button type="submit" className="btn btn--primary" disabled={busy || !question.trim() || !answer.trim()}>Launch mini-game</button></div>
        </form>
      )}
      {msg && <p className="ops__flash" role="status">{msg}</p>}
    </article>
  );
}

function MarketOps() {
  const normal = useMarketStore((s) => s.normalMarketStatus);
  const black = useMarketStore((s) => s.blackMarketStatus);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const run = async (a: Action) => {
    setConfirm(null);
    const changed = isServerBackend ? await adminSetMarket(a) : RUN[a]();
    if (!changed) setFlash('No change — the market was already in that state.');
  };
  const request = (a: Action) => (CONFIRM[a] ? setConfirm(a) : run(a));
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), 3200); return () => window.clearTimeout(t); }, [flash]);
  return (
    <section className="ops" aria-labelledby="ops-title">
      <h2 id="ops-title" className="ops__title">Market Operations</h2>
      <div className="ops__grid">
        <article className={`ops-card ops-card--${normal}`}>
          <header className="ops-card__head">
            <span className="ops-card__name">Normal Market</span>
            <span className={`ops-status ops-status--${normal === 'open' ? 'ok' : 'alert'}`} data-testid="normal-status"><span className="ops-status__dot" />{normal === 'open' ? 'Open' : 'Closed'}</span>
          </header>
          <p className="ops-card__text">{normal === 'open' ? 'The store is trading. Teams can buy power-ups at standard prices.' : 'Sealed as a crime scene. All transactions are suspended.'}</p>
          {normal === 'open'
            ? <button type="button" className="btn btn--danger" onClick={() => request('shutdown')}>Shut down market</button>
            : <button type="button" className="btn" onClick={() => request('reopen')}>Reopen market</button>}
        </article>
        <article className={`ops-card ops-card--${black}`}>
          <header className="ops-card__head">
            <span className="ops-card__name">Black Market</span>
            <span className={`ops-status ops-status--${black === 'active' ? 'live' : 'idle'}`} data-testid="black-status"><span className="ops-status__dot" />{black === 'active' ? 'Active' : 'Locked'}</span>
          </header>
          <p className="ops-card__text">{black === 'active' ? 'Open to teams. The same power-ups, at discounted prices.' : 'Hidden from teams. Its route is blocked.'}</p>
          {black === 'locked'
            ? <button type="button" className="btn btn--danger" onClick={() => request('activate')}>Activate Black Market</button>
            : <button type="button" className="btn" onClick={() => request('deactivate')}>Deactivate Black Market</button>}
        </article>
      </div>
      {isServerBackend && <MiniGameOps />}
      {flash && <p className="ops__flash" role="status">{flash}</p>}
      {confirm && CONFIRM[confirm] && <ConfirmDialog {...CONFIRM[confirm]!} onCancel={() => setConfirm(null)} onConfirm={() => run(confirm)} />}
    </section>
  );
}

// ---------------------------------------------------------------- mail operations
function MailOps({ teams }: { teams: TeamSummary[] }) {
  const sent = useOutbox((s) => s.sent);
  const [composing, setComposing] = useState(false);
  return (
    <section className="ops" aria-labelledby="mail-title">
      <h2 id="mail-title" className="ops__title">Mail Operations</h2>
      {!composing && <button type="button" className="btn btn--primary" onClick={() => setComposing(true)}>Compose message</button>}
      {composing && <Composer teams={teams} onDone={() => setComposing(false)} />}
      <h3 className="ops__sub">Sent messages</h3>
      <div className="table-wrap">
        <table className="dtable" data-testid="sent-table">
          <thead><tr><th>Recipient</th><th>Subject</th><th>Type</th><th>Sent</th><th>Delivery</th></tr></thead>
          <tbody>
            {sent.map((m) => (
              <tr key={m.id}><td>{m.toLabel}</td><td>{m.subject}</td><td>{ADMIN_MAIL_TYPES.find((t) => t.id === m.type)?.label}</td><td className="mono">{fmt(m.at)}</td><td>{deliveryStatus(m, teams)}</td></tr>
            ))}
            {sent.length === 0 && <tr><td colSpan={5} className="empty">Nothing sent yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Composer({ teams, onDone }: { teams: TeamSummary[]; onDone(): void }) {
  const [toAll, setToAll] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<AdminMailType>('general');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const draftId = useRef(newDraftId()); // one id per draft: repeated clicks send once
  const justSent = useRef(false);
  /** Editing after a send starts a new draft (new id). */
  const edited = () => { if (justSent.current) { justSent.current = false; draftId.current = newDraftId(); setDone(null); } };

  const send = async () => {
    if (sending || justSent.current) return;
    setSending(true);
    setError(null);
    const draft = { draftId: draftId.current, to: toAll ? 'all' as const : teams.filter((t) => picked.includes(t.id)).map((t) => ({ id: t.id, name: t.name })), subject, body, type };
    const r = isServerBackend ? await sendMessageRemote(draft) : sendMessage(draft);
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(`Sent to ${r.message.toLabel}.`);
    justSent.current = true;
    setSubject(''); setBody(''); setPicked([]);
  };

  const matches = teams.filter((t) => !filter.trim() || t.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }} aria-label="Compose message" data-testid="composer">
      <fieldset className="composer__to">
        <legend>Recipient</legend>
        <label><input type="radio" name="to" checked={toAll} onChange={() => setToAll(true)} /> All teams</label>
        <label><input type="radio" name="to" checked={!toAll} onChange={() => setToAll(false)} /> Specific team</label>
        {!toAll && (
          <div className="composer__picker">
            <input type="search" placeholder="Search teams" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search recipients" />
            <ul>
              {matches.map((t) => (
                <li key={t.id}><label><input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))} /> {t.name} <span className="mono">{t.id}</span></label></li>
              ))}
              {matches.length === 0 && <li className="empty">No matching teams.</li>}
            </ul>
          </div>
        )}
      </fieldset>
      <label className="composer__field"><span>Message type</span>
        <select value={type} onChange={(e) => setType(e.target.value as AdminMailType)}>
          {ADMIN_MAIL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="composer__field"><span>Subject</span><input value={subject} maxLength={SUBJECT_MAX} onChange={(e) => { edited(); setSubject(e.target.value); }} /></label>
      <label className="composer__field"><span>Message</span><textarea rows={6} value={body} maxLength={BODY_MAX} onChange={(e) => { edited(); setBody(e.target.value); }} /></label>
      {error && <p className="auth__error" role="alert">{error}</p>}
      {done && <p className="ops__flash" role="status">{done}</p>}
      <div className="composer__actions">
        <button type="submit" className="btn btn--primary" disabled={sending}>Send message</button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- activity log
function Activity({ teams }: { teams: TeamSummary[] }) {
  const events = useMarketStore((s) => s.events);
  const sent = useOutbox((s) => s.sent);
  const rows = useMemo(() => {
    const list: { at: number; text: string; kind: string }[] = [];
    for (const e of events) list.push({ at: e.at, text: MARKET_EVENT_LABEL[e.type], kind: e.type });
    for (const m of sent) list.push({ at: m.at, text: `Mail sent to ${m.toLabel}: “${m.subject}”`, kind: 'mail' });
    for (const t of teams) {
      list.push({ at: t.createdAt, text: `Team registered: ${t.name}`, kind: 'team' });
      for (const l of t.breakdown.lines) list.push({ at: l.at, text: `${t.name} completed Case ${pad2(l.caseId)} · Level ${pad2(l.level)} (+${l.score})`, kind: 'level' });
    }
    return list.sort((a, b) => b.at - a.at).slice(0, 200);
  }, [events, sent, teams]);
  return (
    <section className="ops ops--log" aria-labelledby="log-title">
      <h2 id="log-title" className="ops__title">System Activity</h2>
      <ol className="ops-log" data-testid="activity-log">
        {rows.map((r, i) => (
          <li key={i} className={`ops-log__row ops-log__row--${r.kind}`}>
            <time dateTime={new Date(r.at).toISOString()}>{fmt(r.at)}</time>
            <span>{r.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ConfirmDialog({ title, body, ok, onCancel, onConfirm }: { title: string; body: string; ok: string; onCancel(): void; onConfirm(): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="ops-dialog" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ops-dialog__box" role="alertdialog" aria-modal="true" aria-labelledby="ops-dialog-title" aria-describedby="ops-dialog-body">
        <h3 id="ops-dialog-title">{title}</h3>
        <p id="ops-dialog-body">{body}</p>
        <div className="ops-dialog__actions">
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>{ok}</button>
        </div>
      </div>
    </div>
  );
}
