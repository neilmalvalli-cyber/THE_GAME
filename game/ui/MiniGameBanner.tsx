// The live surprise mini-game (Supabase backend): question, countdown, answer box.
// The payout is doubled once when the team has an Overclock armed.
import { useEffect, useState, type FormEvent } from 'react';
import { answerMiniGame, useMiniGame } from '../services/backend';
import { useGameStore } from '../state/gameStore';
import './minigame.css';

export function MiniGameBanner() {
  const game = useMiniGame((s) => s.game);
  const armed = useGameStore((s) => s.effects.overclockArmed);
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const id = game?.id;
  useEffect(() => { setAnswer(''); setNote(null); setOpen(true); }, [id]);
  useEffect(() => {
    if (!id) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [id]);
  if (!game || game.endsAt <= now) return null;

  const left = Math.max(0, Math.ceil((game.endsAt - now) / 1000));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !answer.trim()) return;
    setBusy(true);
    try { const r = await answerMiniGame(answer); setNote({ ok: r.ok, text: r.message }); if (r.ok) setAnswer(''); } finally { setBusy(false); }
  };

  return (
    <aside className={`minigame${open ? '' : ' is-collapsed'}`} aria-label="Surprise mini-game" data-testid="minigame">
      <button type="button" className="minigame__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="minigame__kicker">Surprise mini-game</span>
        <span className="minigame__meta">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · {game.coins} coins{armed && !game.solved ? ' · Overclock ×2' : ''}</span>
      </button>
      {open && (
        <div className="minigame__body">
          <p className="minigame__q">{game.question}</p>
          {game.solved ? (
            <p className="minigame__note is-ok" role="status">{note?.ok ? note.text : 'Solved by your team.'}</p>
          ) : (
            <form className="minigame__form" onSubmit={submit}>
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" aria-label="Mini-game answer" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn btn--primary" disabled={busy || !answer.trim()}>Submit</button>
            </form>
          )}
          {note && !note.ok && <p className="minigame__note" role="alert">{note.text}</p>}
        </div>
      )}
    </aside>
  );
}
