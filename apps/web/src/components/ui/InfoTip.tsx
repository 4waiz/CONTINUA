/**
 * A small "?" that explains the panel it sits on, in one or two sentences.
 *
 * Shown on hover and on keyboard focus, so it works without a mouse; the text
 * is also the element's accessible name. CSS only - no portal, no state - so
 * it costs nothing until someone asks.
 */

export function InfoTip({
  text,
  side = 'bottom',
  align = 'center',
}: {
  text: string;
  side?: 'bottom' | 'top' | 'left' | 'right';
  /** Above or below: which edge of the bubble lines up with the "?" - for one near a panel's edge. */
  align?: 'center' | 'start' | 'end';
}) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={text} data-side={side} data-align={align}>
      <span aria-hidden>?</span>
      <span className="info-tip-bubble" aria-hidden>
        {text}
      </span>
    </span>
  );
}
