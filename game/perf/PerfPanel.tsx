// Performance read-out: in the DEV panel, and in production behind ?perf=1 (PerfOverlay).
import { useEffect, useState } from 'react';
import { deskController } from '../scenes/desk/deskController';
import { marketController } from '../scenes/market/marketController';
import { useSceneStore } from '../state/sceneStore';
import { useQuality } from './quality';

interface Row { fps: number; ms: number; calls: number; tris: number; pr: number }

export function PerfPanel() {
  const quality = useQuality((s) => s.quality);
  const choice = useQuality((s) => s.choice);
  const [data, setData] = useState<{ active: string; renderers: number; running: number; desk: Row | null; market: Row | null; shadows: number }>({ active: '—', renderers: 0, running: 0, desk: null, market: null, shadows: 0 });

  useEffect(() => {
    let frames = 0, last = performance.now(), raf = 0, pageFps = 0;
    const count = (now: number) => { frames++; if (now - last >= 1000) { pageFps = frames; frames = 0; last = now; } raf = requestAnimationFrame(count); };
    raf = requestAnimationFrame(count);
    const t = window.setInterval(() => {
      const d = deskController.instance as unknown as { stats: { fps: number; ms: number; calls: number; triangles: number; pixelRatio: number; shadowRenders: number }; paused: boolean } | null;
      const m = marketController.engineStats;
      const s = useSceneStore.getState();
      const active = s.shopState !== 'MARKET_INACTIVE' ? 'Normal Market' : s.marketState !== 'MARKET_INACTIVE' ? 'Black Market' : d && !d.paused ? 'Desk' : `UI only (${pageFps} fps)`;
      setData({
        active,
        renderers: (d ? 1 : 0) + (m ? 1 : 0),
        running: (d && !d.paused ? 1 : 0) + (m?.running ? 1 : 0),
        desk: d ? { fps: d.paused ? 0 : d.stats.fps, ms: d.stats.ms, calls: d.stats.calls, tris: d.stats.triangles, pr: d.stats.pixelRatio } : null,
        market: m ? { fps: m.running ? m.fps : 0, ms: m.ms, calls: m.calls, tris: m.triangles, pr: m.pixelRatio } : null,
        shadows: d?.stats.shadowRenders ?? 0,
      });
    }, 500);
    return () => { cancelAnimationFrame(raf); window.clearInterval(t); };
  }, []);

  const row = (label: string, r: Row | null) => r && (
    <div className="dev__stat"><span>{label}</span><code>{r.fps ? `${r.fps} fps · ${r.ms} ms` : 'paused'} · {r.calls} calls · {(r.tris / 1000).toFixed(0)}k tris · pr {r.pr}</code></div>
  );
  return (
    <div className="dev__perf" data-testid="perf-panel">
      <div className="dev__stat"><span>Quality</span><code>{quality}{choice === 'auto' ? ' (auto)' : ''}</code></div>
      <div className="dev__stat"><span>Active</span><code>{data.active}</code></div>
      <div className="dev__stat"><span>Renderers</span><code>{data.renderers} built · {data.running} rendering</code></div>
      {row('Desk', data.desk)}
      {row('Market', data.market)}
      <div className="dev__stat"><span>Shadow renders</span><code>{data.shadows}</code></div>
    </div>
  );
}
