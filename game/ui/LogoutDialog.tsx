// "Leave the investigation?" — the confirmed way back to the login screen.
// Progress stays saved under the team; the session ends and the scenes stop.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { logoutTeam } from '../services/auth';
import { deskController } from '../scenes/desk/deskController';
import { marketController } from '../scenes/market/marketController';
import { useSceneStore } from '../state/sceneStore';
import { useUiStore } from '../state/uiStore';
import { paths } from '../orchestration/routes';
import '../pages/admin.css'; // shared dialog styles

export function LogoutDialog({ onCancel }: { onCancel(): void }) {
  const navigate = useNavigate();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const leave = () => {
    // stop what is playing, then end the session (the team's save is left untouched)
    marketController.resetForNewSession();
    deskController.resetForNewSession();
    deskController.setRunning(false);
    deskController.setVisible(false);
    useSceneStore.getState().set({ introPhase: 'idle', pendingFlicker: false });
    useUiStore.getState().setWalletOpen(false);
    logoutTeam();
    navigate(paths.roleSelect, { replace: true });
  };

  return createPortal((
    <div className="ops-dialog" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ops-dialog__box" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-body">
        <h3 id="logout-title">Leave the investigation?</h3>
        <p id="logout-body">Your current progress will be saved. Do you want to return to the login screen?</p>
        <div className="ops-dialog__actions">
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={leave}>Return to Login</button>
        </div>
      </div>
    </div>
  ), document.body);
}
