"""Re-voice the Phase 3 demo video with the films' narrator, picture untouched.

    python revoice_demo.py              synthesise, fit, mix, and write the new MP4 beside the old
    python revoice_demo.py --only N10   make just these cues again (word-perfect takes only), re-mix
    python revoice_demo.py --install    then replace deliverables/CONTINUA_Team_Kanban_Demo.mp4

The demo (`scripts/build-demo.mjs`) was narrated by a Windows voice, which
sounded robotic. Its fourteen cues - text and windows - are in
`video/timeline.json`; this keeps them exactly, so the subtitles still match
what is said. Each cue is spoken by Chatterbox in the films' voice
(voice_cb.py: every take transcribed and checked against the script), may run
into the silence before the next cue but never into it, is sped up at most
1.18x (the old fitter's ceiling, +18 %), and is placed at its cue's start.
The video stream is copied bit for bit; only the audio track changes. Writes
video/audio/narration.wav and narration.json in the shape
`scripts/qa-demo.mjs` reads, so the QA report can be regenerated.
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import voice  # noqa: E402  - the same reference clip, trimming and loudness as the films

DEMO = os.path.join(ROOT, 'deliverables', 'CONTINUA_Team_Kanban_Demo.mp4')
OUT_DIR = os.path.join(HERE, 'vo', 'demo')
AUDIO = os.path.join(ROOT, 'video', 'audio')
CEILING = 1.18
RATE = 24000
ONLY = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else set()


def seconds(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def main():
    timeline = json.load(open(os.path.join(ROOT, 'video', 'timeline.json'), encoding='utf-8'))
    cues = timeline['narration']
    total = seconds(DEMO)
    os.makedirs(OUT_DIR, exist_ok=True)
    # No banned-phrase pass here: this script is the demo's own, already gated
    # by scripts/check-claims.mjs - and its scope line rightly says "no MPTCP".
    lines = []
    for i, cue in enumerate(cues):
        until = cues[i + 1]['from'] - 0.15 if i + 1 < len(cues) else total - 0.3
        lines.append({
            'id': cue['id'], 'text': cue['text'],
            'speak': cue['text'].replace('CONTINUA', 'Continua').replace('MPTCP', 'M P T C P'),
            'limit': round((until - cue['from']) * CEILING, 3), 'seed': (7000 if ONLY else 3000) + i, 'until': until,
            **({'max_errors': 0} if cue['id'] in ONLY else {}),
        })
    job = {'ref': voice.reference(), 'exaggeration': voice.CB_EXAGGERATION, 'cfg': voice.CB_CFG, 'out': OUT_DIR,
           'lines': [line for line in lines if not ONLY or line['id'] in ONLY]}
    before = {}
    if ONLY:
        before = {c['id']: c for c in json.load(open(os.path.join(AUDIO, 'narration.json'), encoding='utf-8'))['cues']}
    path = os.path.join(OUT_DIR, 'job.json')
    json.dump(job, open(path, 'w', encoding='utf-8'), indent=1)
    subprocess.run([voice.CB_PY, os.path.join(HERE, 'voice_cb.py'), path], check=True)

    track = np.zeros(int(total * RATE) + RATE, dtype=np.float64)
    report = []
    for cue, line in zip(cues, lines):
        if ONLY and cue['id'] not in ONLY:
            # Kept as it was: its finished clip is on disk.
            clip, rate = sf.read(os.path.join(OUT_DIR, f"{cue['id']}.wav"), dtype='float64')
            speed = 1 + before[cue['id']]['rate'] / 100
        else:
            raw = os.path.join(OUT_DIR, f"{cue['id']}.raw.wav")
            clip, rate = voice.trimmed(raw)
            room = line['until'] - cue['from']
            speed = 1.0
            if len(clip) / rate > room:
                speed = len(clip) / rate / room
                if speed > CEILING:
                    sys.exit(f"{cue['id']} needs {speed:.2f}x to fit {room:.2f} s - the ceiling is {CEILING}x")
                voice.tempo(raw, speed)
                clip, rate = voice.trimmed(raw)
            clip = voice.finish(clip)
            sf.write(os.path.join(OUT_DIR, f"{cue['id']}.wav"), clip, rate, subtype='PCM_16')
        assert rate == RATE, rate
        start = int(round(cue['from'] * rate))
        track[start:start + len(clip)] += clip
        length = len(clip) / rate
        report.append({'id': cue['id'], 'from': cue['from'], 'to': cue['to'], 'spoken': round(length, 3),
                       'ends': round(cue['from'] + length, 3), 'rate': round((speed - 1) * 100), 'text': cue['text']})
        print(f"{cue['id']:4s} {cue['from']:6.2f}-{cue['from'] + length:6.2f} s (cue to {cue['to']:.2f}, room to {line['until']:.2f})  x{speed:.2f}")
    track = track[:int(total * RATE)]
    os.makedirs(AUDIO, exist_ok=True)
    wav = os.path.join(AUDIO, 'narration.wav')
    sf.write(wav, np.clip(track, -1, 1), RATE, subtype='PCM_16')
    json.dump({'voice': 'Chatterbox, voice cloned from Kokoro am_michael',
               'engine': 'Chatterbox (Resemble AI), local; brag-output-2026-10-06-230856/work/revoice_demo.py',
               'cues': report}, open(os.path.join(AUDIO, 'narration.json'), 'w', encoding='utf-8'), indent=1)

    staged = os.path.join(HERE, 'demo-revoiced.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', DEMO, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
                    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', staged], check=True)
    print('wrote', staged, f'{seconds(staged):.2f} s')
    if '--install' in sys.argv:
        shutil.copyfile(staged, DEMO)
        print('installed', DEMO)


if __name__ == '__main__':
    main()
