// /team/intro — the phone call, then hand-off to the desk (light flicker).
import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PhoneIntro } from '../scenes/intro/PhoneIntro';
import { useGameStore } from '../state/gameStore';
import { useSceneStore } from '../state/sceneStore';
import { paths } from '../orchestration/routes';
import { markIntroSeenRemote } from '../services/backend';

export function IntroPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useGameStore((s) => s.session);
  const muted = useGameStore((s) => s.settings.muted);
  const replay = (location.state as { replay?: boolean } | null)?.replay === true;

  useEffect(() => () => {
    // leaving mid-call (Back button): the intro is no longer playing
    if (useSceneStore.getState().introPhase === 'playing') useSceneStore.getState().set({ introPhase: 'idle' });
  }, []);

  // the intro plays once per session
  if (session?.introCompleted && !replay) return <Navigate to={paths.desk} replace />;

  // a click on Team Login is the gesture that allows sound; a cold refresh shows the intro's own gate
  const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false;

  return (
    <PhoneIntro
      autoStart={activated}
      sound={!muted}
      onModeChange={(mode) => useSceneStore.getState().set({ introPhase: mode === 'play' ? 'playing' : mode === 'done' ? 'completed' : 'gate' })}
      onIntroComplete={() => {
        useGameStore.getState().completeIntro();
        markIntroSeenRemote();
        useSceneStore.getState().set({ pendingFlicker: true, introPhase: 'completed' });
        navigate(paths.desk, { replace: true });
      }}
    />
  );
}
