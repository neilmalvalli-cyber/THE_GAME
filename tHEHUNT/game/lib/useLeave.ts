// A short exit before navigating away from an overlay page, so it fades out
// over the desk instead of cutting. Repeated presses are ignored.
import { useCallback, useRef, useState } from 'react';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useLeave(ms = 200) {
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);
  const leave = useCallback((go: () => void) => {
    if (busy.current) return;
    busy.current = true;
    if (reduced()) { go(); return; }
    setLeaving(true);
    window.setTimeout(go, ms);
  }, [ms]);
  return [leaving, leave] as const;
}
