export function formatTime(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Gmail-style: time today, date otherwise. */
export function formatMailDate(at: number, now = Date.now()): string {
  const d = new Date(at), n = new Date(now);
  if (d.toDateString() === n.toDateString()) return formatTime(at);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatFull(at: number): string {
  return new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** mm:ss (or h:mm:ss) remaining; null when expired. */
export function formatRemaining(expiresAt: number, now = Date.now()): string | null {
  const ms = expiresAt - now;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
