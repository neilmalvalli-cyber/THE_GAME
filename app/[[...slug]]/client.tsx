'use client';

import dynamic from 'next/dynamic';

// three.js, WebGL and browser storage: never rendered on the server
const Game = dynamic(() => import('@/game/boot').then((m) => m.Boot), { ssr: false });

export function GameClient() {
  return <Game />;
}
