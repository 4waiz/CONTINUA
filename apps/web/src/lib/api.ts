/**
 * REST client for the CONTINUA engine.
 *
 * Every call goes through `request`, which turns a non-2xx or an unreachable
 * backend into a typed `EngineApiError`. The UI surfaces that as a disconnected
 * state; it never falls back to placeholder numbers to keep the dashboard
 * looking alive.
 */

import type { EngineRunState, PolicyIdString } from '@continua/contracts/engine';

export const ENGINE_BASE =
  process.env.NEXT_PUBLIC_ENGINE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000';

export class EngineApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'EngineApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch (cause) {
    throw new EngineApiError(
      `Cannot reach the CONTINUA engine at ${ENGINE_BASE}. Is it running?`,
      null,
      cause,
    );
  }
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    const message =
      (detail as { detail?: string })?.detail ?? `Engine returned ${response.status}`;
    throw new EngineApiError(String(message), response.status, detail);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------

export interface EngineHealth {
  ok: boolean;
  engine_version: string;
  schema_version: string;
  time: string;
  live_sessions: number;
  learned_predictor_available: boolean;
  learned_predictor_version: string;
}

export interface ScenarioSpec {
  id: string;
  title: string;
  family: string;
  description: string;
  duration_s: number;
  links: string[];
  workload: string[];
  faults: { link: string; kind: string; start_s: number; duration_s: number; severity?: number }[];
  background: { link: string; start_s: number; duration_s: number; load: number }[];
  speed_scale: number;
  reverse: boolean;
}

export interface PolicySpec {
  id: PolicyIdString;
  multipath: boolean;
  proactive_warm: boolean;
  use_prediction: boolean;
  always_redundant: boolean;
  app_aware: boolean;
  min_dwell_s: number;
  predictor: string;
}

export interface CapabilityCheck {
  name: string;
  required_for: string;
  ok: boolean;
  detail: string;
  value: string | null;
}

export interface CapabilityReport {
  generated_at: string;
  host_platform: string;
  probe_target: string;
  checks: CapabilityCheck[];
  emulation_supported: boolean;
  mptcp_supported: boolean;
  blocking_reasons: string[];
  summary: string;
}

export interface RunRow {
  run_id: string;
  mode: string;
  scenario_id: string;
  policy_id: string;
  seed: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_s: number | null;
  events: number;
  source_mode: string | null;
  source_run_id: string | null;
  recorded_at: string | null;
  code_commit: string | null;
  predictor: string | null;
  horizon_s: number | null;
}

export const api = {
  health: () => request<EngineHealth>('/api/health'),
  scenarios: () => request<{ scenarios: ScenarioSpec[] }>('/api/scenarios'),
  policies: () =>
    request<{ policies: PolicySpec[]; violation_definition: string }>('/api/policies'),
  profiles: () => request<Record<string, unknown>>('/api/profiles'),
  capability: () => request<CapabilityReport>('/api/capability'),

  listRuns: (limit = 40) =>
    request<{ runs: RunRow[]; live: EngineRunState[] }>(`/api/runs?limit=${limit}`),
  getRun: (runId: string) => request<Record<string, unknown>>(`/api/runs/${runId}`),
  getRunEvents: (runId: string, offset = 0, limit = 4000) =>
    request<{ run_id: string; total: number; offset: number; events: unknown[] }>(
      `/api/runs/${runId}/events?offset=${offset}&limit=${limit}`,
    ),
  getRunMetrics: (runId: string) => request<Record<string, unknown>>(`/api/runs/${runId}/metrics`),

  startRun: (body: {
    control: {
      scenario_id: string;
      policy_id: PolicyIdString;
      seed: number;
      mode?: 'simulation';
      speed?: number;
      predictor?: 'heuristic' | 'learned' | 'none';
      horizon_s?: number;
    };
    overrides?: Record<string, unknown> | null;
  }) =>
    request<{ run_id: string; state: EngineRunState }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  controlRun: (
    runId: string,
    body: { action: 'play' | 'pause' | 'reset' | 'seek' | 'speed' | 'stop'; t?: number; speed?: number },
  ) =>
    request<{ state: EngineRunState }>(`/api/runs/${runId}/control`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  replay: (runId: string) =>
    request<{ run_id: string; state: EngineRunState }>(`/api/runs/${runId}/replay`, {
      method: 'POST',
    }),

  startExperiment: (body: {
    scenario_id: string;
    trials?: number;
    policies?: PolicyIdString[];
    block?: 'train' | 'tune' | 'test';
    predictor?: 'heuristic' | 'learned' | 'none';
    horizon_s?: number;
  }) =>
    request<{ experiment_id: string; status: string }>('/api/experiments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listExperiments: () =>
    request<{ stored: Record<string, unknown>[]; in_flight: Record<string, unknown> }>(
      '/api/experiments',
    ),
  getExperiment: (id: string) => request<Record<string, unknown>>(`/api/experiments/${id}`),
};

export function socketUrl(runId: string): string {
  const base = ENGINE_BASE.replace(/^http/, 'ws');
  return `${base}/ws/runs/${runId}`;
}
