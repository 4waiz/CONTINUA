'use client';

/**
 * The driver's card: while the viewer has the wheel, how fast the rover is
 * going and which keys do what; before, the one button that hands it over.
 *
 * The speed is the viewer's own driving, not a network figure, and the card
 * says where the network on screen comes from: the recorded run, read at the
 * rover's point of the road (`useDrive.ts`).
 */

import { InfoTip } from '../ui/InfoTip';
import { SteeringIcon } from '../ui/icons';
import type { DriveReadout } from './useDrive';

function Key({ children, wide = false }: { children: string; wide?: boolean }) {
  return (
    <kbd className="drive-key" data-wide={wide}>
      {children}
    </kbd>
  );
}

export function DriveHud({
  driving,
  preparing,
  error,
  readout,
  runId,
  onTake,
  onRelease,
}: {
  driving: boolean;
  preparing: boolean;
  error: string | null;
  readout: DriveReadout | null;
  /** The recording being driven through, named on the card. */
  runId: string | null;
  onTake: () => void;
  onRelease: () => void;
}) {
  if (!driving) {
    return (
      <div className="drive-hud drive-offer enter" role="group" aria-label="Drive the rover yourself">
        <button type="button" className="drive-offer-button" onClick={onTake} disabled={preparing}>
          <span className="drive-offer-icon" aria-hidden>
            <SteeringIcon size={18} />
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="drive-offer-title">{preparing ? 'Getting the road ready…' : 'Take the wheel'}</span>
            <span className="drive-offer-keys" aria-hidden>
              <Key>W</Key>
              <Key>A</Key>
              <Key>S</Key>
              <Key>D</Key>
              <span className="ml-1">or the arrows</span>
            </span>
          </span>
        </button>
        {error && <p className="drive-error">{error}</p>}
      </div>
    );
  }

  const speed = readout ? Math.round(readout.speedKmh) : 0;
  const gear = readout?.gear ?? 'N';
  return (
    <section className="drive-hud drive-card glass enter" aria-label="You are driving">
      <header className="flex items-center gap-2">
        <span className="drive-offer-icon" data-live="true" aria-hidden>
          <SteeringIcon size={16} />
        </span>
        <span className="section-label !text-[color:var(--color-blue)]">You&apos;re driving</span>
        <span className="ml-auto">
          <InfoTip
            align="end"
            text={`You steer the rover; the road keeps it on. What the network does is not worked out here: every link, warning and handoff on screen is the recorded run${
              runId ? ` (${runId})` : ''
            } at the point of the road you are on - drive forward and it plays on, back up and it plays back.`}
          />
        </span>
      </header>
      <div className="drive-speed" aria-live="off">
        <span className="metric drive-speed-value">{speed}</span>
        <span className="drive-speed-unit">km/h</span>
        <span className="drive-gear" data-gear={gear} title={gear === 'D' ? 'Driving forward' : gear === 'R' ? 'Reversing' : 'Stopped'}>
          {gear}
        </span>
      </div>
      {readout?.bumped && <p className="drive-note">The kerb: the rover stays on the road.</p>}
      {readout?.atEnd && <p className="drive-note">The ground station - the end of the road. Turn round on the circle, or hand back.</p>}
      <ul className="drive-keys" aria-label="Keys">
        <li>
          <Key>W</Key> drive
        </li>
        <li>
          <Key>S</Key> brake · reverse
        </li>
        <li>
          <Key>A</Key>
          <Key>D</Key> steer
        </li>
        <li>
          <Key wide>Space</Key> hold
        </li>
      </ul>
      <button type="button" className="control w-full" onClick={onRelease} title="Hand the rover back to the recording, from here (Esc)">
        Autopilot <Key wide>Esc</Key>
      </button>
      <p className="drive-source">Network: the recorded run at this point of the road.</p>
    </section>
  );
}
