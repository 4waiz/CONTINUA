'use client';

/**
 * Take the mission view full screen.
 *
 * The 3D world is the point of this page, and on a projector or a second
 * monitor an operator wants it without the chrome around it. This asks the
 * browser to make one element fullscreen rather than faking it with fixed
 * positioning, so the OS handles the transition and Escape works the way people
 * expect.
 *
 * The scene resizes itself: react-three-fiber observes its container, so the
 * canvas follows the element into fullscreen without anything here telling it
 * to.
 *
 * Two notes on the hooks. Support is read through `useSyncExternalStore` rather
 * than set from an effect, because it is an external fact that never changes
 * during a session, not state this component owns. And `toggle` is a plain
 * function: wrapping it in `useCallback` while reading `target.current` gave the
 * React Compiler a dependency it could not verify, and the compiler memoizes it
 * anyway.
 */

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/** Nothing to subscribe to: whether the API exists is fixed for the session. */
const subscribeNever = () => () => {};
const isSupported = () => typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
/** Assume supported on the server; the client corrects it on hydration. */
const supportedOnServer = () => true;

export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const supported = useSyncExternalStore(subscribeNever, isSupported, supportedOnServer);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement === target.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [target]);

  if (!supported) return null;

  const toggle = () => {
    const element = target.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void element.requestFullscreen?.();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="pointer-events-auto rounded-[10px] border border-[color:var(--color-line)] bg-white/90 p-2 backdrop-blur transition hover:border-[color:var(--color-line-strong)] hover:bg-white"
      title={active ? 'Exit full screen (Esc)' : 'Full screen'}
      aria-label={active ? 'Exit full screen' : 'Full screen'}
      aria-pressed={active}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        {active ? (
          // Arrows pointing in.
          <path
            d="M6.5 1.5v3a2 2 0 0 1-2 2h-3M9.5 1.5v3a2 2 0 0 0 2 2h3M6.5 14.5v-3a2 2 0 0 0-2-2h-3M9.5 14.5v-3a2 2 0 0 1 2-2h3"
            stroke="var(--color-ink)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        ) : (
          // Arrows pointing out.
          <path
            d="M1.5 5.5v-2a2 2 0 0 1 2-2h2M14.5 5.5v-2a2 2 0 0 0-2-2h-2M1.5 10.5v2a2 2 0 0 0 2 2h2M14.5 10.5v2a2 2 0 0 1-2 2h-2"
            stroke="var(--color-ink)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
