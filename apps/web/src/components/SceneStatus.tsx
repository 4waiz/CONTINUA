'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-2F22B6DAF0BE */

/**
 * What the scene's box says when there is no scene to show: WebGL missing, the
 * context lost, or the scene throwing while it renders. A WebGL app that shows
 * a blank rectangle when something goes wrong is worse than one that says what
 * happened.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

export function StatusPane({
  tone,
  title,
  body,
  detail,
}: {
  tone: 'bad' | 'muted';
  title: string;
  body: string;
  detail?: string;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center p-8">
      <div className="max-w-md text-center">
        <div
          className="panel-label mb-2"
          style={{ color: tone === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)' }}
        >
          {tone === 'bad' ? 'Scene unavailable' : 'Status'}
        </div>
        <h3 className="text-[17px] font-semibold text-[color:var(--color-ink)]">{title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--color-muted)]">{body}</p>
        {detail && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--color-muted)]">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

export class SceneErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[CONTINUA] scene failed to render', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <StatusPane
          tone="bad"
          title="The scene could not be rendered"
          body={this.state.error.message}
          detail="Assets are served from /models. If they are missing, run `npm run blender:all` to regenerate them."
        />
      );
    }
    return this.props.children;
  }
}
