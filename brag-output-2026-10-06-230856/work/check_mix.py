"""Listen to a finished film the way a viewer would: transcribe its mix (voice
over music) line by line, at the times the edit placed each line, and compare
each with the script.

    <chatterbox-venv>/python check_mix.py ../walkthrough.mp4 walkthrough
    <chatterbox-venv>/python check_mix.py ../brag.mp4 intro
    <chatterbox-venv>/python check_mix.py demo-revoiced.mp4 demo

Line by line, because Whisper's long-form mode can skip half a minute of clear
speech at a chunk seam - it did, on this walkthrough. Each line's window runs
from its start to its end plus 0.4 s, so only that line's words are in it.
Uses voice_cb.py's normalisation (numbers, spellings) and prints every
difference, so a line the music buried shows up.
"""
import difflib
import json
import os
import subprocess
import sys

import numpy as np
from transformers import pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'voice_cb.py'), encoding='utf-8').read()
scope = {'re': __import__('re')}
exec(src[src.index('UNITS = '):src.index('def distance')], scope)  # numerals() and words()
words = scope['words']

video, name = sys.argv[1], sys.argv[2]
pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, dtype=np.float32)
asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device='cpu')
prompt = asr.tokenizer.get_prompt_ids('CONTINUA, by Team Kanban. Wi-Fi, cellular and satellite.', return_tensors='pt')
if name == 'demo':
    # The re-voiced Phase 3 demo: its cues as revoice_demo.py placed them.
    cues = json.load(open(os.path.join(HERE, '..', '..', 'video', 'audio', 'narration.json'), encoding='utf-8'))['cues']
    lines = [{'id': c['id'], 'start': c['from'], 'end': c['ends'], 'text': c['text']} for c in cues]
else:
    placed = 'walkthrough-voice.json' if name == 'walkthrough' else 'intro-timings.json'
    lines = json.load(open(os.path.join(HERE, placed), encoding='utf-8'))['lines']
total_words = total_errors = 0
for line in lines:
    a, b = int(line['start'] * 16000), int((line['end'] + 0.4) * 16000)
    heard = asr({'raw': audio[a:b].copy(), 'sampling_rate': 16000}, generate_kwargs={'prompt_ids': prompt})['text']
    ref, hyp = words(line['text']), words(heard)
    errors = 0
    notes = []
    for op, a0, a1, b0, b1 in difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False).get_opcodes():
        if op != 'equal':
            errors += max(a1 - a0, b1 - b0)
            notes.append(f'{" ".join(ref[a0:a1])!r} -> {" ".join(hyp[b0:b1])!r}')
    total_words += len(ref)
    total_errors += errors
    print(f"{line['id']} {line['start']:6.2f}s  {errors} diff  {'; '.join(notes)}")
print(f'{name}: {total_words} script words, {total_errors} differences, WER {total_errors / total_words:.1%}')
