// The only persistent navigation in the team interface.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import { IconDoor, IconExit, IconMail, IconPhone, IconShop, IconSound, IconWallet } from './icons';
import { LogoutDialog } from './LogoutDialog';
import { useMarketStore } from '../services/marketState';
import { useGameStore, selectUnreadCount } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { useSceneStore, isCinematicBusy } from '../state/sceneStore';
import { parseTeamRoute, paths } from '../orchestration/routes';
import { playPaper, unlockUiAudio } from '../audio/uiAudio';
import './topbar.css';

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const route = parseTeamRoute(location.pathname);
  const balance = useGameStore((s) => s.wallet.balance);
  const team = useGameStore((s) => s.team);
  const unread = useGameStore(selectUnreadCount);
  const muted = useGameStore((s) => s.settings.muted);
  const setMuted = useGameStore((s) => s.setMuted);
  const walletOpen = useUiStore((s) => s.walletOpen);
  const setWalletOpen = useUiStore((s) => s.setWalletOpen);
  const mailPulse = useUiStore((s) => s.mailPulse);
  const lastDeskPath = useUiStore((s) => s.lastDeskPath);
  // recede while a cinematic owns the screen (market door, desk reveal, purchase)
  // (on the desk it stays away until the reveal has finished, so it never flashes in first)
  const onDesk = route.kind === 'desk' || route.kind === 'case';
  const receded = useSceneStore((s) => (onDesk && s.deskPhase !== 'revealed' && s.deskPhase !== 'error')
    || s.deskPhase === 'revealing' || ((s.marketState !== 'MARKET_INACTIVE' || s.shopState !== 'MARKET_INACTIVE') && isCinematicBusy(s)));

  const [leaving, setLeaving] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!mailPulse) return;
    setPulsing(true);
    const t = window.setTimeout(() => setPulsing(false), 1800);
    return () => window.clearTimeout(t);
  }, [mailPulse]);

  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevBalance = useRef(balance);
  useEffect(() => {
    if (balance === prevBalance.current) return;
    setFlash(balance > prevBalance.current ? 'up' : 'down');
    prevBalance.current = balance;
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [balance]);

  const go = (to: string) => { unlockUiAudio(); if (location.pathname !== to) navigate(to); };
  const inBlack = route.kind === 'blackMarket';
  const inShop = route.kind === 'shop';
  const inPhone = route.kind === 'phone';
  const inInbox = route.kind === 'inbox';

  // The Black Market entry exists only while the Admin has it active (or while the team
  // is still inside after a deactivation, so the way out never disappears). When it first
  // appears in this view it is revealed, not just switched on.
  const blackActive = useMarketStore((s) => s.blackMarketStatus === 'active');
  const showBlack = blackActive || inBlack;
  const [revealBlack, setRevealBlack] = useState(false);
  const wasActive = useRef(blackActive);
  useEffect(() => {
    if (blackActive && !wasActive.current) {
      setRevealBlack(true);
      const t = window.setTimeout(() => setRevealBlack(false), 2600);
      wasActive.current = blackActive;
      return () => window.clearTimeout(t);
    }
    wasActive.current = blackActive;
  }, [blackActive]);

  return (
    <header className={`topbar${receded ? ' topbar--receded' : ''}`} aria-hidden={receded || undefined}>
      <button type="button" className="topbar__home" onClick={() => go(paths.desk)} aria-label="THE GAME — back to the case desk">
        <Logo />
        <span className="topbar__label">Case Desk</span>
      </button>

      <nav className="topbar__nav" aria-label="Team navigation">
        <button type="button" className={`topbar__item${inPhone ? ' is-active' : ''}`} onClick={() => go(paths.phone)} aria-label="Evidence phone" aria-current={inPhone ? 'page' : undefined}>
          <IconPhone /><span className="topbar__text">Phone</span>
        </button>

        <button type="button" className={`topbar__item${inShop ? ' is-active' : ''}`} onClick={() => go(paths.market)} aria-label="Market" aria-current={inShop ? 'page' : undefined}>
          <IconShop /><span className="topbar__text">Market</span>
        </button>

        {showBlack && (
          <button type="button" className={`topbar__item topbar__black${inBlack ? ' is-active' : ''}${revealBlack ? ' is-revealing' : ''}`}
            onClick={() => go(inBlack ? lastDeskPath : paths.blackMarket)} aria-label={inBlack ? 'Leave the Black Market' : 'Black Market'}>
            <IconDoor /><span className="topbar__text">{inBlack ? 'Leave Market' : 'Black Market'}</span>
          </button>
        )}

        <button type="button" className={`topbar__item topbar__wallet${walletOpen ? ' is-active' : ''}${flash ? ` flash-${flash}` : ''}`}
          onClick={() => { unlockUiAudio(); playPaper(); setWalletOpen(!walletOpen); }} aria-haspopup="dialog" aria-expanded={walletOpen}
          aria-label={`Wallet: ${balance} coins`}>
          <IconWallet /><span className="topbar__text topbar__text--keep"><span className="coin"><span className="coin__dot" />{balance.toLocaleString()}</span></span>
        </button>

        <button type="button" className={`topbar__item topbar__mail${inInbox ? ' is-active' : ''}${pulsing ? ' is-pulsing' : ''}`}
          onClick={() => go(paths.inbox)} aria-label={unread ? `Intelligence mail, ${unread} unread` : 'Intelligence mail'}>
          <span className="topbar__mailicon"><IconMail />{unread > 0 && <span className="topbar__badge">{unread > 9 ? '9+' : unread}</span>}</span>
          <span className="topbar__text">Mail</span>
        </button>

        <button type="button" className="topbar__item topbar__icon" onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label={muted ? 'Sound off — turn on' : 'Sound on — mute'}>
          <IconSound muted={muted} />
        </button>

        <button type="button" className="topbar__item topbar__icon" onClick={() => setLeaving(true)} aria-label="Leave — return to login">
          <IconExit />
        </button>

        <span className="topbar__team" title={team.id}><span className="topbar__teamname">{team.name}</span><span className="topbar__teamid">{team.id}</span></span>
      </nav>
      {leaving && <LogoutDialog onCancel={() => setLeaving(false)} />}
    </header>
  );
}
