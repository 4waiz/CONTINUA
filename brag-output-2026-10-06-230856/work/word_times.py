"""When each word of a narration line is said, so the edit can land on it.

    <chatterbox-venv>/python word_times.py intro i4

Transcribes vo/<set>/<id>.wav with Whisper (base.en, word timestamps) and
writes <set>-words.json: {"<id>": [{"word", "start", "end"}, ...]}, seconds
from the start of the clip. The intro lights each of its W A S D key caps on
the moment the narrator says the letter.
"""
import json
import os
import sys

import soundfile as sf
from transformers import pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
name, ids = sys.argv[1], sys.argv[2:]
asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device='cpu')
out_path = os.path.join(HERE, f'{name}-words.json')
words = json.load(open(out_path, encoding='utf-8')) if os.path.exists(out_path) else {}
for line_id in ids:
    audio, rate = sf.read(os.path.join(HERE, 'vo', name, f'{line_id}.wav'), dtype='float32')
    result = asr({'raw': audio, 'sampling_rate': rate}, return_timestamps='word')
    words[line_id] = [
        {'word': chunk['text'].strip(), 'start': round(chunk['timestamp'][0], 3), 'end': round(chunk['timestamp'][1], 3)}
        for chunk in result['chunks']
    ]
    print(line_id, ' '.join(f"{w['word']}@{w['start']:.2f}" for w in words[line_id]))
json.dump(words, open(out_path, 'w', encoding='utf-8'), indent=1)
