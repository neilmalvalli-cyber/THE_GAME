// Frame-rate / graphics overlay for testing on real machines (e.g. the lab PCs):
// open any team page with ?perf=1 (remembered for the tab; ?perf=0 hides it).
// Shows the live frame rate and renderer load, and lets the tester force a graphics tier.
import { useEffect, useState } from 'react';
import { PerfPanel } from './PerfPanel';
import { useQuality, type QualityChoice } from './quality';
import './perf-overlay.css';

const KEY = 'the-game:perf-overlay';

function readFlag(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('perf');
    if (q === '1') sessionStorage.setItem(KEY, '1');
    if (q === '0') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === '1';
  } catch { return false; }
}

export function PerfOverlay() {
  const [on, setOn] = useState(false);
  const choice = useQuality((s) => s.choice);
  useEffect(() => { setOn(readFlag()); }, []);
  if (!on) return null;
  return (
    <aside className="perf-overlay" aria-label="Performance">
      <PerfPanel />
      <div className="perf-overlay__tiers" role="group" aria-label="Graphics quality">
        {(['auto', 'low', 'medium', 'high'] as QualityChoice[]).map((q) => (
          <button key={q} type="button" className={choice === q ? 'is-on' : ''} onClick={() => useQuality.getState().setChoice(q)}>{q}</button>
        ))}
      </div>
    </aside>
  );
}
