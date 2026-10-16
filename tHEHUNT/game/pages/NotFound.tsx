import { useNavigate } from 'react-router-dom';
import { Logo } from '../ui/Logo';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="fallback" style={{ inset: 0 }}>
      <div className="film" aria-hidden="true" />
      <div className="fallback__card">
        <Logo />
        <h1>Dead end</h1>
        <p>This address leads nowhere. The investigation continues elsewhere.</p>
        <div className="fallback__actions"><button type="button" className="btn btn--primary" onClick={() => navigate('/')}>Choose your access</button></div>
      </div>
    </main>
  );
}
