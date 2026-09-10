'use client';

/**
 * Renderer cost, measured rather than asserted.
 *
 * Frame rate comes from counting animation frames in a one-second window;
 * draw calls, triangles and geometry counts come from three.js's own
 * `renderer.info`, which the scene publishes on `window.__CONTINUA__.three`.
 * If the scene has not mounted yet there is nothing to report and this renders
 * nothing - a performance readout that invents numbers is worse than no
 * performance readout.
 *
 * Deliberately discreet: it belongs to Scene Lab, which is the technical view.
 * It is not on the Mission dashboard.
 */

import { useEffect, useState } from 'react';

interface Stats {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
}

interface ThreeHandle {
  gl?: { info?: { render?: { calls?: number; triangles?: number }; memory?: { geometries?: number } } };
}

export function ScenePerformance() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let frames = 0;
    let since = performance.now();
    let raf = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      frames += 1;
      const now = performance.now();
      if (now - since >= 1000) {
        const handle = (window as unknown as { __CONTINUA__?: { three?: ThreeHandle } }).__CONTINUA__;
        const info = handle?.three?.gl?.info;
        setStats({
          fps: Math.round((frames * 1000) / (now - since)),
          calls: info?.render?.calls ?? 0,
          triangles: info?.render?.triangles ?? 0,
          geometries: info?.memory?.geometries ?? 0,
        });
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  if (!stats) return null;

  const items: [string, string][] = [
    ['FPS', String(stats.fps)],
    ['Draw calls', stats.calls ? String(stats.calls) : ' - '],
    ['Triangles', stats.triangles ? `${(stats.triangles / 1000).toFixed(0)}k` : ' - '],
    ['Geometries', stats.geometries ? String(stats.geometries) : ' - '],
  ];

  return (
    <dl className="flex items-center gap-5">
      {items.map(([label, value]) => (
        <div key={label} className="leading-tight">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-faint)]">
            {label}
          </dt>
          <dd className="metric text-[13px] font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
