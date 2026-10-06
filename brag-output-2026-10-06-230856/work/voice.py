"""The narrator for the intro and the walkthrough.

    python voice.py intro [--engine chatterbox|kokoro]         lines i1..i6, each fitted to its window on the film
    python voice.py walkthrough [--engine chatterbox|kokoro]   lines w01..w13, back to back with breaths between

Two local engines, both running on this machine. `chatterbox` (the default) is
Resemble AI's Chatterbox, an expressive model, speaking in a voice cloned from
a Kokoro `am_michael` reference clip this script makes - a synthetic voice, not
a real person's. It samples, so voice_cb.py transcribes every take and keeps
only one that says exactly the script. `kokoro` is Kokoro-82M `am_michael`
through `hyperframes tts`, flatter but fully deterministic.

Every line is checked against the project's banned phrases before any audio is
made. A line that overruns its window is sped up only as far as 1.12x (Kokoro
re-synthesises faster; a Chatterbox take is time-stretched, pitch kept); past
that the build fails and names the line - the fix is fewer words. Leading and
trailing silence is cut, every line is set to the same loudness, and each is
written as its own WAV (24 kHz mono) so the composition can place it as a
clip. Timings go to <set>-timings.json.
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.environ.get('HYPERFRAMES_PYTHON', r'C:\Users\awaiz\.kokoro-venv\Scripts\python.exe')
CB_PY = os.environ.get('CHATTERBOX_PYTHON', r'C:\Users\awaiz\.chatterbox-venv\Scripts\python.exe')
VOICE = 'am_michael'
SPEEDS = [1.0, 1.04, 1.08, 1.12]
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else 'chatterbox'
# --only w06,w10: make just these lines again and keep every other line as it is.
ONLY = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else set()
# --reuse: the worker's takes (<id>.raw.wav) are already on disk; fit and finish them only.
REUSE = '--reuse' in sys.argv
# Chatterbox: how much feeling (0.5 is its neutral), how closely it keeps to
# the reference's pace (lower is slower and more deliberate), and what the
# reference clip says.
CB_EXAGGERATION = 0.5
CB_CFG = 0.5
CB_REF_TEXT = ("Welcome back. Today we're taking a closer look at how a rover keeps its connection "
               "while it drives from one network to the next, and why that matters.")

INTRO = [
    # id, start (s), end of window (s), text
    ('i1', 0.30, 3.45, "The network changes. The session doesn't."),
    ('i2', 3.80, 10.20, "At every handoff, the camera flies to where the new link comes from, then rides it home."),
    ('i3', 10.60, 17.60, "Its road map spots the dead zone early, and warms up satellite in time. The normal rover? Cut off."),
    ('i4', 18.10, 21.85, "And now, you can take the wheel. W, A, S, D."),
    # From 22.00: the one take that says "CONTINUA kept" clearly - not "continue will keep" - is 4.6 s.
    ('i5', 22.00, 26.40, "Twenty drives each. CONTINUA kept the link, every time."),
    ('i6', 26.50, 29.30, "CONTINUA. By Team Kanban."),
]

WALKTHROUGH = [
    # id, scene the capture shows while it is said, text
    ('w01', 'landing', "This is CONTINUA. The network changes. The session doesn't."),
    ('w02', 'start', "Two rescue rovers, one island road, four networks. One runs CONTINUA. The other waits for its network to break."),
    ('w03', 'flight', "Watch a handoff. The camera flies out to the access point the new link comes from, then rides the beam back to the rover."),
    ('w04', 'slow', "Let's slow it down, and switch on coverage, to see where every network reaches."),
    ('w05', 'warning', "Now the clever part. CONTINUA carries a road map from earlier drives. Seventy-nine metres before the cutting, it starts satellite, before Wi-Fi and cellular drop out together."),
    # Not "CONTINUA stays": said aloud, the two words run together as "continuous stays".
    ('w06', 'cutting', "Satellite was already up, so CONTINUA keeps the link. The normal rover is cut off, and has to stop."),
    ('w07', 'wheel', "Your turn. Press W, and you're driving. A and D steer, S brakes, and the road keeps you on it."),
    ('w08', 'driving', "Every network and handoff you see is the recorded run at your exact point on the road. Drive on, it plays forward. Back up, it plays back."),
    ('w09', 'details', "Escape hands it back to autopilot. Details opens every measurement, down to each kind of traffic."),
    ('w10', 'results', "The results: every strategy, the same road, twenty drives each. CONTINUA kept the link every time, at about a third of the cost of keeping every network on."),
    ('w11', 'decisions', "The decision log shows every choice the controller made, and why."),
    ('w12', 'brief', "The brief page maps each of the challenge's success criteria to its evidence, including where prediction didn't pay."),
    ('w13', 'credits', "CONTINUA, by Team Kanban. The network changes. The session doesn't."),
]
# Seconds of air before each walkthrough line (after the one before ends), and after the last.
WALK_GAP = {'w01': 1.2, 'w02': 1.4, 'w03': 1.0, 'w04': 0.9, 'w05': 0.9, 'w06': 0.8, 'w07': 1.0,
            'w08': 0.8, 'w09': 1.0, 'w10': 1.0, 'w11': 0.9, 'w12': 0.9, 'w13': 1.0}
WALK_TAIL = 2.4

BANNED = [
    r'99\.9+\s*%', r'\bzero\s+(loss|downtime|interruption|outage)\b', r'\bno\s+(interruption|downtime|outage)\b',
    r'\bwithout (a|any) (gap|drop|interruption)\b', r'\bworks?\s+(everywhere|anywhere)\b', r'\bguarantee(s|d)?\b',
    r'\b(live|real)\s+satellite\b', r'\bfield\s+(test|trial)\b', r'\b5G\b', r'\bMPTCP\b', r'\bproduction[- ]ready\b',
    r'\benterprise[- ]grade\b', r'\bbattle[- ]tested\b', r'\bAI\s+(decides|routes|chooses|controls)\b',
    r'\b(real[- ]time|live)\s+network\b', r'\blive\s+test\b', r'\bstate[- ]of[- ]the[- ]art\b', r'\bbest[- ]in[- ]class\b',
]


def check(lines):
    for line in lines:
        text = line[-1]
        for pattern in BANNED:
            if re.search(pattern, text, re.I):
                sys.exit(f'banned phrase {pattern!r} in {line[0]}: {text}')


def synth(text, speed, path):
    env = dict(os.environ, HYPERFRAMES_PYTHON=PY)
    out = subprocess.run(
        ['npx', '--yes', 'hyperframes', 'tts', text, '--voice', VOICE, '--speed', str(speed), '--output', path, '--json'],
        capture_output=True, text=True, env=env, shell=os.name == 'nt',
    )
    if '"ok":true' not in out.stdout:
        sys.exit(f'tts failed for {path}: {out.stdout} {out.stderr}')


def reference():
    """The voice Chatterbox clones: Kokoro am_michael reading one neutral sentence."""
    path = os.path.join(HERE, 'vo', 'ref-am_michael.wav')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        synth(CB_REF_TEXT, 1.0, path)
    return path


def chatterbox(lines, fitted, out_dir):
    """Lines through the Chatterbox worker in one process: <id>.raw.wav each.
    With --only, just those lines, from a fresh run of seeds."""
    job = {
        'ref': reference(), 'exaggeration': CB_EXAGGERATION, 'cfg': CB_CFG, 'out': out_dir,
        'lines': [{
            'id': line[0], 'text': line[-1],
            # Said as a word, not spelt out: the model reads capitals letter by letter.
            'speak': line[-1].replace('CONTINUA', 'Continua'),
            'limit': round(line[2] - line[1] - 0.05, 3) if fitted else None,
            'seed': (5000 if ONLY else 1000) + i,
        } for i, line in enumerate(lines) if not ONLY or line[0] in ONLY],
    }
    path = os.path.join(out_dir, 'job.json')
    json.dump(job, open(path, 'w', encoding='utf-8'), indent=1)
    subprocess.run([CB_PY, os.path.join(HERE, 'voice_cb.py'), path], check=True)


def tempo(path, factor):
    """Play a clip `factor` times faster, its pitch kept."""
    out = path + '.tempo.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-filter:a', f'atempo={factor:.4f}', out], check=True)
    os.replace(out, path)


def trimmed(path):
    """A clip with its leading and trailing silence cut, mono float."""
    data, rate = sf.read(path, dtype='float64')
    if data.ndim > 1:
        data = data.mean(axis=1)
    level = np.abs(data)
    floor = level.max() * 10 ** (-42 / 20)
    voiced = np.nonzero(level > floor)[0]
    a = max(0, voiced[0] - int(0.025 * rate))
    b = min(len(data), voiced[-1] + int(0.09 * rate))
    return data[a:b], rate


def finish(clip):
    # Every line at one loudness, so no sentence jumps out; a short fade at each end.
    clip = clip / (np.sqrt(np.mean(clip ** 2)) + 1e-9) * 0.085
    peak = np.max(np.abs(clip))
    if peak > 0.89:
        clip = clip * (0.89 / peak)
    n = min(len(clip) // 4, 240)
    ramp = np.linspace(0, 1, n)
    clip[:n] *= ramp
    clip[-n:] *= ramp[::-1]
    return clip


def build(name, lines, fitted):
    out_dir = os.path.join(HERE, 'vo', name)
    os.makedirs(out_dir, exist_ok=True)
    if ENGINE == 'chatterbox' and not REUSE:
        chatterbox(lines, fitted, out_dir)
    timings = []
    cursor = 0.0
    kept = {}
    if ONLY:
        kept = {entry['id']: entry for entry in json.load(open(os.path.join(HERE, f'{name}-timings.json')))['lines']}
    for line in lines:
        line_id, text = line[0], line[-1]
        window = (line[2] - line[1] - 0.05) if fitted else None
        raw = os.path.join(out_dir, f'{line_id}.raw.wav')
        if ONLY and line_id not in ONLY:
            # Kept as it was: its clip is already finished on disk.
            length, speed = kept[line_id]['seconds'], kept[line_id]['speed']
        elif ENGINE == 'chatterbox':
            clip, rate = trimmed(raw)
            length = len(clip) / rate
            speed = 1.0
            if window is not None and length > window:
                speed = length / window
                if speed > SPEEDS[-1]:
                    sys.exit(f'{line_id} is {length:.2f} s but its window is {window:.2f} s: shorten "{text}"')
                tempo(raw, speed)
                clip, rate = trimmed(raw)
                length = len(clip) / rate
        else:
            for speed in SPEEDS:
                synth(text, speed, raw)
                clip, rate = trimmed(raw)
                length = len(clip) / rate
                if window is None or length <= window:
                    break
            else:
                sys.exit(f'{line_id} is {length:.2f} s at {speed}x but its window is {window:.2f} s: shorten "{text}"')
        if not ONLY or line_id in ONLY:
            os.remove(raw)
            sf.write(os.path.join(out_dir, f'{line_id}.wav'), finish(clip), rate, subtype='PCM_16')
        if fitted:
            start = line[1]
        else:
            cursor += WALK_GAP[line_id]
            start = cursor
            cursor += length
        words = len(text.split())
        entry = {'id': line_id, 'start': round(start, 3), 'end': round(start + length, 3), 'seconds': round(length, 3),
                 'speed': round(speed, 3), 'wpm': round(words / length * 60), 'text': text}
        if fitted:
            entry['window_end'] = line[2]
        else:
            entry['scene'] = line[1]
        timings.append(entry)
        print(f'{line_id:4s} {start:6.2f}-{start + length:6.2f} s  speed {speed:4.2f}  {words / length * 60:4.0f} wpm  {text[:60]}')
    total = timings[-1]['end'] + (WALK_TAIL if not fitted else 0)
    engine = ('Chatterbox (Resemble AI), local, voice cloned from a Kokoro am_michael clip' if ENGINE == 'chatterbox'
              else 'Kokoro-82M via hyperframes tts')
    json.dump({'voice': VOICE, 'engine': engine, 'total': round(total, 3), 'lines': timings},
              open(os.path.join(HERE, f'{name}-timings.json'), 'w'), indent=1)
    print(f'{name}: {len(timings)} lines, {total:.2f} s')


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'intro'
    if which == 'intro':
        check(INTRO)
        build('intro', INTRO, fitted=True)
    else:
        check(WALKTHROUGH)
        build('walkthrough', WALKTHROUGH, fitted=False)
