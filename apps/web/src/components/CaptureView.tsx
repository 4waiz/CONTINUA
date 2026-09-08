'use client';

/**
 * Capture view — a fixed 16:9 frame for Phase 3 video.
 *
 * Deliberately spare: no navigation, no dev overlays, nothing to crop around.
 * It exposes a deterministic seek and an asset-ready signal on
 * `window.__CONTINUA_CAPTURE__`, and it always shows the source mode, run id and
 * scenario, so a recording can never be mistaken for something it is not.
 *
 * There is no "LIVE" badge during playback. A replay says REPLAY.
 */

import { api } from '@/lib/api';
import { useEngineRun } from '@/lib/useEngineRun';
import { LINK_IDS, LINK_LABEL } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useEffect } from 'react';
import { ModeBadge } from './AppShell';
import { MissionScene } from './mission/MissionScene';

export function CaptureView({ runId }: { runId: string | null }) {
  const run = useEngineRun(runId);
  const playing = run.state?.status === 'running';
  // Derived, not stored: the capture harness polls `data-capture-ready`, and a
  // value that lags one render behind would let it start recording too early.
  const ready = run.source.eventCount > 0 && run.connection === 'connected';

  useEffect(() => {
    (window as unknown as { __CONTINUA_CAPTURE__?: unknown }).__CONTINUA_CAPTURE__ = {
      ready,
      runId: run.state?.run_id ?? null,
      mode: run.state?.mode ?? null,
      scenario: run.state?.scenario_id ?? null,
      t: run.state?.t ?? 0,
      duration: run.state?.duration_s ?? 0,
      seek: (t: number) =>
        runId ? api.controlRun(runId, { action: 'seek', t }) : Promise.resolve(null),
      pause: () => (runId ? api.controlRun(runId, { action: 'pause' }) : Promise.resolve(null)),
      play: () => (runId ? api.controlRun(runId, { action: 'play' }) : Promise.resolve(null)),
    };
  }, [ready, run.state, runId]);

  const app = run.latest?.app;

  return (
    <div className="grid min-h-screen place-items-center bg-[color:var(--color-bg)] p-4">
      <div
        className="relative w-full max-w-[1600px] overflow-hidden rounded-[18px] border border-[color:var(--color-line)] bg-white shadow-[var(--shadow-raised)]"
        style={{ aspectRatio: '16 / 9' }}
        data-capture-ready={ready ? 'true' : 'false'}
      >
        {runId ? (
          <MissionScene
            source={run.source}
            t={run.state?.t ?? 0}
            duration={run.state?.duration_s ?? 100}
            playing={playing && !run.stale}
            className="!absolute inset-0 !rounded-none !border-0"
          />
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-[color:var(--color-muted)]">
            Append a run id to capture a specific run, for example /capture?run=run-abc123
          </div>
        )}

        {/* Identity strip. Never omitted, in any capture. */}
        <div className="pointer-events-none absolute left-5 top-4 flex items-center gap-2.5">
          <span
            className="text-[26px] font-semibold leading-none tracking-[-0.03em]"
            style={{
              background: 'linear-gradient(96deg,#176BFF,#7C3CFF)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            CONTINUA
          </span>
          <span className="text-[12px] text-[color:var(--color-muted)]">
            Predictive Network Continuity
          </span>
          <ModeBadge state={run.state} />
        </div>

        <div className="pointer-events-none absolute right-5 top-4 text-right text-[10.5px] text-[color:var(--color-muted)]">
          <div className="font-[family-name:var(--font-mono)]">{run.state?.run_id ?? '—'}</div>
          <div>{run.state?.scenario_title || run.state?.scenario_id || ''}</div>
          <div>
            policy {run.state?.policy_id ?? '—'} · seed {run.state?.seed ?? '—'} · t+
            {(run.state?.t ?? 0).toFixed(1)}s
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
          <div className="flex gap-1.5">
            {LINK_IDS.map((link) => {
              const obs = run.latest?.links[link];
              const carrying = run.latest?.carrying === link;
              return (
                <div
                  key={link}
                  className="rounded-[10px] border bg-white/90 px-2.5 py-1.5 backdrop-blur"
                  style={{
                    borderColor: carrying ? NETWORK_COLOR[link] : 'var(--color-line)',
                    opacity: obs?.phase === 'unavailable' ? 0.45 : 1,
                  }}
                >
                  <div className="text-[11px] font-semibold" style={{ color: NETWORK_COLOR[link] }}>
                    {LINK_LABEL[link].label}
                  </div>
                  <div className="metric text-[10px] text-[color:var(--color-muted)]">
                    {obs?.rtt_ms != null ? `${obs.rtt_ms.toFixed(0)} ms` : 'unavailable'}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-[10px] border border-[color:var(--color-line)] bg-white/90 px-3 py-1.5 text-right backdrop-blur">
            <div className="panel-label">App health · app_health_v1</div>
            <div className="metric text-[20px] font-semibold leading-none">
              {app?.health_score != null ? app.health_score.toFixed(0) : '—'}
            </div>
            <div className="text-[10px] text-[color:var(--color-muted)]">
              reconnects {app?.session_reconnects ?? '—'} · outage {(app?.outage_s ?? 0).toFixed(1)}s
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
