# Brag Plan: CONTINUA - the 30-second intro (and the 2-minute walkthrough's voice)

Run: `/brag` with narration on (the request asked for a male voice), tone
`cinematic` with a polished hand. Two deliverables share one voice:

1. **The intro** - `brag.mp4`, at most 30 s, replacing
   `apps/web/public/video/story.mp4`: the film behind the Mission landing's
   "Watch the intro · 30 s" button and the `?story` link.
2. **The walkthrough's voice-over** - a male narration for a separate
   two-minute screen recording of the whole app (`walkthrough/`), mixed over the
   recording in its own HyperFrames composition.

## Step 1 - the rubric

1. **What is the app?** A 3D mission view of two rescue rovers on one island
   road, through cable, Wi-Fi, cellular and satellite: one runs CONTINUA, which
   readies the next network before the current one fails; the other switches
   only after its network breaks.
2. **Most impressive claim.** On the shadowed road, 20 drives each, CONTINUA
   with its road map kept the link 20 times out of 20; the normal rover, 0
   (`phase5-test4-shadow-survey`).
3. **Visual hook.** The camera's new flight at a change of network: off the
   rover, out to the mast the new link comes from, then down the glowing beam
   back to the rover. And the island from the air.
4. **UI to show.** The Mission view itself - the status card ("Connected via
   Wi-Fi" vs "Connection lost"), the moment banner ("Dead zone 79 m ahead"),
   the drive card ("You're driving", km/h, the W A S D keys) - and the proof
   rows from the brief page.
5. **Shortest satisfying video.** About 29 s: the user's cap is 30 s, and the
   landing button promises "30 s".
6. **Tone.** Preset `cinematic`; direction "a calm, confident mission-control
   trailer in daylight - not cyberpunk". Big type, slow camera, few words.
7. **Audio.** A steady, clean music bed under a male narrator, ducked while he
   speaks; three restrained accents (title drop, proof landing, logo).
8. **Share line.** "Every time the network changes, the camera flies to where
   the new link comes from - and the session never drops. CONTINUA, by Team
   Kanban."
9. **User flow.** Watch it drive (the flight at each handoff) -> the road map
   sees a dead zone and the other rover loses its link -> take the wheel
   yourself with W A S D -> the proof.

## What is this app?
CONTINUA keeps a remote-driven rover's link to its operator alive as it moves
between cable, Wi-Fi, cellular and satellite - and shows every handoff
happening, in a 3D world you can now drive yourself.

## The angle
**"Watch the network change."** Most demos say a handoff happened. This one
flies you to it: the camera leaves the rover, finds the mast the new link
comes from, and rides the beam back. Then it gives you the wheel. Every frame
is the real app replaying recorded runs; the edit only frames them.

## Hook (0-3.6 s)
The island from the air, drifting. "The network changes." then, in the brand
gradient, "The session doesn't." The narrator says the same two lines.

## Key moments
- The Wi-Fi handoff: the camera arcs out to access point A, holds with the mast
  in the foreground and the beam arcing to the rover, then rides it down.
- The road map's banner "Dead zone 79 m ahead", the cutting, CONTINUA
  "Connected via Satellite" beside the normal rover's "Connection lost".
- "You're driving": the drive card's speed climbing, the rover steered on the
  road, the W A S D key caps pressing in time.

## Outro / punchline
"20 of 20 drives. Link kept." against "0 of 20" for the normal rover - then the
wordmark, "The network changes. The session doesn't.", "by Team Kanban",
continua.kanbanstudios.ae.

## User flow worth showing
Drive it yourself (the run starts) -> the camera's flight at the Wi-Fi handoff
-> the dead-zone banner and the cutting -> W takes the wheel -> the proof.

## Tone
- Preset: cinematic
- Creative direction: a calm, confident mission-control trailer in daylight
- Interpretation: long camera moves carry the energy; text is big, sparse and
  holds; transitions are soft dips and a slow scale-in; the narrator is warm,
  never shouting.

## Format: landscape - 1920x1080, 30 fps
## Duration: 29.4 s (hard cap 30 s)

## Visual identity (from the project)
- Background: `#F6F9FF` (page), surfaces `#FFFFFF` at 90 % glass
- Text: `#111D3A`; muted `#5D6B87`
- Accent: `#176BFF`; brand gradient `#14B8E8 -> #176BFF -> #5156E8 -> #7A3CFF`
- Network colours: Wi-Fi `#12B9E8`, cellular `#176BFF`, satellite `#7C3CFF`
- Good / bad: `#0DB982` / `#E5484D`
- Display and body font: Segoe UI (the site's system stack on Windows)
- Strongest visual element: the beam arcing from a mast to the rover, in the
  network's colour, with packets travelling down it

## Share copy (draft)
Every time the network changes, the camera flies to where the new link comes
from - and the session never drops. CONTINUA, by Team Kanban.

## Audio direction
- Role: cinematic support under a narrator
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean)
- Music treatment: in at 0.30, ducked to about 0.13 under each line, back up
  between lines, faded out over the last 1.5 s
- Music cue guidance: read the bundled preset for vol-12; lock the proof landing
  and the logo to strong cues if one falls within 0.15 s, otherwise natural timing
- Audio-reactive treatment: subtle; the outro's glow breathes with the bed's RMS
- SFX posture: sparse - a soft drop on the title, a soft impact on the proof, a
  bell on the logo
- Restraint rule: nothing over the narrator; no whooshes on every cut

## Claim ledger - every figure and claim on screen or said

| Claim | Source | Status |
|---|---|---|
| Camera flies to the new link's mast and back along the beam | The app (`packages/scene/src/components/Cameras.tsx`), captured | feature, shown |
| "Moved to Wi-Fi · From access point A" | The Mission view's moment banner on recorded run (public demo, shadow-survey, P3) | measured (replay) |
| "Dead zone 79 m ahead" | P3's decision reason in the same recording | measured (replay) |
| CONTINUA "Connected via Satellite", normal rover "Connection lost" | The two recordings' status panels at the same moment | measured (replay) |
| W A S D driving, on the road | The app (`useDrive.ts`, `driveModel.ts`), captured | feature, shown |
| 20 of 20 / 0 of 20 | `phase5-test4-shadow-survey`, test4 seed block, 20 paired trials | measured |
| "Software simulation · recorded runs" | Every run's mode is `simulation`; the public build replays recordings | stated on screen |

**Banned and not used:** 5G, MPTCP, live/real-time network, field test, real
satellite, guaranteed, zero downtime, 99.99 %, AI decides, production-ready.

## Storyboard (as built)

### Scene 1 - Hook - 0-3.6 s
Footage: the island from the air (the landing's own scene, card hidden), a slow
7 % push. Kicker "CONTINUA · Predictive Network Continuity", then "The network
changes." and, in the brand gradient, "The session doesn't." - each rising in
with the voice and held to the cut. Audio: the bed swells in under the voice; a
soft drop on the second line. Transition: soft dip to the page colour.

### Scene 2 - The flight - 3.6-10.4 s
Footage: the run playing, the Wi-Fi handoff - the camera lifts off the rover,
arcs out to access point A, holds with the mast in front and the beam arcing to
the rover, then rides the beam back. The app's own banner "Moved to Wi-Fi ·
From access point A" drops in. Lower third: kicker "Every handoff, shown",
"From Wi-Fi access point A, down the beam, to the rover", fine print "The app's
own camera · a recorded run · software simulation". Transition: hard cut.

### Scene 3 - Dead zone - 10.4-17.9 s
3a (2.9 s): the app's banner "Dead zone 79 m ahead" ringed in violet. 3b
(4.6 s): the satellite view over the cutting; CONTINUA's status card ringed
violet ("Connected via Satellite"), the normal rover's ringed red ("Connection
lost"); a status card: "CONTINUA · on satellite, still connected" / "Normal
rover · cut off, has to stop". Transition: cut.

### Scene 4 - Take the wheel - 17.9-21.9 s
Footage: "You're driving" - the drive card, the rover steered along the road.
Overlay, lower right (clear of the rover): "Take the wheel" and four key caps
W A S D, each lighting as the narrator names it, one soft click each.
Transition: soft dip.

### Scene 5 - Proof - 21.9-26.2 s
Big type over the blurred island: "20 of 20 drives." (gradient) "Link kept.",
landing on the bed's strong beat (22.37 s), then "The normal rover: 0 of 20."
Fine print: "Experiment phase5-test4-shadow-survey · 20 paired drives, same
road and signal for each · software simulation". A soft impact on the number.
A halo behind the type breathes with the bed (pre-extracted RMS and bass).

### Scene 6 - Outro - 26.2-29.4 s
Wordmark, "The network changes. The session doesn't.", "Predictive Network
Continuity · by Team Kanban", the URL pill continua.kanbanstudios.ae, fine
print "A software simulation. Every figure comes from recorded runs." A bell
on the wordmark; the bed fades out over the last 1.4 s.

**Music mood for this video:** cinematic, calm, confident
**Audio summary:** a clean bed rises under the narrator, ducks for each line,
lands two soft accents on the proof and the logo, and fades with the wordmark.

## Music cue guidance
Track `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`; cue preset
`assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`.
Strong-cue locks, if within 0.15 s: the proof number (~22.8 s) and the wordmark
(~26.6 s). Natural timing otherwise; readability first.

## Voiceover script - the intro (Chatterbox, in a voice cloned from Kokoro `am_michael`)

Measured line lengths, placed in the film (seconds). Every take was
transcribed and checked against the script (`work/vo/intro/takes.json`); the
intro's W A S D caps light at the narrator's letters (19.92, 20.32, 20.70 and
21.22 s, from Whisper's word timestamps in `work/intro-words.json`).

| Line | In film | Text |
|---|---|---|
| i1 | 0.30-3.27 | The network changes. The session doesn't. |
| i2 | 3.80-9.76 | At every handoff, the camera flies to where the new link comes from, then rides it home. |
| i3 | 10.60-17.29 | Its road map spots the dead zone early, and warms up satellite in time. The normal rover? Cut off. |
| i4 | 18.10-21.79 | And now, you can take the wheel. W, A, S, D. |
| i5 | 22.00-26.37 | Twenty drives each. CONTINUA kept the link, every time. (1.08x: the one take heard to say "CONTINUA kept", not "continue will keep") |
| i6 | 26.50-29.26 | CONTINUA. By Team Kanban. |

## Voiceover script - the walkthrough (same voice)

About two minutes, over a frame-exact recording of the public build: the
landing, a drive with its flights, the coverage overlay, the dead zone,
driving by hand, Details, Results, the Decision log, the brief and the credits.
The recording came first; each of the thirteen lines (`work/voice.py`) is placed
on the recorded event it speaks to (`work/walkthrough-capture.json` marks),
never before the line ahead of it has ended. The run is slowed to half speed
through the cutting so the narration fits the moment it describes. Placements:
`work/walkthrough-voice.json`; captions: `walkthrough/walkthrough.srt` and
`.vtt`.
