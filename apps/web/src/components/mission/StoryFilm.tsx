'use client';

/**
 * The intro: thirty seconds cut from the app itself, replaying the two
 * recorded runs the 3D story tells - the camera's flight to each new link, the
 * cutting, the rover driven by hand - and ending on the stored twenty-drive
 * comparison. Every figure in it, and the run or experiment it comes from, is
 * listed in the brag plan beside its composition (`brag-output-*`).
 *
 * A film is a file, so it plays whether or not an engine or the recordings are
 * reachable. Replaying the story in 3D needs the runs themselves.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { holdScene } from '../sceneHostStore';
import { CloseIcon, ReplayIcon } from '../ui/icons';

export const STORY_FILM = '/video/story.mp4';
export const STORY_POSTER = '/video/story-poster.jpg';
export const STORY_CAPTIONS = '/video/story.vtt';

export function StoryFilm({
  onClose,
  onReplay3D,
  onDrive,
  canReplay3D,
}: {
  onClose: () => void;
  onReplay3D: () => void;
  onDrive: () => void;
  /** The story's two runs can be started (the engine is up, or they were recorded). */
  canReplay3D: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);

  // The world behind the film stands still while it plays.
  useEffect(() => holdScene(), []);

  useEffect(() => {
    // Keyboard focus goes to the player, so Space plays and pauses; it goes
    // back to whatever opened the film when the film closes.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    video.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  const again = () => {
    const player = video.current;
    if (!player) return;
    player.currentTime = 0;
    void player.play();
  };

  return createPortal(
    <div className="story-film-layer">
      <div className="story-film-scrim" onClick={onClose} aria-hidden />
      <section className="story-film glass enter" role="dialog" aria-modal="true" aria-label="The intro, a thirty-second film">
        <div className="story-film-frame">
          <video
            ref={video}
            src={STORY_FILM}
            poster={STORY_POSTER}
            autoPlay
            playsInline
            controls
            preload="auto"
            onEnded={() => setEnded(true)}
            onPlay={() => setEnded(false)}
          >
            {/* The narration as captions; the run's own facts are already on screen. */}
            <track kind="captions" src={STORY_CAPTIONS} srcLang="en" label="English" />
          </video>
          {ended && (
            <div className="story-film-end">
              <button type="button" className="control control-primary h-[42px] px-5 text-[14.5px]" onClick={again}>
                <ReplayIcon size={15} /> Watch again
              </button>
            </div>
          )}
        </div>
        <div className="story-film-bar">
          <p>Thirty seconds of the app replaying two recorded runs - a software simulation. Every figure comes from those runs or the stored experiment.</p>
          <button
            type="button"
            className="control"
            onClick={onReplay3D}
            disabled={!canReplay3D}
            title="Watch the same two runs play out in the 3D scene, at your own pace"
          >
            Replay it in 3D
          </button>
          <button type="button" className="control" onClick={onDrive}>
            Drive it yourself
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close the film" title="Close (Esc)">
            <CloseIcon size={15} />
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
