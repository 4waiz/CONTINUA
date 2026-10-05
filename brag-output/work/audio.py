"""Score and sound effects for the CONTINUA story film, synthesised as one piece.

D major, 96 BPM where there is a pulse. Section changes and every effect sit on
the edit's own frame numbers (see ../brag-plan.md). Deterministic: no randomness
beyond a seeded generator.
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import wave

SR = 48000
FPS = 30
TOTAL_FRAMES = 1784
DUR = TOTAL_FRAMES / FPS
N = int(round(DUR * SR))
rng = np.random.default_rng(70009)

# Edit points, in film seconds (frame / 30).
CUT = {name: f / FPS for name, f in dict(hook=0, ch1=165, ch2=424, ch3=649, ch4a=855, ch4b=1070, proof=1234, statement=1454, outro=1634).items()}
WIFI = (165 + (284 - 140)) / FPS       # CONTINUA onto Wi-Fi; normal rover drops
STOPPED = (855 + (1084 - 904)) / FPS   # normal rover stops safely
BEAT = 60 / 96


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def m(name):
    """'F#4' -> midi number."""
    pitch, octave = name[:-1], int(name[-1])
    return 12 * (octave + 1) + NOTE[pitch]


def stereo():
    return np.zeros((2, N))


def place(bus, sig, t0, pan=0.0, gain=1.0):
    """Add a mono or stereo signal into a stereo bus at time t0 (s)."""
    i0 = int(round(t0 * SR))
    if sig.ndim == 1:
        left, right = sig * np.sqrt(0.5 * (1 - pan)), sig * np.sqrt(0.5 * (1 + pan))
        sig = np.vstack([left, right])
    if i0 < 0:
        sig = sig[:, -i0:]
        i0 = 0
    n = min(sig.shape[1], N - i0)
    if n > 0:
        bus[:, i0:i0 + n] += gain * sig[:, :n]


def lp(x, hz, order=2):
    sos = butter(order, hz, 'low', fs=SR, output='sos')
    return sosfilt(sos, x, axis=-1)


def hp(x, hz, order=2):
    sos = butter(order, hz, 'high', fs=SR, output='sos')
    return sosfilt(sos, x, axis=-1)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], 'band', fs=SR, output='sos')
    return sosfilt(sos, x, axis=-1)


def env_ar(n, attack, release, sustain_level=1.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((n / SR - t) / max(release, 1e-4), 0, 1)
    return np.minimum(a, r) * sustain_level


def smooth(a):
    return a * a * (3 - 2 * a)


# ---------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------

def pad_note(freq, dur, attack=0.9, release=1.2, detune_cents=5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for ch, sign in ((0, -1), (1, 1)):
        f = freq * 2 ** (sign * detune_cents / 1200)
        ph = 2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)
        tri = 2 / np.pi * np.arcsin(np.sin(ph))
        saw = 2 * ((f * t + rng.uniform(0, 1)) % 1.0) - 1
        out[ch] = 0.55 * np.sin(ph) + 0.3 * tri + 0.15 * saw
    out *= env_ar(n, attack, release)
    return out


def bell(freq, dur=1.6, ratio=3.5, index=2.2, decay=0.55, bright=0.18):
    n = int(dur * SR)
    t = np.arange(n) / SR
    modi = index * np.exp(-t / bright)
    sig = np.sin(2 * np.pi * freq * t + modi * np.sin(2 * np.pi * freq * ratio * t))
    sig += 0.25 * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t / (decay * 0.5))
    amp = np.exp(-t / decay) * np.clip(t / 0.003, 0, 1)
    return sig * amp


def pluck(freq, dur=0.7):
    n = int(dur * SR)
    t = np.arange(n) / SR
    modi = 1.6 * np.exp(-t / 0.06)
    sig = np.sin(2 * np.pi * freq * t + modi * np.sin(2 * np.pi * freq * 2 * t))
    return sig * np.exp(-t / 0.22) * np.clip(t / 0.004, 0, 1)


def bass_note(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(2 * np.pi * 2 * freq * t)
    sig = np.tanh(1.4 * sig)
    e = np.clip(t / 0.006, 0, 1) * (0.55 + 0.45 * np.exp(-t / 0.12)) * np.clip((dur - t) / 0.05, 0, 1)
    return sig * e


def kick(dur=0.45):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 46 + 70 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(ph) * np.exp(-t / 0.16)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.12
    return sig + click


def hat(dur=0.06):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-t / 0.018)


def noise_sweep(dur, f0, f1, shape='rise'):
    """Filtered noise whose band moves from f0 to f1: risers and whooshes."""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    hop = int(0.02 * SR)
    for i in range(0, n, hop):
        a = i / n
        fc = f0 * (f1 / f0) ** a
        seg = x[max(0, i - 2048):i + hop]
        y = bp(seg, max(40, fc * 0.6), min(SR / 2 - 100, fc * 1.6))
        out[i:i + hop] = y[-min(hop, n - i):]
    t = np.arange(n) / SR
    if shape == 'rise':
        e = (t / (n / SR)) ** 2.2
    else:  # swell to the middle, then away
        mid = 0.55
        p = t / (n / SR)
        e = np.where(p < mid, (p / mid) ** 2, ((1 - p) / (1 - mid)) ** 1.6)
    return out * e


def reverb_ir(seconds=2.6, tone=5000):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.vstack([rng.standard_normal(n), rng.standard_normal(n)]) * np.exp(-t / (seconds / 6.5))
    ir = lp(ir, tone)
    ir[:, : int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))


IR = reverb_ir()


def verb(bus, wet):
    out = np.vstack([fftconvolve(bus[0], IR[0])[:N], fftconvolve(bus[1], IR[1])[:N]])
    return bus + wet * out


# ---------------------------------------------------------------------------
# Harmony: (start, end, chord tones, bass root)
# ---------------------------------------------------------------------------
D, Bm, G, A, Em = ['D3', 'A3', 'E4', 'F#4', 'A4'], ['B2', 'F#3', 'D4', 'F#4', 'A4'], ['G2', 'D3', 'B3', 'D4', 'F#4'], ['A2', 'E3', 'C#4', 'E4', 'A4'], ['E3', 'B3', 'D4', 'G4', 'B4']
Asus = ['A2', 'E3', 'D4', 'E4', 'A4']
BAR = 2.5
cA = CUT['ch1']
chords = [(0.0, cA, D, 'D2')]
seqA = [D, Bm, G, A, D, Bm, G, Em, Asus]
rootsA = ['D2', 'B1', 'G1', 'A1', 'D2', 'B1', 'G1', 'E2', 'A1']
for i, (ch, r) in enumerate(zip(seqA, rootsA)):
    s = cA + i * BAR
    chords.append((s, min(s + BAR, CUT['ch4a']), ch, r))
dark = ['B1', 'F#2', 'D3', 'C#4', 'F#4']
chords.append((CUT['ch4a'], CUT['ch4b'], dark, 'B1'))
cB = CUT['ch4b']
seqB = [D, A, Bm, G, D]
rootsB = ['D2', 'A1', 'B1', 'G1', 'D2']
for i, (ch, r) in enumerate(zip(seqB, rootsB)):
    s = cB + i * BAR
    chords.append((s, min(s + BAR, CUT['statement']), ch, r))
chords.append((CUT['statement'], CUT['statement'] + BAR, G, 'G1'))
chords.append((CUT['statement'] + BAR, CUT['outro'], Asus, 'A1'))
chords.append((CUT['outro'], DUR, ['D3', 'A3', 'E4', 'F#4', 'A4', 'D5'], 'D2'))

# ---------------------------------------------------------------------------
# Buses
# ---------------------------------------------------------------------------
pad, arp, bass, drums, sfx, bells = stereo(), stereo(), stereo(), stereo(), stereo(), stereo()

for (s, e, tones, root) in chords:
    dur = (e - s) + 1.1  # overlap into the next chord's attack
    for k, name in enumerate(tones):
        place(pad, pad_note(midi(m(name)), dur, attack=0.8 if s > 0 else 2.2, release=1.1), s - 0.05, gain=0.16 / len(tones) * 5 / (1 + 0.15 * k))

# Pad tone: dark in the cutting, opening through the dead-zone approach.
t = np.arange(N) / SR
bright = lp(pad, 3200)
darkp = lp(pad, 520)
mix = np.ones(N)
mix = np.where(t < CUT['ch3'], 0.75, mix)
mix = np.where((t >= CUT['ch3']) & (t < CUT['ch4a']), 0.75 + 0.25 * smooth(np.clip((t - CUT['ch3']) / (CUT['ch4a'] - CUT['ch3']), 0, 1)), mix)
mix = np.where((t >= CUT['ch4a']) & (t < CUT['ch4b']), 0.0, mix)
mix = np.where(t < 2.0, 0.35 + 0.4 * smooth(np.clip(t / 2.0, 0, 1)), mix)
fade = np.clip(np.abs(t - CUT['ch4a']) / 0.08, 0, 1) * np.clip(np.abs(t - CUT['ch4b']) / 0.25, 0, 1)
pad = bright * mix + darkp * (1 - mix)


def chord_at(time):
    for (s, e, tones, root) in chords:
        if s <= time < e:
            return tones, root
    return chords[-1][2], chords[-1][3]


# Pulse sections: (start, end, arp step in beats, kick, hats, bass)
sections = [
    (CUT['ch1'], CUT['ch2'], 0.5, False, False, True),
    (CUT['ch2'], CUT['ch3'], 0.5, True, True, True),
    (CUT['ch3'], CUT['ch4a'], 0.25, True, True, True),
    (CUT['ch4b'], CUT['proof'], 0.5, True, True, True),
    (CUT['proof'], CUT['statement'], 0.5, True, False, True),
    (CUT['statement'], CUT['outro'] - 0.3, 1.0, False, False, True),
]
ANCHORS = {CUT['ch1']: CUT['ch1'], CUT['ch2']: CUT['ch1'], CUT['ch3']: CUT['ch1'], CUT['ch4b']: CUT['ch4b'], CUT['proof']: CUT['ch4b'], CUT['statement']: CUT['ch4b']}
pattern = [0, 2, 4, 3, 1, 4, 2, 3]
for (s, e, step, has_kick, has_hat, has_bass) in sections:
    grid = ANCHORS[s]
    k0 = int(np.ceil((s - grid) / (BEAT * step) - 1e-6))
    k = k0
    while True:
        when = grid + k * BEAT * step
        if when >= e - 1e-6:
            break
        tones, root = chord_at(when + 1e-3)
        note = midi(m(tones[pattern[k % len(pattern)] % len(tones)]) + 12)
        accent = 1.0 if (k * step) % 1 == 0 else 0.7
        place(arp, pluck(note), when, pan=0.35 * np.sin(k * 1.7), gain=0.075 * accent)
        k += 1
    # quarter-note grid for kick, hats on the off-beats, bass on eighths
    q = int(np.ceil((s - grid) / BEAT - 1e-6))
    while True:
        when = grid + q * BEAT
        if when >= e - 1e-6:
            break
        tones, root = chord_at(when + 1e-3)
        if has_kick and q % 2 == 0:
            place(drums, kick(), when, gain=0.42)
        if has_hat:
            place(drums, hat(), when + BEAT / 2, pan=0.25, gain=0.05)
        if has_bass:
            for half in (0, 0.5):
                place(bass, bass_note(midi(m(root)), BEAT * 0.48), when + half * BEAT, gain=0.2 if half == 0 else 0.13)
        q += 1

# The cutting: a slow heartbeat under the dark pad, and a held high F#.
hb = CUT['ch4a'] + 0.05
while hb < CUT['ch4b'] - 0.4:
    place(drums, lp(kick(0.5), 160), hb, gain=0.55)
    place(drums, lp(kick(0.4), 160), hb + 0.28, gain=0.3)
    hb += 1.25
air = pad_note(midi(m('F#6')), CUT['ch4b'] - CUT['ch4a'], attack=1.5, release=1.0, detune_cents=7)
place(pad, lp(air, 4000), CUT['ch4a'], gain=0.03)

# ---------------------------------------------------------------------------
# Hook and outro bells; effects
# ---------------------------------------------------------------------------
for i, name in enumerate(['D5', 'F#5', 'A5']):
    place(bells, bell(midi(m(name))), 0.45 + i * 0.16, pan=-0.3 + 0.3 * i, gain=0.07)
for i, name in enumerate(['F#5', 'A5', 'D6']):
    place(bells, bell(midi(m(name))), 1.55 + i * 0.16, pan=-0.3 + 0.3 * i, gain=0.07)
for i, name in enumerate(['D5', 'F#5', 'A5', 'D6']):
    place(bells, bell(midi(m(name)), dur=2.6, decay=0.9), CUT['outro'] + 0.2 + i * 0.2, pan=-0.35 + 0.23 * i, gain=0.075)
place(bells, bell(midi(m('A5')), dur=3.0, decay=1.2), CUT['outro'] + 2.4, pan=0.2, gain=0.05)

# risers into the story and into the verdict
place(sfx, noise_sweep(1.9, 300, 5000, 'rise'), CUT['ch1'] - 1.9, gain=0.05)
place(sfx, noise_sweep(1.6, 200, 3500, 'rise'), CUT['ch4b'] - 1.6, gain=0.06)

# whooshes on the cuts
for name, g in (('ch2', 0.13), ('ch3', 0.13), ('proof', 0.14), ('statement', 0.11), ('outro', 0.1)):
    place(sfx, noise_sweep(0.7, 500, 2600, 'swell'), CUT[name] - 0.38, pan=0.0, gain=g)
place(sfx, lp(noise_sweep(0.9, 300, 1400, 'swell'), 1800), CUT['ch4a'] - 0.5, gain=0.16)


def chime(notes, t0, gain, gap=0.11):
    for i, name in enumerate(notes):
        place(sfx, bell(midi(m(name)), dur=1.4, ratio=2.0, index=1.4, decay=0.45, bright=0.08), t0 + i * gap, pan=0.25 - 0.25 * i, gain=gain)


def drop(t0, gain):
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    f = midi(m('D2')) * (1 - 0.12 * smooth(np.clip(tt / 0.5, 0, 1)))
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.28) * np.clip(tt / 0.01, 0, 1)
    thump = lp(rng.standard_normal(n), 220) * np.exp(-tt / 0.06) * 0.6
    place(sfx, np.tanh(1.3 * (sig + thump)), t0, gain=gain)


def tick(t0, gain):
    n = int(0.12 * SR)
    tt = np.arange(n) / SR
    sig = bp(rng.standard_normal(n), 900, 3200) * np.exp(-tt / 0.012) + 0.6 * np.sin(2 * np.pi * 330 * tt) * np.exp(-tt / 0.03)
    place(sfx, sig, t0, gain=gain)


chime(['D6', 'A6'], WIFI, 0.038)
drop(WIFI + 0.05, 0.1)
place(sfx, bell(midi(m('A6')), dur=1.0, ratio=2.0, index=1.0, decay=0.35, bright=0.06), CUT['ch2'] + 8 / FPS, pan=0.1, gain=0.06)
chime(['F#6', 'A6', 'D7'], CUT['ch4a'] + 0.04, 0.04, gap=0.09)
drop(CUT['ch4a'] + 0.08, 0.14)
tick(STOPPED, 0.11)
tick(STOPPED + 0.13, 0.09)

# verdict: a soft impact with a shimmer
n = int(2.4 * SR)
tt = np.arange(n) / SR
boom = np.sin(2 * np.pi * np.cumsum(42 + 30 * np.exp(-tt / 0.08)) / SR) * np.exp(-tt / 0.7)
place(sfx, boom, CUT['ch4b'], gain=0.22)
for i, name in enumerate(['A6', 'D7', 'F#7']):
    place(sfx, bell(midi(m(name)), dur=1.8, decay=0.7), CUT['ch4b'] + 0.03 + i * 0.05, pan=-0.3 + 0.3 * i, gain=0.025)

# proof: a light sparkle as the sweep runs along CONTINUA's row
sweep0 = CUT['proof'] + 22 / FPS
for i, name in enumerate(['D6', 'E6', 'F#6', 'A6', 'B6', 'D7']):
    place(sfx, bell(midi(m(name)), dur=1.0, decay=0.3, bright=0.05), sweep0 + i * 0.2, pan=-0.5 + 0.2 * i, gain=0.055)

# statement: a softer impact as the big line lands
place(sfx, boom * 0.7, CUT['statement'] + 8 / FPS, gain=0.18)

# ---------------------------------------------------------------------------
# Mix
# ---------------------------------------------------------------------------
# Bus gains, set from the level report below: the pad was burying everything.
G_PAD, G_ARP, G_BASS, G_DRUMS, G_BELLS, G_SFX = 0.55, 3.6, 1.5, 1.35, 3.4, 2.6
# The cutting sits lower: a dark, quieter bed under the heartbeat.
in_cut = np.clip((t - CUT['ch4a']) / 0.3, 0, 1) * np.clip((CUT['ch4b'] - t) / 0.3, 0, 1)
pad_level = 1 - 0.45 * in_cut
duck = np.ones(N)
for (s0, e0, step, has_kick, *_rest) in sections:
    if not has_kick:
        continue
    grid = ANCHORS[s0]
    q = int(np.ceil((s0 - grid) / BEAT - 1e-6))
    while grid + q * BEAT < e0:
        if q % 2 == 0:
            i0 = int((grid + q * BEAT) * SR)
            n = int(0.3 * SR)
            if i0 + n < N:
                duck[i0:i0 + n] = np.minimum(duck[i0:i0 + n], 1 - 0.28 * np.exp(-np.arange(n) / SR / 0.09))
        q += 1
pad = pad * G_PAD * pad_level
arp = lp(arp, 6000) * G_ARP
bass = lp(bass, 900) * G_BASS
drums = drums * G_DRUMS
bells = bells * G_BELLS
sfx = sfx * G_SFX
music = verb((pad + arp + bass) * duck + drums, 0.22) + verb(bells, 0.5)
effects = verb(sfx, 0.3)

# ---------------------------------------------------------------------------
# Voiceover (narration.py): music ducks to 0.15 under it, effects to half
# ---------------------------------------------------------------------------
import json
import soundfile as sf
import subprocess
# A gentle compressor evens the voice's peaks so the mix can sit at -16 LUFS
# without a limiter squashing it.
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'voice.wav', '-af',
                'acompressor=threshold=-22dB:ratio=3:attack=4:release=140:makeup=4dB,alimiter=limit=0.8:attack=3:release=60:level=disabled',
                'voice_c.wav'], check=True)
voice, vsr = sf.read('voice_c.wav', dtype='float64')
assert vsr == SR
voice = voice.T[:, :N]
if voice.shape[1] < N:
    voice = np.pad(voice, ((0, 0), (0, N - voice.shape[1])))
lines = json.load(open('vo-timings.json', encoding='utf-8'))['lines']
# Lines closer than 0.6 s share one duck, so the music does not pump between
# sentences; longer gaps let it breathe at the cuts and the verdict.
regions = []
for line in lines:
    a, b = line['start'] - 0.12, line['end'] + 0.2
    if regions and a - regions[-1][1] < 0.6:
        regions[-1][1] = b
    else:
        regions.append([a, b])
active = np.zeros(N)
for a, b in regions:
    active[int(a * SR):int(b * SR)] = 1.0
# one-pole smoothing: quick to duck, slow to come back
vo_env = np.zeros(N)
att, rel = np.exp(-1 / (0.12 * SR)), np.exp(-1 / (0.45 * SR))
from scipy.signal import lfilter
# attack and release applied as two passes of a simple follower
up = lfilter([1 - att], [1, -att], active)
vo_env = np.maximum(up, lfilter([1 - rel], [1, -rel], active))
vo_env = np.clip(vo_env * 1.02, 0, 1)
on = active > 0.5
G_VOICE = np.sqrt(np.mean(music[:, ~on] ** 2)) * 10 ** (3 / 20) / np.sqrt(np.mean(voice[:, on] ** 2))
voice = voice * G_VOICE
music_gain = 1 - (1 - 0.15) * vo_env
effects_gain = 1 - 0.5 * vo_env
mix = music * music_gain + effects * effects_gain + voice
print('voice regions', [[round(a, 2), round(b, 2)] for a, b in regions])
print('under the voice: voice', round(20 * np.log10(np.sqrt(np.mean(voice[:, on] ** 2))), 1), 'dB, music',
      round(20 * np.log10(np.sqrt(np.mean((music * music_gain)[:, on] ** 2))), 1), 'dB')

# levels, for the record: each layer and each section, before the master
def db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
ref = np.max(np.abs(mix))
print('pre-master peak', round(float(ref), 3))
for label, x in (('pad', pad), ('arp', arp), ('bass', bass), ('drums', drums), ('bells', bells), ('sfx', sfx)):
    print(f'  {label:6s} {db(x / ref):6.1f} dB (whole film, relative to the mix peak)')
names = list(CUT)
for a, b in zip(names, names[1:] + ['end']):
    s0, s1 = CUT[a], (CUT[b] if b != 'end' else DUR)
    i0, i1 = int(s0 * SR), int(s1 * SR)
    print(f'  section {a:10s} {db(mix[:, i0:i1] / ref):6.1f} dB')
# each effect against the music around it (300 ms from its start)
events = {'wifi chime+drop': WIFI, 'ch2 ping': CUT['ch2'] + 8 / FPS, 'satellite chime+drop': CUT['ch4a'], 'stop ticks': STOPPED,
          'verdict hit': CUT['ch4b'], 'proof sparkle': CUT['proof'] + 22 / FPS, 'statement hit': CUT['statement'] + 8 / FPS,
          'whoosh ch3': CUT['ch3'] - 0.15, 'hook bells': 0.45, 'outro bells': CUT['outro'] + 0.2}
for label, at in events.items():
    i0, i1 = int(at * SR), int((at + 0.3) * SR)
    print(f'  event {label:22s} effect {db((effects * effects_gain)[:, i0:i1]):6.1f}  bed {db((music * music_gain)[:, i0:i1]):6.1f}  voice {db(voice[:, i0:i1]):6.1f}')

# a soft ceiling only for the rare peak; the level is set at the mux
knee = 0.8 * ref
mix = np.where(np.abs(mix) > knee, np.sign(mix) * (knee + (ref - knee) * np.tanh((np.abs(mix) - knee) / (ref - knee))), mix)
fade_in = np.clip(t / 0.25, 0, 1)
fade_out = np.clip((DUR - t) / 1.6, 0, 1) ** 1.5
mix *= fade_in * fade_out
mix = hp(mix, 28)
peak = np.max(np.abs(mix))
mix *= 0.89 / peak

with wave.open('audio.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype('<i2').tobytes())
print('audio.wav', round(DUR, 3), 's, peak normalised; cuts at', {k: round(v, 3) for k, v in CUT.items()})
