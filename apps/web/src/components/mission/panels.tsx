'use client';

/**
 * Mission dashboard panels.
 *
 * House rules, enforced here rather than in a comment somewhere:
 *
 * * A `null` measurement renders as "unavailable", never as `0`.
 * * Every metric states its measurement window.
 * * RSSI is shown only for Wi-Fi, because only Wi-Fi has one.
 * * Session continuity and application deadline performance are separate
 *   panels, because they are separate claims.
 * * Nothing here is a constant. If the engine has not produced a value, the
 *   panel says so.
 */

import {
  ACTION_LABEL,
  CONTROLLER_STATE_LABEL,
  LINK_IDS,
  LINK_LABEL,
  STAGE_LABEL,
  formatMeasurement,
  type EngineEvent,
  type EngineLinkId,
  type EngineLinkObservation,
  type TrafficClassId,
} from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useEffect, useRef } from 'react';
import { Bars, Meter, Sparkline, TimeSeries } from '../ui/charts';
import { Chip, Dot, Panel } from '../ui/primitives';

const PHASE_TONE: Record<string, 'muted' | 'good' | 'warn' | 'blue' | 'bad'> = {
  unavailable: 'bad',
  available: 'muted',
  activating: 'warn',
  validating: 'warn',
  active: 'blue',
  carrying: 'good',
};

export function Unavailable({ why }: { why: string }) {
  return (
    <span className="text-[color:var(--color-muted)]" title={why}>
      unavailable
    </span>
  );
}

function MeasurementValue({
  value,
  unit,
  digits = 0,
  why,
  tone,
}: {
  value: number | null | undefined;
  unit?: string;
  digits?: number;
  why: string;
  tone?: string;
}) {
  const formatted = formatMeasurement(value, { unit, digits });
  if (!formatted.available) {
    return <span className="text-[15px] font-medium text-[color:var(--color-muted)]" title={why}>unavailable</span>;
  }
  return (
    <span className="metric text-[26px] font-semibold leading-none" style={tone ? { color: tone } : undefined}>
      {formatted.text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Left column: the selected link
// ---------------------------------------------------------------------------

export function SelectedLinkCards({
  link,
  observation,
  history,
  windowS,
}: {
  link: EngineLinkId;
  observation: EngineLinkObservation | undefined;
  history: EngineEvent[];
  windowS: number;
}) {
  const series = (pick: (o: EngineLinkObservation) => number | null) =>
    history.map((event) => {
      const obs = event.links[link];
      return obs ? pick(obs) : null;
    });

  const colour = NETWORK_COLOR[link];
  const rssiSupported = link === 'wifi';

  return (
    <>
      <Panel title={`Signal · ${LINK_LABEL[link].label}`}>
        {rssiSupported ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <MeasurementValue
                value={observation?.rssi_dbm}
                unit=""
                digits={0}
                why="No RSSI sample in the current window."
                tone={colour}
              />
              <span className="text-[11px] text-[color:var(--color-muted)]">dBm</span>
            </div>
            <Sparkline values={series((o) => o.rssi_dbm)} color={colour} />
          </>
        ) : (
          <div className="rounded-[8px] border border-dashed border-[color:var(--color-line)] p-2.5">
            <p className="text-[11.5px] leading-snug text-[color:var(--color-muted)]">
              RSSI is a Wi-Fi measurement. {LINK_LABEL[link].label} has no equivalent in this model,
              so none is shown.
            </p>
            <div className="mt-2">
              <div className="panel-label mb-1">Modelled coverage</div>
              <Meter
                value={observation?.modelled_coverage != null ? observation.modelled_coverage * 100 : null}
                color={colour}
                label="modelled coverage"
              />
              <p className="mt-1 text-[10px] text-[color:var(--color-muted)]">
                Geometric, from distance to infrastructure. Not a measured signal level.
              </p>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Round-trip time"
        action={<span className="text-[10px] text-[color:var(--color-muted)]">{windowS}s window</span>}
      >
        <div className="flex items-baseline gap-1.5">
          <MeasurementValue
            value={observation?.rtt_ms}
            digits={0}
            why="Not enough acknowledged packets in the window to compute an RTT."
            tone={colour}
          />
          <span className="text-[11px] text-[color:var(--color-muted)]">ms</span>
          {observation?.jitter_ms != null && (
            <span className="ml-auto text-[10.5px] text-[color:var(--color-muted)]">
              jitter {observation.jitter_ms.toFixed(1)} ms
            </span>
          )}
        </div>
        <Sparkline values={series((o) => o.rtt_ms)} color={colour} />
        <p className="mt-1 text-[10px] text-[color:var(--color-muted)]">
          From acknowledged control packets and probes. Smoothed over {windowS}s.
        </p>
      </Panel>

      <Panel
        title="Packet loss"
        action={<span className="text-[10px] text-[color:var(--color-muted)]">{windowS}s window</span>}
      >
        <div className="flex items-baseline gap-1.5">
          <MeasurementValue
            value={observation?.loss_pct}
            digits={2}
            why="Fewer than the minimum number of transmissions in the window."
            tone={colour}
          />
          <span className="text-[11px] text-[color:var(--color-muted)]">%</span>
        </div>
        <Bars values={series((o) => o.loss_pct)} color={colour} />
        <p className="mt-1 text-[10px] text-[color:var(--color-muted)]">
          (sent − delivered) ÷ sent on this link over the window, including tail drops.
        </p>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Access-state strip
// ---------------------------------------------------------------------------

export function AccessStrip({
  event,
  selected,
  onSelect,
}: {
  event: EngineEvent | null;
  selected: EngineLinkId;
  onSelect: (link: EngineLinkId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {LINK_IDS.map((link) => {
        const obs = event?.links[link];
        const carrying = event?.carrying === link;
        const colour = NETWORK_COLOR[link];
        const phase = obs?.phase ?? 'unavailable';
        return (
          <button
            key={link}
            type="button"
            onClick={() => onSelect(link)}
            aria-pressed={selected === link}
            className="panel px-3 py-2.5 text-left transition-shadow focus-visible:outline focus-visible:outline-2"
            style={{
              borderColor: carrying ? colour : selected === link ? 'var(--color-line-strong)' : 'var(--color-line)',
              background: carrying ? `color-mix(in srgb, ${colour} 6%, white)` : undefined,
              opacity: phase === 'unavailable' ? 0.55 : 1,
            }}
          >
            <div className="flex items-center gap-1.5">
              <Dot color={colour} pulse={phase === 'activating' || phase === 'validating'} />
              <span className="text-[13px] font-semibold">{LINK_LABEL[link].label}</span>
              <span className="text-[10px] text-[color:var(--color-muted)]">{LINK_LABEL[link].sublabel}</span>
              <span className="ml-auto">
                <Chip tone={PHASE_TONE[phase] ?? 'muted'}>{phase.replace('_', ' ')}</Chip>
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-1 text-[10.5px]">
              <div>
                <dt className="text-[color:var(--color-muted)]">RTT</dt>
                <dd className="metric font-semibold">
                  {obs?.rtt_ms != null ? `${obs.rtt_ms.toFixed(0)} ms` : <Unavailable why="no acked samples" />}
                </dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-muted)]">Loss</dt>
                <dd className="metric font-semibold">
                  {obs?.loss_pct != null ? `${obs.loss_pct.toFixed(1)} %` : <Unavailable why="too few sends" />}
                </dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-muted)]">Rate</dt>
                <dd className="metric font-semibold">
                  {obs?.throughput_mbps != null ? (
                    `${obs.throughput_mbps.toFixed(1)} Mb/s`
                  ) : (
                    <Unavailable why="no delivered bytes" />
                  )}
                </dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application health
// ---------------------------------------------------------------------------

const CLASS_ORDER: TrafficClassId[] = ['control', 'voice', 'telemetry', 'video', 'bulk'];
const CLASS_LABEL: Record<TrafficClassId, string> = {
  control: 'Control',
  voice: 'Voice-like',
  telemetry: 'Telemetry',
  video: 'Video',
  bulk: 'Bulk logs',
};

export function ApplicationHealthPanel({ event }: { event: EngineEvent | null }) {
  const app = event?.app ?? null;
  const score = app?.health_score ?? null;
  const tone =
    score === null ? 'var(--color-muted)' : score >= 85 ? 'var(--color-good)' : score >= 60 ? 'var(--color-warn)' : 'var(--color-bad)';

  return (
    <Panel
      title="Application health"
      action={
        <span
          className="text-[10px] text-[color:var(--color-muted)]"
          title="app_health_v1: weighted mean of per-class deadline attainment. Full definition in docs/METRICS.md."
        >
          {app?.health_definition ?? 'app_health_v1'}
        </span>
      }
    >
      <div className="flex items-end gap-3">
        <div>
          <MeasurementValue value={score} digits={0} why="No class has produced enough samples yet." tone={tone} />
          <div className="panel-label mt-0.5">score / 100</div>
        </div>
        <div className="flex-1">
          <Meter value={score} color={tone} label="application health" />
          <p className="mt-1 text-[10px] leading-snug text-[color:var(--color-muted)]">
            Weighted deadline attainment across enabled classes. Reproducible from the receiver logs;
            not an opaque QoS index.
          </p>
        </div>
      </div>

      <table className="mt-3 w-full border-collapse text-[11px]">
        <caption className="sr-only">Per traffic class delivery performance</caption>
        <thead>
          <tr className="text-left text-[color:var(--color-muted)]">
            <th className="pb-1 font-medium">Class</th>
            <th className="pb-1 text-right font-medium">Miss %</th>
            <th className="pb-1 text-right font-medium">p95 ms</th>
            <th className="pb-1 text-right font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {CLASS_ORDER.map((cls) => {
            const health = app?.classes[cls];
            if (!health) return null;
            const detail =
              cls === 'telemetry'
                ? health.freshness_ms != null
                  ? `${health.freshness_ms.toFixed(0)} ms old`
                  : '—'
                : cls === 'video'
                  ? `${health.frames_delivered}/${health.frames_expected} frames`
                  : cls === 'bulk'
                    ? `${(health.bytes_completed / 1e6).toFixed(1)} MB`
                    : `${health.delivered}/${health.sent}`;
            return (
              <tr key={cls} className="border-t border-[color:var(--color-line)]">
                <td className="py-1 font-medium">{CLASS_LABEL[cls]}</td>
                <td className="py-1 text-right">
                  {health.deadline_miss_pct != null ? (
                    <span
                      className="metric font-semibold"
                      style={{
                        color:
                          health.deadline_miss_pct > 5 ? 'var(--color-bad)' : 'var(--color-ink)',
                      }}
                    >
                      {health.deadline_miss_pct.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-[color:var(--color-muted)]">n/a</span>
                  )}
                </td>
                <td className="py-1 text-right metric">
                  {health.p95_latency_ms != null ? health.p95_latency_ms.toFixed(0) : '—'}
                </td>
                <td className="py-1 text-right text-[color:var(--color-muted)]">{detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export function ContinuityPanel({ event }: { event: EngineEvent | null }) {
  const app = event?.app ?? null;
  return (
    <Panel title="Session continuity">
      <p className="mb-2 text-[10.5px] leading-snug text-[color:var(--color-muted)]">
        Whether the transport session survived — a different question from whether application
        deadlines were met.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="panel-label">Session</div>
          <div className="metric text-[12px] font-semibold">{app?.session_id ?? '—'}</div>
        </div>
        <div>
          <div className="panel-label">Reconnects</div>
          <div
            className="metric text-[20px] font-semibold leading-none"
            style={{ color: (app?.session_reconnects ?? 0) > 0 ? 'var(--color-bad)' : 'var(--color-good)' }}
          >
            {app?.session_reconnects ?? '—'}
          </div>
        </div>
        <div>
          <div className="panel-label">Outage</div>
          <div className="metric text-[20px] font-semibold leading-none">
            {app ? `${app.outage_s.toFixed(1)}s` : '—'}
          </div>
        </div>
      </div>
      {app?.in_outage && (
        <div className="mt-2 rounded-[8px] border border-[color:var(--color-bad)] bg-[color-mix(in_srgb,var(--color-bad)_8%,white)] p-2 text-[11.5px]">
          <strong>No usable path.</strong> This is a genuine outage in the model — no software can
          create connectivity where none exists.
          {app.safe_stop && ' The vehicle is holding a simulated safe-stop.'}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Telemetry charts
// ---------------------------------------------------------------------------

export function TelemetryPanel({
  history,
  link,
}: {
  history: EngineEvent[];
  link: EngineLinkId;
}) {
  const window = history.slice(-180);
  const throughput = window.map((e) => e.links[link]?.throughput_mbps ?? null);
  const rtt = window.map((e) => e.links[link]?.rtt_ms ?? null);
  const health = window.map((e) => e.app?.health_score ?? null);
  const first = window[0]?.t ?? 0;
  const last = window[window.length - 1]?.t ?? 0;

  return (
    <Panel title="Telemetry">
      <TimeSeries
        series={[
          { label: 'Throughput', color: NETWORK_COLOR[link], values: throughput, unit: 'Mbps' },
          { label: 'RTT', color: '#7C3CFF', values: rtt, axis: 'right', unit: 'ms' },
        ]}
        xLabels={[`${first.toFixed(0)}s`, `${((first + last) / 2).toFixed(0)}s`, `${last.toFixed(0)}s`]}
      />
      <div className="mt-3">
        <TimeSeries
          title="Application health"
          series={[{ label: 'app_health_v1', color: '#12B981', values: health }]}
          height={70}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Synthetic camera stream.
 *
 * The frame counter is redrawn **only when the engine reports a newly delivered
 * frame**, so a stall in the model is a visible freeze here. It is a generated
 * test pattern, not transported pixels, and it is labelled as such — a local
 * render that bypasses the network is not evidence that video survived.
 */
export function CameraPanel({ event }: { event: EngineEvent | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrames = useRef(-1);
  const video = event?.app?.classes.video;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    if (video.frames_delivered === lastFrames.current) return; // stalled: do not redraw
    lastFrames.current = video.frames_delivered;

    const context = canvas.getContext('2d');
    if (!context) return;
    const { width, height } = canvas;
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#2A3446');
    gradient.addColorStop(1, '#101725');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(255,255,255,0.10)';
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 28) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    // A moving element, so a frozen frame is obvious at a glance.
    const phase = (video.frames_delivered % 60) / 60;
    context.fillStyle = '#12B9E8';
    context.fillRect(phase * (width - 30), height / 2 - 8, 30, 16);

    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.font = '600 11px ui-monospace, monospace';
    context.fillText(`FRAME ${String(video.frames_delivered).padStart(6, '0')}`, 10, 18);
    context.fillText(`t+${(event?.t ?? 0).toFixed(2)}s`, 10, height - 10);
  }, [video, event?.t]);

  // Read straight from the event: the receiver already decided this. Comparing
  // against a ref during render is both a lint error and a subtle correctness
  // bug, because the ref is written from an effect a frame later.
  const stalled = video?.stalled_now === true;

  return (
    <Panel
      title="Camera"
      action={
        <Chip tone="warn" title="Generated test pattern. Frames advance only when the model delivers them. Not transported pixels.">
          SYNTHETIC STREAM
        </Chip>
      }
    >
      <div className="relative overflow-hidden rounded-[10px] border border-[color:var(--color-line)]">
        <canvas ref={canvasRef} width={320} height={180} className="block w-full" />
        {stalled && (
          <div className="absolute inset-0 grid place-items-center bg-[rgba(16,23,37,0.55)]">
            <span className="rounded-full bg-[color:var(--color-bad)] px-2.5 py-1 text-[11px] font-semibold text-white">
              STALLED
            </span>
          </div>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="panel-label">Delivered</dt>
          <dd className="metric font-semibold">
            {video ? `${video.frames_delivered}/${video.frames_expected}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="panel-label">Stall</dt>
          <dd className="metric font-semibold">{video ? `${(video.stall_ms ?? 0).toFixed(0)} ms` : '—'}</dd>
        </div>
        <div>
          <dt className="panel-label">Miss %</dt>
          <dd className="metric font-semibold">
            {video?.deadline_miss_pct != null ? video.deadline_miss_pct.toFixed(1) : '—'}
          </dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[10px] leading-snug text-[color:var(--color-muted)]">
        This render is local and bypasses the modelled network. It visualises measured frame
        delivery; it is not evidence that video was transported.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Pipeline timeline
// ---------------------------------------------------------------------------

const STAGE_TONE: Record<string, 'muted' | 'blue' | 'violet' | 'good' | 'warn'> = {
  observe: 'muted',
  predict: 'violet',
  prepare: 'warn',
  steer: 'blue',
  explain: 'good',
};

export function PipelineTimeline({
  decisions,
  latest,
}: {
  decisions: EngineEvent[];
  latest: EngineEvent | null;
}) {
  const stages = ['observe', 'predict', 'prepare', 'steer', 'explain'] as const;
  const current = latest?.stage ?? 'observe';
  const recent = decisions.slice(-8).reverse();

  return (
    <Panel
      title="Observe → Predict → Prepare → Steer → Explain"
      action={
        latest ? (
          <Chip tone={STAGE_TONE[current] ?? 'muted'}>
            {CONTROLLER_STATE_LABEL[latest.controller_state]}
          </Chip>
        ) : null
      }
    >
      <ol className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Controller pipeline">
        {stages.map((stage, index) => {
          const active = stage === current;
          return (
            <li key={stage} className="flex items-center gap-1.5">
              <span
                className="rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors"
                style={{
                  borderColor: active ? 'var(--color-blue)' : 'var(--color-line)',
                  background: active ? 'color-mix(in srgb, var(--color-blue) 10%, white)' : 'var(--color-surface)',
                  color: active ? 'var(--color-blue)' : 'var(--color-muted)',
                }}
                aria-current={active ? 'step' : undefined}
              >
                {STAGE_LABEL[stage]}
              </span>
              {index < stages.length - 1 && (
                <span aria-hidden className="text-[color:var(--color-line-strong)]">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {recent.length === 0 ? (
        <p className="text-[11.5px] text-[color:var(--color-muted)]">
          No controller actions yet in this run.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {recent.map((event) => (
            <li
              key={`${event.run_id}-${event.seq}`}
              className="flex items-start gap-2.5 rounded-[8px] border border-[color:var(--color-line)] px-2.5 py-1.5"
            >
              <span className="metric mt-[1px] w-[52px] shrink-0 font-[family-name:var(--font-mono)] text-[10.5px] text-[color:var(--color-muted)]">
                t+{event.t.toFixed(1)}s
              </span>
              <Chip tone={STAGE_TONE[event.stage] ?? 'muted'}>
                {ACTION_LABEL[event.action?.kind ?? 'none']}
              </Chip>
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug">{event.reason}</span>
              {event.prediction?.violation_expected && (
                <Chip
                  tone="violet"
                  title={
                    event.prediction.calibrated
                      ? `Calibrated probability ${event.prediction.score}`
                      : `Uncalibrated severity score ${event.prediction.score}. Not a probability.`
                  }
                >
                  predicted
                </Chip>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
