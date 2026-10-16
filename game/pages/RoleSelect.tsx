// First screen: team accounts (create / log in) and the admin password login.
// Mock authentication only — see services/auth.ts for what a backend must take over.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { useGameStore } from '../state/gameStore';
import { useSceneStore } from '../state/sceneStore';
import { paths } from '../orchestration/routes';
import { unlockUiAudio } from '../audio/uiAudio';
import { deskController } from '../scenes/desk/deskController';
import { marketController } from '../scenes/market/marketController';
import { prepareIntroWood } from '../scenes/intro/woodBitmap';
import { loginAdmin, loginTeam, registerTeam, PASSWORD_MIN, TEAM_NAME_MAX } from '../services/auth';
import { isServerBackend } from '../services/backend';
import './role-select.css';

type View = 'choose' | 'team' | 'admin';
type TeamMode = 'create' | 'login';

export function RoleSelect() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('choose');
  const [mode, setMode] = useState<TeamMode>('create');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // build the desk while this screen sits idle, so the phone intro never shares the main thread with it
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle = 0;
    const t = window.setTimeout(() => {
      const idleThen = (fn: () => void) => { if (w.requestIdleCallback) idle = w.requestIdleCallback(fn, { timeout: 3000 }); else fn(); };
      idleThen(() => {
        deskController.preload();
        void deskController.whenReady().then(() => idleThen(() => { void prepareIntroWood(); }));
      });
    }, 1300);
    return () => { window.clearTimeout(t); if (idle) w.cancelIdleCallback?.(idle); };
  }, []);

  useEffect(() => { setError(null); setPassword(''); setConfirm(''); }, [view, mode]);

  const enterTeam = (isNew: boolean) => {
    // a new session: the same built desk is revealed again
    deskController.resetForNewSession();
    deskController.unlockAudio(); // inside the gesture: the desk's sounds may play later
    marketController.resetForNewSession();
    useSceneStore.getState().set({ introPhase: 'idle', pendingFlicker: false });
    // new teams take the call; returning teams go straight to the desk
    if (isNew || !useGameStore.getState().introSeen) navigate(paths.intro);
    else navigate(paths.desk);
  };

  const submitTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    unlockUiAudio();
    setError(null);
    if (mode === 'create' && password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = mode === 'create' ? await registerTeam(name, password) : await loginTeam(name, password);
      if (!r.ok) { setError(r.error); return; }
      enterTeam(r.value.isNew);
    } finally { setBusy(false); }
  };

  const submitAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await loginAdmin(password);
      if (!r.ok) { setError(r.error); return; }
      navigate(paths.admin);
    } finally { setBusy(false); }
  };

  return (
    <main className="role">
      <div className="role__light" aria-hidden="true" />
      <div className="film" aria-hidden="true" />
      <div className="role__inner">
        <Logo size="lg" />
        <p className="role__tag">An investigation is already under way.</p>

        {view === 'choose' && (
          <>
            <h1 className="role__title"><span>Choose your access</span></h1>
            <div className="role__cards">
              <button type="button" className="access access--team" onClick={() => setView('team')}>
                <span className="access__index">01</span>
                <span className="access__name">Team Login</span>
                <span className="access__desc">Create your team or sign back in.</span>
                <span className="access__go" aria-hidden="true">Enter <span>→</span></span>
              </button>
              <button type="button" className="access access--admin" onClick={() => setView('admin')}>
                <span className="access__index">02</span>
                <span className="access__name">Admin Login</span>
                <span className="access__desc">Control centre for the organisers.</span>
                <span className="access__go" aria-hidden="true">Enter <span>→</span></span>
              </button>
            </div>
          </>
        )}

        {view === 'team' && (
          <form className="auth" onSubmit={submitTeam} noValidate aria-label={mode === 'create' ? 'Create team' : 'Team login'}>
            <div className="auth__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'is-on' : ''} onClick={() => setMode('create')}>Create Team</button>
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-on' : ''} onClick={() => setMode('login')}>Login to Existing Team</button>
            </div>
            <label className="auth__field"><span>Team name</span>
              <input name="team" autoComplete="username" value={name} maxLength={TEAM_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus required />
            </label>
            <label className="auth__field"><span>Password</span>
              <input name="password" type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={PASSWORD_MIN} />
            </label>
            {mode === 'create' && (
              <label className="auth__field"><span>Confirm password</span>
                <input name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </label>
            )}
            {error && <p className="auth__error" role="alert">{error}</p>}
            <div className="auth__actions">
              <button type="submit" className="btn btn--primary" disabled={busy}>{mode === 'create' ? 'Create Team' : 'Login'}</button>
              <button type="button" className="btn btn--ghost" onClick={() => setView('choose')}>Back</button>
            </div>
            {mode === 'create' && <p className="auth__hint">At least {PASSWORD_MIN} characters. Team names must be unique.</p>}
          </form>
        )}

        {view === 'admin' && (
          <form className="auth auth--admin" onSubmit={submitAdmin} noValidate aria-label="Admin login">
            <h1 className="auth__title">Admin Login</h1>
            <label className="auth__field"><span>Admin password</span>
              <input name="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
            </label>
            {error && <p className="auth__error" role="alert">{error}</p>}
            <div className="auth__actions">
              <button type="submit" className="btn btn--primary" disabled={busy}>Login</button>
              <button type="button" className="btn btn--ghost" onClick={() => setView('choose')}>Back</button>
            </div>
          </form>
        )}

        {!isServerBackend && <p className="role__note">Prototype accounts are stored in this browser only. Real sign-in needs the game server.</p>}
      </div>
    </main>
  );
}
