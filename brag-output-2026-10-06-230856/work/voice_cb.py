"""Chatterbox worker for voice.py: every line in one process, the model loaded once.

    <chatterbox-venv>/python voice_cb.py job.json

job.json: {"ref": wav, "exaggeration": x, "cfg": x, "out": dir,
           "lines": [{"id", "text", "speak", "expect"?, "limit": seconds or null, "seed"}]}

`speak` is what the model reads (CONTINUA as "Continua", or it spells it out);
`text` - or `expect`, where they differ - is what the take must be heard to say.

Chatterbox samples, so a take can come out long, or - rarely - with a word
dropped or one added. Each line gets up to four takes, one seed each: every
take is transcribed (Whisper base.en, primed with the script's names) and
compared with the script word for word, numbers and spellings normalised, the
names required. The first take that passes and fits its window is kept; if
none fits, the shortest that passes. If none passes, the closest is kept with
a WARNING to listen to it. Writes <id>.raw.wav per line and takes.json with
every take's transcript and measurements.
"""
import json
import os
import re
import sys
import time

import numpy as np
import torch
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS
from transformers import pipeline

job = json.load(open(sys.argv[1], encoding='utf-8'))
torch.set_num_threads(int(os.environ.get('CB_THREADS', max(4, (os.cpu_count() or 8) - 2))))
t0 = time.time()
model = ChatterboxTTS.from_pretrained(device='cpu')
model.prepare_conditionals(job['ref'], exaggeration=job['exaggeration'])
asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device='cpu')
# The script's own names as vocabulary. Unprimed, Whisper writes "continuous"
# for CONTINUA even in a take that clearly says it (it did for Kokoro's too).
VOCABULARY = asr.tokenizer.get_prompt_ids('CONTINUA, by Team Kanban. Wi-Fi, cellular and satellite.', return_tensors='pt')
print(f'loaded in {time.time() - t0:.0f} s', flush=True)

UNITS = {name: value for value, name in enumerate(
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen '
    'fifteen sixteen seventeen eighteen nineteen'.split())}
TENS = {name: 20 + 10 * i for i, name in enumerate('twenty thirty forty fifty sixty seventy eighty ninety'.split())}


def numerals(tokens):
    """Number words as digits - "seven point three two" is 7.32, "forty seven" 47 -
    so a script that spells numbers and a transcript that writes them compare equal."""
    out, i = [], 0
    while i < len(tokens):
        token = tokens[i]
        if token not in UNITS and token not in TENS:
            out.append(token)
            i += 1
            continue
        value = TENS.get(token, UNITS.get(token))
        i += 1
        if token in TENS and i < len(tokens) and UNITS.get(tokens[i], 10) < 10:
            value += UNITS[tokens[i]]
            i += 1
        text = str(value)
        if i < len(tokens) and tokens[i] == 'point':
            j, decimals = i + 1, ''
            while j < len(tokens) and UNITS.get(tokens[j], 10) < 10:
                decimals += str(UNITS[tokens[j]])
                j += 1
            if decimals:
                text, i = f'{text}.{decimals}', j
        out.append(text)
    return out


def words(text):
    text = text.lower().replace('wi-fi', 'wifi').replace('wi fi', 'wifi')
    # Spellings a transcriber may choose differently from the script.
    text = re.sub(r'\bhand[- ]off', 'handoff', text)
    text = re.sub(r'\broadmap', 'road map', text)
    text = re.sub(r'\bmeter(s?)\b', r'metre\1', text)
    text = re.sub(r'\bmegabyte(s?)\b', r'mb', text)
    text = re.sub(r'\bw\W{0,3}a\W{0,3}s\W{0,3}d\b', 'wasd', text)
    text = re.sub(r'\bm\W{0,3}p\W{0,3}t\W{0,3}c\W{0,3}p\b', 'mptcp', text)
    return numerals(re.findall(r"[0-9]+(?:\.[0-9]+)?|[a-z']+", text.replace('-', ' ')))


def distance(a, b):
    """Word-level edit distance."""
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, y in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (x != y))
    return row[-1]


def voiced_seconds(wav, rate):
    level = np.abs(wav)
    floor = level.max() * 10 ** (-42 / 20)
    idx = np.nonzero(level > floor)[0]
    return (idx[-1] - idx[0]) / rate if len(idx) else 0.0


takes = {}
for line in job['lines']:
    best = None
    candidates = []
    takes[line['id']] = []
    for attempt in range(4):
        seed = line['seed'] + attempt * 101
        torch.manual_seed(seed)
        t = time.time()
        wav = model.generate(line['speak'], exaggeration=job['exaggeration'], cfg_weight=job['cfg'])
        audio = wav.squeeze(0).numpy()
        seconds = voiced_seconds(audio, model.sr)
        heard = asr({'raw': audio.astype(np.float32), 'sampling_rate': model.sr},
                    generate_kwargs={'prompt_ids': VOCABULARY})['text']
        ref, hyp = words(line.get('expect', line['text'])), words(heard)
        errors = distance(ref, hyp)
        # The names must be heard as themselves: "continuous" for CONTINUA is a
        # different word, however close the rest of the take is.
        names = all(hyp.count(name) >= ref.count(name) for name in ('continua', 'kanban'))
        # A word or two of slack on a long line (a transcriber's guess, not the voice);
        # a line made again for a misheard word sets `max_errors` to 0.
        faithful = bool(names and errors <= line.get('max_errors', max(1, round(len(ref) * 0.08))))
        fits = bool(line['limit'] is None or seconds <= line['limit'])
        record = {'seed': seed, 'seconds': round(float(seconds), 3), 'errors': errors, 'names': names, 'heard': heard.strip(),
                  'faithful': faithful, 'fits': fits, 'took': round(time.time() - t, 1)}
        takes[line['id']].append(record)
        print(f"{line['id']} seed {seed}: {seconds:.2f} s, {errors} word errors, names {names}, fits {fits}  | {heard.strip()[:70]}", flush=True)
        if faithful and (best is None or seconds < best[0]):
            best = (seconds, audio, record)
        if faithful and fits:
            break
        if not faithful:
            candidates.append((not names, errors, seconds, audio, record))
    if best is None:
        # No take passed: keep the closest, and say so loudly for a human to hear.
        closest = min(candidates, key=lambda c: c[:3])
        best = (closest[2], closest[3], closest[4])
        print(f"WARNING {line['id']}: no take passed the transcript check; kept seed {closest[4]['seed']} "
              f"({closest[4]['errors']} word errors, names {closest[4]['names']}) - listen to it", flush=True)
        closest[4]['unverified'] = True
    ta.save(os.path.join(job['out'], f"{line['id']}.raw.wav"), torch.from_numpy(best[1]).unsqueeze(0), model.sr)
    best[2]['kept'] = True

# Merged with any earlier run's record, so a line made again keeps the others' takes.
record_path = os.path.join(job['out'], 'takes.json')
record = json.load(open(record_path, encoding='utf-8')) if os.path.exists(record_path) else {}
record.update(takes)
json.dump(record, open(record_path, 'w', encoding='utf-8'), indent=1)
print(f'done in {time.time() - t0:.0f} s', flush=True)
