// Incoming sabotage on this team: a visual glitch (pointer-events: none, never blocks
// input) and a Freeze banner. Both end on their own after 60 seconds.
import { useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';

export function SabotageLayer() {
  const glitchUntil = useGameStore((s) => s.effects.glitchUntil);
  const freezeUntil = useGameStore((s) => s.effects.freezeUntil);
  const [now, setNow] = useState(Date.now());
  const active = glitchUntil > now || freezeUntil > now;
  useEffect(() => {
    if (!(glitchUntil > Date.now() || freezeUntil > Date.now())) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [glitchUntil, freezeUntil]);
  useEffect(() => {
    document.documentElement.classList.toggle('is-glitched', glitchUntil > now);
  }, [glitchUntil, now]);
  useEffect(() => () => document.documentElement.classList.remove('is-glitched'), []);
  if (!active) return null;
  const secs = (t: number) => Math.max(0, Math.ceil((t - now) / 1000));
  return (
    <>
      {glitchUntil > now && <div className="glitch-fx" aria-hidden="true" data-testid="glitch-fx" />}
      {freezeUntil > now && (
        <div className="freeze-banner" role="status" data-testid="freeze-banner">
          PROGRESS TIMER FROZEN · {secs(freezeUntil)}s — you can keep solving
        </div>
      )}
    </>
  );
}
