'use client';

/**
 * What the operator sees when the engine is not there.
 *
 * The version this replaces was a full-width red banner containing a raw
 * host:port, which read as a stack trace and dominated the page. An operator
 * needs to know two things - that simulation services are unavailable, and how
 * to try again. The address is a developer detail and lives behind a disclosure.
 *
 * Critically, this is a *strip*, not a takeover: the rest of the interface still
 * renders, the 3D scene still loads in preview, and every metric shows a
 * placeholder rather than a fabricated value.
 */

import { useState } from 'react';

export function EngineStatus({
  detail,
  onRetry,
  retrying = false,
}: {
  /** The raw error, shown only when the operator asks for it. */
  detail: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border px-4 py-2.5"
      style={{
        borderColor: 'color-mix(in srgb, var(--color-warn) 38%, transparent)',
        background: 'color-mix(in srgb, var(--color-warn) 8%, white)',
      }}
      role="status"
    >
      <span
        aria-hidden
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ background: 'var(--color-warn)' }}
      />
      <p
        className="min-w-0 flex-1 text-[13.5px] font-semibold leading-tight"
        title="Simulation services are unavailable. The scene is a preview and no measurements are being produced."
      >
        CONTINUA engine offline
        <span className="ml-2 font-normal text-[color:var(--color-muted)]">
          scene is a preview · no measurements
        </span>
      </p>

      <button type="button" className="control" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Retry connection'}
      </button>

      <button
        type="button"
        className="text-[11.5px] font-semibold text-[color:var(--color-muted)] underline underline-offset-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Hide detail' : 'Detail'}
      </button>

      {open && (
        <p className="w-full font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--color-muted)]">
          {detail}
          <span className="ml-2 opacity-70">- start it with `npm run engine`</span>
        </p>
      )}
    </div>
  );
}
