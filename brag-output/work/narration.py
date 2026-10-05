"""Voiceover for the CONTINUA story film: Kokoro (af_heart) via `hyperframes tts`.

Each line owns a window on the film's timeline (film seconds, from the edit in
../brag-plan.md). A line is synthesised at natural speed first and sped up only
as far as 1.14x if it overruns its window; past that the build fails and names
the line - the fix is fewer words, not a faster voice. The script is checked
against the project's banned phrases (scripts/check-claims.mjs) before any audio
is made.

Writes vo/<id>.wav, voice.wav (48 kHz stereo, placed on the timeline),
vo-timings.json and story.vtt (captions for the voice).
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt

FPS = 30
DUR = 1784 / FPS
SR = 48000
VOICE = 'af_heart'
SPEEDS = [1.0, 1.05, 1.1, 1.14]
HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.environ.get('HYPERFRAMES_PYTHON', r'C:\Users\awaiz\.kokoro-venv\Scripts\python.exe')

# id, start (s), end of window (s), text
LINES = [
    ('n1a', 0.35, 1.8, "The network changes."),
    ('n1b', 1.9, 3.35, "The session doesn't."),
    ('n1c', 3.35, 5.4, "Here's CONTINUA in simulation."),
    ('n2', 5.95, 13.95, "Leaving the dock, CONTINUA slides from cable to Wi-Fi without a gap. The rover beside it isn't so lucky."),
    ('n3', 14.45, 21.45, "The other rover has no CONTINUA. Same road, same signal. It only switches after its network fails."),
    ('n4', 21.95, 28.35, "CONTINUA's road map shows where coverage drops. Seventy-nine metres out, it starts warming up satellite."),
    ('n5', 28.85, 35.5, "In the cutting, CONTINUA is already on satellite. The other rover loses its link, and has to stop."),
    ('n6', 35.95, 41.5, "One operator kept the link. The other was cut off for four and a half seconds."),
    ('n7', 41.95, 54.25, "One run could be luck, so every strategy drove this road twenty times. With its road map, CONTINUA kept the link every time, at about a third of the cost of keeping every network on."),
    ('n8', 54.85, 59.2, "CONTINUA. Predictive network continuity, by Team Kanban."),
]

BANNED = [
    r'99\.9+\s*%', r'\bzero\s+(loss|downtime|interruption|outage)\b', r'\bno\s+(interruption|downtime|outage)\b',
    r'\bworks?\s+(everywhere|anywhere)\b', r'\bguarantee(s|d)?\b', r'\b(live|real)\s+satellite\b', r'\bfield\s+(test|trial)\b',
    r'\b5G\b', r'\bMPTCP\b', r'\bproduction[- ]ready\b', r'\benterprise[- ]grade\b', r'\bbattle[- ]tested\b',
    r'\bsecure by design\b', r'\bAI\s+(decides|routes|chooses|controls)\b', r'\b(real[- ]time|live)\s+network\b',
    r'\blive\s+test\b', r'\bstate[- ]of[- ]the[- ]art\b', r'\bbest[- ]in[- ]class\b', r'\bindustry[- ]standard\b',
]
for _id, _s, _e, text in LINES:
    for pattern in BANNED:
        if re.search(pattern, text, re.I):
            sys.exit(f'banned phrase {pattern!r} in {_id}: {text}')


def synth(text, speed, path):
    env = dict(os.environ, HYPERFRAMES_PYTHON=PY)
    out = subprocess.run(
        ['npx', '--yes', 'hyperframes', 'tts', text, '--voice', VOICE, '--speed', str(speed), '--output', path, '--json'],
        capture_output=True, text=True, env=env, shell=os.name == 'nt',
    )
    if '"ok":true' not in out.stdout:
        sys.exit(f'tts failed for {path}: {out.stdout} {out.stderr}')


def trimmed(path):
    """Load a clip, cut its leading and trailing silence, resample to 48 kHz."""
    data, rate = sf.read(path, dtype='float64')
    if data.ndim > 1:
        data = data.mean(axis=1)
    level = np.abs(data)
    floor = level.max() * 10 ** (-40 / 20)
    voiced = np.nonzero(level > floor)[0]
    a = max(0, voiced[0] - int(0.03 * rate))
    b = min(len(data), voiced[-1] + int(0.08 * rate))
    clip = data[a:b]
    return resample_poly(clip, SR // 1000 * 2, rate // 1000 * 2) if rate != SR else clip


os.makedirs(os.path.join(HERE, 'vo'), exist_ok=True)
track = np.zeros(int(round(DUR * SR)))
timings = []
for line_id, start, end, text in LINES:
    window = end - start - 0.05
    for speed in SPEEDS:
        path = os.path.join(HERE, 'vo', f'{line_id}.wav')
        synth(text, speed, path)
        clip = trimmed(path)
        length = len(clip) / SR
        if length <= window:
            break
    else:
        sys.exit(f'{line_id} is {length:.2f} s at {speed}x but its window is {window:.2f} s: shorten "{text}"')
    # every line at the same loudness, so no sentence jumps out
    clip = clip / (np.sqrt(np.mean(clip ** 2)) + 1e-9) * 0.1
    i0 = int(round(start * SR))
    track[i0:i0 + len(clip)] += clip[: len(track) - i0]
    words = len(text.split())
    timings.append({'id': line_id, 'start': round(start, 3), 'end': round(start + length, 3), 'window_end': end,
                    'speed': speed, 'words': words, 'wpm': round(words / length * 60), 'text': text})
    print(f'{line_id:4s} {start:6.2f}-{start + length:6.2f} s  window {end:6.2f}  speed {speed:4.2f}  {words / length * 60:4.0f} wpm')

# a little air under the low end, a peak ceiling, and the faintest room
sos = butter(2, 75, 'high', fs=SR, output='sos')
track = sosfilt(sos, track)
peak = np.max(np.abs(track))
track = track / peak * 0.9
stereo = np.vstack([track, track]).T
sf.write(os.path.join(HERE, 'voice.wav'), stereo, SR, subtype='PCM_16')
json.dump({'voice': VOICE, 'engine': 'Kokoro-82M via hyperframes tts', 'lines': timings}, open(os.path.join(HERE, 'vo-timings.json'), 'w'), indent=1)


def stamp(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'


with open(os.path.join(HERE, 'story.vtt'), 'w', encoding='utf-8') as vtt:
    vtt.write('WEBVTT\n\n')
    for i, line in enumerate(timings, 1):
        # held a beat past the voice, but never into the next line
        nxt = timings[i]['start'] - 0.05 if i < len(timings) else DUR
        vtt.write(f"{i}\n{stamp(line['start'])} --> {stamp(min(nxt, line['end'] + 0.35))}\n{line['text']}\n\n")
print('voice.wav, vo-timings.json, story.vtt written')
