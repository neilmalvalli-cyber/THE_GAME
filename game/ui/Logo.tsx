// THE GAME mark: the watching eye from the caller ID on the phone intro.
interface Props { size?: 'sm' | 'lg'; withWord?: boolean }

export function Eye({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12c3.3-5 6.4-7 9.5-7s6.2 2 9.5 7c-3.3 5-6.4 7-9.5 7s-6.2-2-9.5-7z" />
      <circle cx="12" cy="12" r="3.3" />
      <circle cx="12" cy="12" r="1.1" fill="#c22d2f" stroke="none" />
    </svg>
  );
}

export function Logo({ size = 'sm', withWord = true }: Props) {
  return (
    <span className={`logo logo--${size}`}>
      <span className="logo__mark"><Eye size={size === 'lg' ? 46 : 22} /></span>
      {withWord && <span className="logo__word">THE GAME</span>}
    </span>
  );
}
