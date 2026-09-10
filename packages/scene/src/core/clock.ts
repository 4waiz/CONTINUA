import type { PlaybackState, Seconds } from '@continua/contracts';

/**
 * The scene's single source of time.
 *
 * `setTime(t)` fully determines the frame. Nothing in the scene reads
 * `Date.now()` or `performance.now()` for state - real time only ever advances
 * the clock, and `advance(dt)` can be replaced by fixed steps for capture.
 *
 * Subscribers are notified on transport changes (play/pause/seek/speed), not on
 * every tick, so React never re-renders per frame. Per-frame consumers read
 * `clock.time` directly inside `useFrame`.
 */
export class SceneClock {
  private _time: Seconds = 0;
  private _playing = false;
  private _speed = 1;
  private _duration: Seconds;
  private _loop: boolean;
  private readonly listeners = new Set<(state: PlaybackState) => void>();

  constructor(duration: Seconds, options: { loop?: boolean } = {}) {
    this._duration = Math.max(0.001, duration);
    this._loop = options.loop ?? true;
  }

  get time(): Seconds {
    return this._time;
  }

  get duration(): Seconds {
    return this._duration;
  }

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  /** Normalised progress through the run, 0..1. */
  get progress(): number {
    return this._time / this._duration;
  }

  get state(): PlaybackState {
    return { playing: this._playing, simTime: this._time, speed: this._speed };
  }

  /** Seek. The only way scene state ever changes. */
  setTime(time: Seconds, notify = true): void {
    const clamped = this._loop
      ? ((time % this._duration) + this._duration) % this._duration
      : Math.min(Math.max(time, 0), this._duration);
    if (clamped === this._time) return;
    this._time = clamped;
    if (notify) this.emit();
  }

  setProgress(progress: number, notify = true): void {
    this.setTime(progress * this._duration, notify);
  }

  /**
   * Advance by a real-time delta. Called once per animation frame.
   * Deliberately does not notify: seeking every frame would defeat the point.
   */
  advance(deltaSeconds: number): void {
    if (!this._playing) return;
    const step = Math.min(deltaSeconds, 0.25) * this._speed; // clamp tab-switch jumps
    this.setTime(this._time + step, false);
    if (!this._loop && this._time >= this._duration) {
      this._playing = false;
      this.emit();
    }
  }

  play(): void {
    if (this._playing) return;
    this._playing = true;
    this.emit();
  }

  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    this.emit();
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  reset(): void {
    this._time = 0;
    this._playing = false;
    this.emit();
  }

  setSpeed(speed: number): void {
    const next = Math.min(Math.max(speed, 0.1), 8);
    if (next === this._speed) return;
    this._speed = next;
    this.emit();
  }

  setDuration(duration: Seconds): void {
    this._duration = Math.max(0.001, duration);
    if (this._time > this._duration) this._time = this._duration;
    this.emit();
  }

  subscribe(listener: (state: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Force a notification - used after a scrub finishes. */
  emit(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) listener(snapshot);
  }
}
