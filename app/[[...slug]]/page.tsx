// THE GAME runs as a client-side app inside this Next.js app. Every path not claimed by
// another route (/ops, /api, …) lands here and react-router takes over.
import '@/game/styles/global.css';
import '@/game/pages/team.css';
import { GameClient } from './client';

export function generateStaticParams() {
  return [{ slug: [''] }];
}

export default function Page() {
  return <GameClient />;
}
