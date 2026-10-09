'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-EA2517F94651 */

/**
 * A guided tour's overlay: the page dimmed round the element a step is about,
 * and a card beside it saying what the element is and what to do with it,
 * with Back, Next and Skip.
 *
 * The element is found by a selector - pages mark what a tour points at with
 * `data-tour` - and followed every frame while the tour is open, because the
 * panels it points at slide in, grow and move with the window. A step whose
 * element is not on screen is shown in the middle, over the whole page,
 * rather than pointing at nothing.
 *
 * Modal while open: the page under it does not take clicks, Tab stays in the
 * card, Escape skips, the arrow keys step. Focus goes back where it was when
 * it closes.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  /** A selector for what the step is about; null for the whole screen. */
  readonly target: string | null;
  readonly title: string;
  readonly body: ReactNode;
  /** Where the card goes if there is room; otherwise the opposite side, then any side. */
  readonly placement?: Side;
}

type Side = 'top' | 'bottom' | 'left' | 'right';
type Placement = Side | 'center';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Layout {
  spot: Rect | null;
  radius: number;
  card: { top: number; left: number };
  placement: Placement;
  /** The arrow's offset along the card's edge that faces the element. */
  arrow: number;
}

/** Card to spotlight, card to the window's edge, and spotlight round the element, px. */
const GAP = 14;
const MARGIN = 12;
const PAD = 6;

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function measure(selector: string | null): { rect: Rect; radius: number } | null {
  if (!selector) return null;
  const element = document.querySelector(selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return {
    rect: { top: box.top - PAD, left: box.left - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD },
    radius: Math.min(radius + PAD, 24),
  };
}

function layoutFor(spot: Rect | null, radius: number, card: { width: number; height: number }, preferred: Side): Layout {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const centred: Layout = {
    spot,
    radius,
    card: { top: Math.max(MARGIN, (height - card.height) / 2), left: Math.max(MARGIN, (width - card.width) / 2) },
    placement: 'center',
    arrow: 0,
  };
  if (!spot) return centred;
  const sides: Side[] = [preferred, OPPOSITE[preferred], ...(['bottom', 'top', 'right', 'left'] as Side[])];
  for (const side of sides) {
    let top: number;
    let left: number;
    if (side === 'bottom' || side === 'top') {
      top = side === 'bottom' ? spot.top + spot.height + GAP : spot.top - GAP - card.height;
      if (top < MARGIN || top + card.height > height - MARGIN) continue;
      left = clamp(spot.left + spot.width / 2 - card.width / 2, MARGIN, width - card.width - MARGIN);
      const arrow = clamp(spot.left + spot.width / 2 - left - 6, 20, card.width - 32);
      return { spot, radius, card: { top, left }, placement: side, arrow };
    }
    left = side === 'right' ? spot.left + spot.width + GAP : spot.left - GAP - card.width;
    if (left < MARGIN || left + card.width > width - MARGIN) continue;
    top = clamp(spot.top + spot.height / 2 - card.height / 2, MARGIN, height - card.height - MARGIN);
    const arrow = clamp(spot.top + spot.height / 2 - top - 6, 20, card.height - 32);
    return { spot, radius, card: { top, left }, placement: side, arrow };
  }
  // Nowhere beside it has room - an element as big as the page: the card in
  // the middle, over it.
  return centred;
}

function sameLayout(a: Layout | null, b: Layout): boolean {
  if (!a) return false;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.5;
  const spots = !a.spot || !b.spot
    ? a.spot === b.spot
    : near(a.spot.top, b.spot.top) && near(a.spot.left, b.spot.left) && near(a.spot.width, b.spot.width) && near(a.spot.height, b.spot.height);
  return spots && a.placement === b.placement && near(a.card.top, b.card.top) && near(a.card.left, b.card.left) && near(a.arrow, b.arrow);
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Brings an element into view inside the panel that scrolls it - never by
 * scrolling the document: the app is one screen tall, and a scrolled document
 * pushed the top bar off it. Centred when it fits, its top shown when not.
 */
function reveal(element: Element): void {
  let scroller = element.parentElement;
  while (scroller && scroller !== document.body) {
    const overflow = getComputedStyle(scroller).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === document.body) return;
  const box = element.getBoundingClientRect();
  const frame = scroller.getBoundingClientRect();
  if (box.top >= frame.top && box.bottom <= frame.bottom) return;
  const by = box.height > frame.height - 16 ? box.top - frame.top - 8 : box.top - frame.top - (frame.height - box.height) / 2;
  scroller.scrollBy({ top: by, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

export function Tour({
  steps,
  step,
  onStep,
  onClose,
  finishLabel = 'Done',
  label,
}: {
  steps: readonly TourStep[];
  step: number;
  onStep: (step: number) => void;
  /** `finished`: the last step's button, not Skip or Escape. */
  onClose: (finished: boolean) => void;
  /** The last step's button. */
  finishLabel?: string;
  /** What the tour is, for assistive technology. */
  label: string;
}) {
  const current = steps[Math.min(step, steps.length - 1)]!;
  const last = step >= steps.length - 1;
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  // Placed from the first frame - at the card's usual size until it is
  // measured - so it does not fly in from somewhere else.
  const [layout, setLayout] = useState<Layout | null>(() => {
    if (typeof window === 'undefined') return null;
    const found = measure(current.target);
    const size = { width: Math.min(352, window.innerWidth - 24), height: 210 };
    return layoutFor(found?.rect ?? null, found?.radius ?? 16, size, current.placement ?? 'bottom');
  });

  // Follow the element every frame: the panels a tour points at slide in,
  // grow and move with the window.
  useEffect(() => {
    const element = current.target ? document.querySelector(current.target) : null;
    if (element) reveal(element);
    let previous: Layout | null = null;
    let frame = 0;
    const tick = () => {
      const found = measure(current.target);
      const card = cardRef.current;
      const size = { width: card?.offsetWidth ?? 352, height: card?.offsetHeight ?? 200 };
      const next = layoutFor(found?.rect ?? null, found?.radius ?? 16, size, current.placement ?? 'bottom');
      if (!sameLayout(previous, next)) {
        previous = next;
        setLayout(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [current]);

  // Each step's own button has the focus; the keys step through.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [step]);

  const latest = useRef({ step, last, onStep, onClose });
  useEffect(() => {
    latest.current = { step, last, onStep, onClose };
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      const { step: at, last: end, onStep: go, onClose: close } = latest.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (end) close(true);
        else go(at + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (at > 0) go(at - 1);
      } else if (event.key === 'Tab') {
        // Keep Tab inside the card.
        const card = cardRef.current;
        if (!card) return;
        const focusable = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const lastButton = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          lastButton.focus();
        } else if (!event.shiftKey && document.activeElement === lastButton) {
          event.preventDefault();
          first.focus();
        } else if (!card.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  if (typeof document === 'undefined') return null;

  const spot = layout?.spot ?? null;
  const spotStyle: CSSProperties = spot
    ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height, borderRadius: layout?.radius ?? 16 }
    : { top: '50%', left: '50%', width: 0, height: 0 };
  const placement = layout?.placement ?? 'center';
  const cardStyle: CSSProperties = layout ? { top: layout.card.top, left: layout.card.left } : { visibility: 'hidden' };
  const arrowStyle: CSSProperties =
    placement === 'top' || placement === 'bottom' ? { left: layout?.arrow ?? 0 } : { top: layout?.arrow ?? 0 };

  return createPortal(
    <div className="tour-root" role="dialog" aria-modal="true" aria-label={label} aria-describedby="tour-step-body">
      <div className="tour-spotlight" data-empty={!spot} style={spotStyle} aria-hidden />
      <div ref={cardRef} className="tour-card" data-placement={placement} style={cardStyle}>
        <span className="tour-arrow" style={arrowStyle} aria-hidden />
        <div className="tour-head">
          <span className="tour-count">
            Step {step + 1} of {steps.length}
          </span>
          {!last && (
            <button type="button" className="tour-skip" onClick={() => onClose(false)}>
              Skip tour
            </button>
          )}
        </div>
        <div key={step} className="tour-text" aria-live="polite">
          <h2 className="tour-title">{current.title}</h2>
          <p id="tour-step-body" className="tour-body">
            {current.body}
          </p>
        </div>
        <div className="tour-foot">
          <div className="tour-dots" aria-hidden>
            {steps.map((entry, index) => (
              <span
                key={entry.title}
                className="tour-dot"
                data-state={index < step ? 'done' : index === step ? 'now' : 'next'}
              />
            ))}
          </div>
          <div className="tour-actions">
            {step > 0 && (
              <button type="button" className="control" onClick={() => onStep(step - 1)}>
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="control control-primary"
              onClick={() => (last ? onClose(true) : onStep(step + 1))}
            >
              {last ? finishLabel : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
