# CONTINUA - "Watch the story" film (brag plan)

**Length:** 59.5 s, 1920×1080, 30 fps. The site's button promises "1 min", so this
runs longer than a usual 20 s brag on purpose.
**Where it plays:** the "Watch the story · 1 min" button on the Mission landing
page of continua.kanbanstudios.ae, and anywhere the team shares it.
**Tone:** polished, light and calm. Daylight, white glass panels and the
brand gradient, with no cyberpunk styling, the same look as the product.

## What it is, for a stranger

- **What:** CONTINUA keeps a remote-driven rover's link to its operator alive
  as it moves between cable, Wi-Fi, cellular and satellite. It prepares the
  next network *before* the current one fails.
- **Who for:** people who drive emergency-response and inspection vehicles
  from far away.
- **What sets it apart:** a road map of where coverage drops. It warms up
  satellite before a dead zone instead of after the link has gone.
- **Strongest true claim:** on the same road and signal, driven 20 times, it
  kept the link in 20 of 20 drives. The rover that switches only after a
  failure kept it in 0 of 20.
- **Visual hook:** the island from the air, then the real app replaying a
  recorded run with the two rovers' link states side by side.
- **Share line:** "Two rovers, one dead zone. One keeps its operator, one has
  to stop."

## Angle

**Same road, same moment, one difference.** Every frame is the real app
replaying two recorded runs. The edit adds only framing, the captions the
app computed for those frames, and the stored 20-drive result.

- **Hook (0-5.5 s):** the island from the air, then "The network changes."
  followed by "The session doesn't."
- **Highlights:** off the cable with no gap while the normal rover drops; the
  road map seeing the cutting 79 m out; through the cutting on satellite while
  the normal rover stops.
- **Punchline:** 20 of 20 drives with the link kept, at about a third of the
  cost of keeping every network on. The film also says, on screen, that one
  rival did it for less.

## Storyboard

Times are film seconds. Footage is captured frame-exact from the public build
(`work/capture-story.mjs`): fake clock, one animation frame per film frame,
RTX 5080 at the high quality tier. Story footage shows the scene, the two
status panels and the operator views. The site header and the app's small
caption bar are hidden; the same captions are set larger by the edit.

| # | Film | Source frames | What is on screen | Words |
|---|---|---|---|---|
| 1 Hook | 0.0-5.5 | landing 30-194 | Island aerial. Kicker "CONTINUA · Predictive Network Continuity". "The network changes." then "The session doesn't." in the brand gradient | title 6 words, 3 s+ |
| 2 Leaving the dock | 5.5-14.1 | story 140-398 | Rover leaves Dock 01. App caption A, then B at the handoff. The normal rover's panel turns red for a moment (story 284-310). Badge "Software simulation · replay of recorded runs" from here on | A 14 words, 4.8 s; B 11 words, 3.8 s |
| 3 Two rovers | 14.1-21.6 | story 440-664 | Alongside shot. A ring draws the eye to the two status panels | 21 words, 7.5 s |
| 4 A dead zone ahead | 21.6-28.5 | story 671-876 | Crane shot toward the cutting. Caption with the road map's "79 m out" | 20 words, 6.9 s |
| 5 Through the cutting | 28.5-35.7 | story 904-1118 | Slow-motion ½× chip. Violet satellite beam. CONTINUA "Connected via Satellite"; normal rover "Connection lost", then "the rover has stopped safely". Operator views: "VIDEO PAUSED" next to "LINK LOST" | 22 words, 7.2 s |
| 6 Verdict | 35.7-41.1 | story 1195-1358 | Real time again. Two big lines: green "CONTINUA never lost its link." and red "The normal rover was cut off for 4.5 s and had to stop." | 5 + 12 words, 5.4 s |
| 7 The proof | 41.1-48.5 | story 1380-1599 | The app's real proof card, zoomed: five strategies × 20 drives, with "kept the link" and cost for each | card text |
| 8 Statement | 48.5-54.5 | orbit 0-179 (blurred) | "20 of 20 drives. Link kept." then "At about a third of the cost of keeping every network on." Fine print: the rival that did it for less, start-up, source | 6 + 12 words, 6 s |
| 9 Outro | 54.5-59.5 | orbit 180-299 + hold | Wordmark, tagline, "Predictive Network Continuity · by Team Kanban", continua.kanbanstudios.ae, "A software simulation. Every figure comes from recorded runs." | 5 s |

Transitions: a dip through the page colour from the hook into the story, and
from the proof into the statement. Hard cuts between chapters, each with a soft
whoosh; caption text drops in (the app's `drop-in` motion). The statement
and outro share one continuous orbit shot.

## Claim ledger - every figure and claim on screen

| Claim | Source | Status |
|---|---|---|
| Captions in chapters 1-5, including "79 m out", "never lost its link" and "cut off for 4.5 s and had to stop" | Computed by the app's story director (`apps/web/src/components/mission/story.tsx`) from runs `run-2172746704` (P3) and `run-0cc2022cf4` (B0), shadow-survey, seed 70009, simulation. Read off the captured frames (`work/telemetry.json`) | measured (replay) |
| Link states in the status panels and operator views | The app's own panels, from the same two runs' events | measured (replay) |
| Slow motion ½× while it lasts | The story's own playback rate (`SLOW_MOTION = 0.5`), labelled on screen | presentation |
| Proof card: P3 20/20, cost 1.58; P1 0/20, 1.58; B0 0/20, 6.75; B2 20/20, 5.02; B2-defer 20/20, 1.16 | `apps/web/public/demo/experiments/phase5-test4-shadow-survey.json`, test4 seed block, 20 trials per policy, commit b54b28e. "Kept the link" = no session reconnect (`glanceRows`) | measured |
| "about a third of the cost of keeping every network on" | 1.58 / 5.02 = 0.31 (P3 vs B2 cost units, same experiment) | measured |
| "one rival did it for less" | B2-defer cost 1.16 < P3 1.58, also 20/20 | measured, shown |
| Start-up 0.16 s in every drive | `total_interruption_s` = 0.16 for P3, B2 and B2-defer; the session start-up seen in every policy | measured, footnoted |
| "A software simulation" | Every run's mode is `simulation`. There is no hardware, radio or satellite | stated on screen from 5.5 s to the end |

**Banned and not used:** 5G, MPTCP, live/real-time network, field test, real
satellite, guaranteed, zero downtime / no interruption, 99.99 %, AI decides,
production-ready. No number appears that is not in the table above.

## Visual identity

- Colours: page `#F6F9FF`, ink `#111D3A`, muted `#5D6B87`, line
  `rgb(90 110 160 / .14)`, good `#0DB982`, bad `#E5484D`, violet `#7A3CFF`.
  Brand gradient `#14B8E8 → #176BFF → #5156E8 → #7A3CFF`.
- Type: Segoe UI, the site's system stack on Windows. Titles 700 weight with
  tight tracking; small-caps kickers in blue.
- Panels: the app's `.glass` (white 90 %, 18 px radius, layered soft shadow)
  and its story-step progress bar, set larger for video.

## Sound

One piece in D major, 96 BPM (a bar is 2.5 s).

- **Hook:** an airy pad swells and a soft bell motif enters, rising into the
  first downbeat at 5.5 s.
- **Chapters 1-3:** a gentle pulse (soft kick, low eighth-note bass), plucked
  arpeggio, D-Bm-G-A.
- **Dead zone:** a filter opens and the pulse thickens.
- **Cutting (slow motion):** the music drops to a low, filtered half-time pad.
- **Verdict:** the full chord returns with a shimmer.
- **Proof and statement:** a steady groove.
- **Outro:** resolves on D with a reverb tail.

Effects are in key and sit under the music:

- Handoff chime (D-A) when CONTINUA moves to Wi-Fi (10.3 s) and to satellite
  (28.5 s).
- A muted low drop when the normal rover loses its link (10.3 s, 28.5 s) and a
  soft double tick when it stops (34.5 s).
- Whooshes on cuts.

## Voiceover script

Added at the team's request ("someone talking about the entire thing"). The
voice is Kokoro-82M with the `af_heart` voice, made locally through
`hyperframes tts` (`work/narration.py`). The lines add to the on-screen
captions rather than reading them out, except the opening tagline, which is
spoken with the title. Each line fits inside its shot; no line runs over a cut.

| Line | Film (s) | Speed | Text | Claim |
|---|---|---|---|---|
| n1a | 0.35-1.64 | 1.00 | The network changes. | tagline |
| n1b | 1.90-2.98 | 1.00 | The session doesn't. | tagline |
| n1c | 3.35-5.31 | 1.00 | Here's CONTINUA in simulation. | every run is `simulation` |
| n2 | 5.95-12.37 | 1.00 | Leaving the dock, CONTINUA slides from cable to Wi-Fi without a gap. The rover beside it isn't so lucky. | P3 had less than 0.05 s offline at the handoff (app caption); B0's panel shows "Connection lost" (story frames 284-310) |
| n3 | 14.45-20.99 | 1.00 | The other rover has no CONTINUA. Same road, same signal. It only switches after its network fails. | B0 switches only on measured unusability; same seed 70009 |
| n4 | 21.95-28.17 | 1.05 | CONTINUA's road map shows where coverage drops. Seventy-nine metres out, it starts warming up satellite. | P3's decision reason: "79 m ahead" |
| n5 | 28.85-34.93 | 1.00 | In the cutting, CONTINUA is already on satellite. The other rover loses its link, and has to stop. | status panels: P3 via Satellite; B0 "Connection lost", then "stopped safely" |
| n6 | 35.95-40.09 | 1.00 | One operator kept the link. The other was cut off for four and a half seconds. | app caption: "never lost its link" / "cut off for 4.5 s" |
| n7 | 41.95-52.99 | 1.00 | One run could be luck, so every strategy drove this road twenty times. With its road map, CONTINUA kept the link every time, at about a third of the cost of keeping every network on. | phase5-test4-shadow-survey: P3 20/20, cost 1.58; B2 cost 5.02 |
| n8 | 54.85-58.51 | 1.00 | CONTINUA. Predictive network continuity, by Team Kanban. | sign-off |

**Mix.** Music ducks to 0.15 under the voice and effects to half. Lines less
than 0.6 s apart share one duck, so the music never pumps between sentences.
It breathes back up at the "Two rovers" cut, the dead-zone cut, the verdict,
the proof and the outro. The voice passes a gentle compressor; the master
passes a limiter and a linear loudness normalisation to −15.9 LUFS, true peak
−2.0 dBTP. Captions for the voice: `work/story.vtt`, shipped as
`apps/web/public/video/story.vtt`.

## Music cue guidance

No bundled track: the music is synthesised for this cut (`work/audio.py`),
with section changes placed on the edit points above.
