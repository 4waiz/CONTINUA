'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-9C508A586E3A */

/**
 * The page's voice: what changed, said aloud - each change of network and each
 * rover losing or getting back its link while driving, each caption in the
 * story - word for word what the screen says, so a viewer can listen as well
 * as read.
 *
 * The words are the screen's own - nothing is added, dropped or summarised;
 * only the units are said in full ("4.5 s" is read "4.5 seconds"). Two
 * sources, in order:
 *
 * 1. **Recorded lines** (`/voice/index.json`): every sentence the page can
 *    say on its recorded runs, synthesised ahead of time on the development
 *    machine with a voice that ships with Windows (`scripts/build-voice.mjs`,
 *    `docs/AI_USE.md`) - the same voice on every viewer's machine.
 * 2. **The browser's own speech**, for a sentence with no recording - one
 *    whose facts came out differently on this run. Local voices only: a browser's
 *    online voices would send the text to a speech service.
 *
 * One line at a time: a new line waits for the one being read to end - a
 * sentence cut off half-way is worse than one a second late. A caption, which
 * describes what is on screen now, replaces any caption still waiting, and is
 * dropped if the screen has moved past it. An announcement - something that
 * happened - waits for its turn, unless it has waited longer than it is worth
 * (its own `keepMs`), and when several wait the most important goes first: at
 * the cutting, a rover losing its link outranks the road going into it.
 * Skipping a chapter, pausing and leaving act on the voice too.
 */

import { useSyncExternalStore } from 'react';

interface Clip {
  text: string;
  file: string;
}

export interface NarratorState {
  /** The viewer turned the voice off. Remembered on this device. */
  muted: boolean;
  /** The browser refused to play sound without a click on the page first. */
  blocked: boolean;
  /** A line is being read. */
  speaking: boolean;
}

const INDEX_URL = '/voice/index.json';
const STORAGE_KEY = 'continua:voice';
/** An announcement older than this when its turn comes is not said: it is no longer news. */
const MAX_WAIT_MS = 8000;

export interface SayOptions {
  /**
   * 'caption' (the default) describes the screen now: it replaces whatever is
   * waiting. 'announcement' reports an event: it waits its turn.
   */
  kind?: 'caption' | 'announcement';
  /** An announcement this one makes moot if it is still waiting: both are dropped. */
  cancels?: string;
  /** Among announcements waiting together, the higher is said first. */
  priority?: number;
  /** How long an announcement stays worth saying while it waits, ms. */
  keepMs?: number;
}

interface Waiting {
  text: string;
  at: number;
  kind: 'caption' | 'announcement';
  priority: number;
  keepMs: number;
}

/** Units as they are said, not as they are written: "4.5 s" is "4.5 seconds". */
export function spoken(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s?s\b/g, (_, value: string) => `${value} ${value === '1' ? 'second' : 'seconds'}`)
    .replace(/(\d+(?:\.\d+)?)\s?m\b/g, (_, value: string) => `${value} ${value === '1' ? 'metre' : 'metres'}`)
    .replace(/(\d+(?:\.\d+)?)×/g, '$1 times');
}

/** A local English voice, the recordings' own (Mark) first. Null rather than an online one. */
function localVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService && /^en([-_]|$)/i.test(voice.lang));
  const rank = (voice: SpeechSynthesisVoice) =>
    /\bMark\b/i.test(voice.name) ? 0 : /natural|neural/i.test(voice.name) ? 1 : /^en[-_](US|GB)/i.test(voice.lang) ? 2 : 3;
  return voices.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function storedMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

const SERVER_STATE: NarratorState = { muted: false, blocked: false, speaking: false };

class Narrator {
  private clips: Map<string, string> | null = null;
  private loading: Promise<void> | null = null;
  private audio: HTMLAudioElement | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  /** Lines waiting for the current one to end, oldest first. */
  private waiting: Waiting[] = [];
  /** The newest line asked for: what unmuting or unblocking reads. */
  private last: string | null = null;
  /** What the page shows now; a waiting line that no longer matches it is dropped. */
  private screen: string | null = null;
  private busy = false;
  private paused = false;
  /** Which `play` is current: a stop, or a newer line, retires the one before. */
  private token = 0;
  private state: NarratorState = SERVER_STATE;
  private initialised = false;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): NarratorState => {
    if (!this.initialised && typeof window !== 'undefined') {
      this.initialised = true;
      this.state = { ...this.state, muted: storedMuted() };
      // Some browsers list their voices only once asked.
      window.speechSynthesis?.getVoices();
    }
    return this.state;
  };

  private update(patch: Partial<NarratorState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private load(): Promise<void> {
    this.loading ??= fetch(INDEX_URL, { cache: 'force-cache' })
      .then((response) => (response.ok ? (response.json() as Promise<{ lines?: Clip[] }>) : { lines: [] }))
      .then((index) => {
        this.clips = new Map((index.lines ?? []).map((clip) => [clip.text, `/voice/${clip.file}`]));
      })
      .catch(() => {
        this.clips = new Map();
      });
    return this.loading;
  }

  /** The text the page is showing now - before it settles, and null when it shows none. */
  showing(text: string | null) {
    this.screen = text;
  }

  /** Read this line: now if nothing is being read, else when its turn comes. */
  say(text: string, options: SayOptions = {}) {
    this.getSnapshot();
    // A harness that wants the lines (scripts/voice-lines-story.mjs) sets this
    // array up before the page loads; nothing else reads it.
    (window as unknown as { __CONTINUA_VOICE_LOG__?: string[] }).__CONTINUA_VOICE_LOG__?.push(text);
    this.last = text;
    if (this.state.muted) return;
    const kind = options.kind ?? 'caption';
    if (options.cancels) {
      const index = this.waiting.findIndex((line) => line.text === options.cancels);
      if (index >= 0) {
        // A loss that was over before it could be said: say neither.
        this.waiting.splice(index, 1);
        return;
      }
    }
    if (!this.busy) {
      void this.play(text);
      return;
    }
    if (kind === 'caption') this.waiting = this.waiting.filter((line) => line.kind !== 'caption');
    if (this.waiting.some((line) => line.text === text)) return;
    this.waiting.push({
      text,
      at: performance.now(),
      kind,
      priority: options.priority ?? 0,
      keepMs: options.keepMs ?? MAX_WAIT_MS,
    });
  }

  private async play(text: string) {
    const token = ++this.token;
    this.busy = true;
    this.update({ speaking: true });
    await this.load();
    if (token !== this.token) return; // stopped, or overtaken, while the index loaded
    const url = this.clips?.get(text);
    if (!url) {
      this.speak(text);
      return;
    }
    const audio = new Audio(url);
    this.audio = audio;
    audio.onended = () => this.finished(audio);
    audio.onerror = () => {
      if (this.audio !== audio) return;
      this.audio = null;
      this.speak(text);
    };
    try {
      await audio.play();
      if (this.state.blocked) this.update({ blocked: false });
      if (this.paused) audio.pause();
    } catch (error) {
      if (this.audio !== audio) return;
      this.audio = null;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        // No click on the page yet: wait for one (the bar offers it).
        this.busy = false;
        this.waiting = [];
        this.update({ blocked: true, speaking: false });
        return;
      }
      this.speak(text);
    }
  }

  private speak(text: string) {
    const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
    const voice = synth ? localVoice() : null;
    if (!synth || !voice) {
      // Silence rather than an online voice; the caption is still on screen.
      this.finished(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spoken(text));
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onend = () => this.finished(utterance);
    utterance.onerror = () => this.finished(utterance);
    this.utterance = utterance;
    synth.speak(utterance);
    if (this.paused) synth.pause();
  }

  private finished(source: HTMLAudioElement | SpeechSynthesisUtterance | null) {
    if (source !== null && source !== this.audio && source !== this.utterance) return; // a line already stopped
    this.audio = null;
    this.utterance = null;
    this.busy = false;
    // The next line still worth saying - an announcement that has not waited
    // longer than it is worth, a caption the page still shows - the most
    // important first, and of those the oldest.
    const now = performance.now();
    this.waiting = this.waiting.filter((line) =>
      line.kind === 'announcement' ? now - line.at < line.keepMs : this.screen === null || line.text === this.screen,
    );
    if (this.waiting.length > 0 && !this.state.muted) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i += 1) {
        if (this.waiting[i]!.priority > this.waiting[best]!.priority) best = i;
      }
      const [next] = this.waiting.splice(best, 1);
      void this.play(next!.text);
      return;
    }
    this.update({ speaking: false });
  }

  /** Silence now, and forget what was waiting. */
  stop() {
    this.token += 1;
    this.waiting = [];
    this.busy = false;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance = null;
      window.speechSynthesis?.cancel();
    }
    if (this.state.speaking) this.update({ speaking: false });
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.audio?.pause();
    if (this.utterance) window.speechSynthesis?.pause();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    void this.audio?.play().catch(() => undefined);
    if (this.utterance) window.speechSynthesis?.resume();
  }

  setMuted(muted: boolean) {
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on');
    } catch {
      // Remembering the choice is a convenience; the choice still applies.
    }
    this.update({ muted, blocked: false });
    if (muted) this.stop();
    else if (this.last) this.say(this.last);
  }

  /** The browser blocked the sound; this click is the gesture it wanted. */
  unblock() {
    this.update({ blocked: false });
    if (this.last) this.say(this.last);
  }
}

/** One voice for the page. */
export const narrator = new Narrator();

export function useNarrator(): NarratorState {
  return useSyncExternalStore(narrator.subscribe, narrator.getSnapshot, () => SERVER_STATE);
}
