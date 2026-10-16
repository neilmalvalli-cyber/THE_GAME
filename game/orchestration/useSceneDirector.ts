// Route → scenes. Runs in the team layout. Decides, for the current URL:
//   · what the desk should show (a file open / all files / leave it),
//   · whether we should be in the Black Market (only while the Admin has it active;
//     a team already inside when it is deactivated is not thrown out mid-animation),
//   · which scene renders and which is paused,
//   · how the desk first appears this session (flicker / landing / restore).
// It never resets animations on navigation; it only sets targets, and the
// controllers reach them through each scene's own legal transitions.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { deskController } from '../scenes/desk/deskController';
import { marketController, prefetchMarket } from '../scenes/market/marketController';
import { useSceneStore } from '../state/sceneStore';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { parseTeamRoute, paths } from './routes';
import { useMarketStore } from '../services/marketState';

export function useSceneDirector() {
  const location = useLocation();
  const navigate = useNavigate();
  const deskPhase = useSceneStore((s) => s.deskPhase);
  const marketState = useSceneStore((s) => s.marketState);
  const shopState = useSceneStore((s) => s.shopState);
  const inAnyMarket = marketState !== 'MARKET_INACTIVE' || shopState !== 'MARKET_INACTIVE';
  const blackStatus = useMarketStore((s) => s.blackMarketStatus);
  const route = parseTeamRoute(location.pathname);
  const enteringBlack = route.kind === 'blackMarket' && blackStatus === 'active';
  const enteringMarket = enteringBlack || route.kind === 'shop';

  // ---- desk / market targets ------------------------------------------------
  useEffect(() => {
    if (route.kind === 'intro') {
      void deskController.init(); // preload behind the intro
      return;
    }
    if (route.kind === 'desk' || route.kind === 'case') useUiStore.getState().setLastDeskPath(location.pathname);

    const deskTarget = route.kind === 'case' || route.kind === 'level' ? route.caseId
      : route.kind === 'desk' || route.kind === 'invalid' ? null
        : 'keep';
    deskController.setTarget(deskTarget);
    marketController.setTarget(
      route.kind === 'blackMarket'
        // locked: nobody gets in; a team already inside when it was deactivated stays until it leaves
        ? (blackStatus === 'active' ? 'black' : useSceneStore.getState().marketState !== 'MARKET_INACTIVE' ? 'keep' : 'outside')
        : route.kind === 'shop' ? 'store'
          : route.kind === 'inbox' ? 'keep' : 'outside',
    );
  }, [location.pathname, blackStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- first appearance of the desk ------------------------------------------
  useEffect(() => {
    if (route.kind === 'intro' || enteringMarket) return;
    if (deskController.isRevealed) return;
    if (deskPhase !== 'ready' && deskPhase !== 'loading' && deskPhase !== 'unloaded') return;
    const scene = useSceneStore.getState();
    const session = useGameStore.getState().session;
    let mode: 'flicker' | 'landing' | 'restore' = 'restore';
    if (scene.pendingFlicker) mode = 'flicker';
    else if (!session?.deskLanded && route.kind === 'desk') mode = 'landing';
    if (scene.pendingFlicker) scene.set({ pendingFlicker: false });
    void deskController.reveal(mode);
  }, [location.pathname, deskPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- what renders ----------------------------------------------------------
  useEffect(() => {
    // full-screen pages over the desk: it stays drawn underneath but stops rendering
    const covered = route.kind === 'level' || route.kind === 'inbox' || route.kind === 'invalid'
      || route.kind === 'phone' || (route.kind === 'blackMarket' && marketState === 'MARKET_INACTIVE' && blackStatus !== 'active');
    if (!inAnyMarket && deskController.isRevealed && route.kind !== 'intro') {
      deskController.setVisible(true);
      deskController.setRunning(!covered);
    }
    if (route.kind === 'intro') {
      deskController.setRunning(false);
      deskController.setVisible(false);
    }
    marketController.setCovered(route.kind === 'inbox');
  }, [location.pathname, marketState, shopState, deskPhase, blackStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- fetch the Black Market code once the desk has settled ------------------------
  // Code only. The room itself (a second WebGL context, textures, shader compile) is built
  // on the way in, behind the black fade: creating a GL context while the desk is on screen
  // can stall the GPU on some systems and flash the canvas black.
  useEffect(() => {
    if (deskPhase !== 'revealed') return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const t = window.setTimeout(() => {
      const run = () => { void prefetchMarket(); };
      if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 }); else run();
    }, 2500);
    return () => window.clearTimeout(t);
  }, [deskPhase]);

  // ---- events that come from inside the scenes -------------------------------------
  useEffect(() => {
    const offOpen = deskController.onUserOpen((id) => {
      if (parseTeamRoute(window.location.pathname).kind === 'desk') navigate(paths.case(id));
    });
    const offExit = marketController.onExited((kind) => {
      // left from inside the room (the scene's own "Leave"): follow it in the URL
      const k = parseTeamRoute(window.location.pathname).kind;
      if ((kind === 'black' && k === 'blackMarket') || (kind === 'store' && k === 'shop')) navigate(useUiStore.getState().lastDeskPath);
    });
    return () => { offOpen(); offExit(); };
  }, [navigate]);

  return route;
}
