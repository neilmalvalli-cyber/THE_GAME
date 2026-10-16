// /team/* — the persistent shell: 3D stage, top bar, overlays.
// Pages (case HUD, level, inbox, market HUD) render into <Outlet/> on top of
// scenes that stay mounted for the whole session.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { paths } from '../orchestration/routes';
import { useSceneDirector } from '../orchestration/useSceneDirector';
import { deskController } from '../scenes/desk/deskController';
import { marketController } from '../scenes/market/marketController';
import { useSceneStore } from '../state/sceneStore';
import { TopBar } from '../ui/TopBar';
import { WalletOverlay } from '../ui/WalletOverlay';
import { MailNotifier } from '../ui/MailNotifier';
import { InvalidRoute } from './InvalidRoute';
import { connectMarketMail } from '../services/intelFeed';
import { connectAdminMail } from '../services/mail';
import { connectSabotage } from '../services/sabotage';
import { connectTeamSync, isServerBackend } from '../services/backend';
import { SabotageLayer } from '../ui/SabotageLayer';
import { PerfOverlay } from '../perf/PerfOverlay';
import './team.css';
import { env } from '../env';

const DevPanel = env.DEV ? lazy(() => import('../dev/DevPanel')) : null;

function SceneStage() {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current!;
    deskController.attach(el);
    marketController.attach(el);
    return () => { deskController.detach(); marketController.detach(); };
  }, []);
  return <div ref={host} className="scene-stage" />;
}

function DeskStatus() {
  const phase = useSceneStore((s) => s.deskPhase);
  if (phase === 'loading') return <div className="desk-status" aria-live="polite"><span>Preparing the case files…</span></div>;
  return null;
}

export function TeamLayout() {
  // only a signed-in team gets in (deep links and refreshes keep the tab's session)
  const team = useAuth((s) => s.team);
  if (!team) return <Navigate to={paths.roleSelect} replace />;
  return <TeamShell />;
}

function TeamShell() {
  const route = useSceneDirector();
  const onIntro = route.kind === 'intro';
  // market events from the Admin arrive as intelligence mail (deduplicated per event)
  useEffect(() => connectMarketMail(), []);
  // messages composed by the Admin (local mock delivery; see services/mail.ts)
  useEffect(() => (isServerBackend ? connectTeamSync() : connectAdminMail()), []);
  // rival Glitch Attacks / Freezes (local mock; see services/sabotage.ts)
  useEffect(() => (isServerBackend ? undefined : connectSabotage()), []);

  return (
    <div className="team">
      <SceneStage />
      {!onIntro && <TopBar />}
      {!onIntro && <DeskStatus />}
      {route.kind === 'invalid' ? <InvalidRoute /> : <Outlet />}
      <WalletOverlay />
      <MailNotifier />
      <SabotageLayer />
      <PerfOverlay />
      {DevPanel && <Suspense fallback={null}><DevPanel /></Suspense>}
    </div>
  );
}
