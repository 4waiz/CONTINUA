'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-D901BF738621 */

/**
 * A page's tour, ready to drop in: on a first visit, an offer of it in the
 * corner of the screen - never the tour itself, unasked - and the tour when
 * the offer is taken or the top bar's Guide asks for it.
 */

import { useEffect, useState } from 'react';
import { GuideIcon } from '../ui/icons';
import { Tour, type TourStep } from './Tour';
import { usePageTour } from './usePageTour';

/** How long a page is on screen before the offer appears: long enough to see the page first. */
const OFFER_AFTER_MS = 1400;

export function TourOffer({
  body,
  onStart,
  onDecline,
}: {
  body: string;
  onStart: () => void;
  onDecline: () => void;
}) {
  return (
    <aside className="tour-prompt" aria-label="A tour of this page">
      <span className="tour-prompt-icon" aria-hidden>
        <GuideIcon size={18} />
      </span>
      <div className="min-w-0">
        <p className="tour-prompt-title">First time on this page?</p>
        <p className="tour-prompt-body">{body}</p>
        <div className="tour-prompt-actions">
          <button type="button" className="control control-primary" onClick={onStart}>
            Show me around
          </button>
          <button type="button" className="control" onClick={onDecline}>
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}

export function PageTour({
  id,
  steps,
  label,
  offer,
}: {
  id: string;
  steps: readonly TourStep[];
  /** What the tour is, for assistive technology. */
  label: string;
  /** The offer's sentence: what the tour will show. */
  offer: string;
}) {
  const tour = usePageTour(id);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), OFFER_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {tour.offer && settled && <TourOffer body={offer} onStart={tour.start} onDecline={tour.decline} />}
      {tour.open && <Tour steps={steps} step={tour.step} onStep={tour.setStep} onClose={tour.close} label={label} />}
    </>
  );
}
