# Composition brief - CONTINUA intro (HyperFrames)

**Product.** CONTINUA - Predictive Network Continuity, by Team Kanban. A 3D
mission view of two rescue rovers on one island road through cable, Wi-Fi,
cellular and satellite. One runs CONTINUA and readies the next network before
the current one fails; the other switches only after its network breaks.

**Angle.** "Watch the network change." At every handoff the app's camera flies
out to where the new link comes from, then rides the beam back to the rover.
Then the viewer gets the wheel. The edit frames real footage; it never fakes it.

**Format.** 1920x1080, 30 fps, 29.4 s (hard cap 30 s). Landscape. Replaces
`apps/web/public/video/story.mp4` (the landing's "Watch the intro · 30 s").

**Tone.** Cinematic preset, refined: a calm, confident mission-control trailer
in daylight. Not cyberpunk - no neon, no bloom, no particles. Big sparse type
that holds; slow pushes; soft dips to the page colour between acts.

## Source footage

All footage is the public build (`apps/web` static export) captured frame by
frame with a fake clock - every frame deterministic, nothing composited into the
3D scene.

| File | What | Used |
|---|---|---|
| `assets/footage/aerial.mp4` | The landing's island from the air, card hidden | hook; blurred under proof and outro |
| `assets/footage/walk.mp4` | The full 115 s walkthrough capture | flight, dead zone, satellite, driving |

Windows into `walk.mp4` come from the capture's own event marks
(`work/walkthrough-capture.json`): flight from `wifi - 0.3`, banner from
`warning - 0.25`, satellite from `satellite - 0.35`, driving from `wheel + 0.25`.

## Scenes

| # | Window | Picture | Overlay |
|---|---|---|---|
| 1 | 0-3.6 | aerial, 7 % push | kicker, "The network changes." / "The session doesn't." (gradient) |
| 2 | 3.6-10.4 | the Wi-Fi handoff flight | lower-third card: "Every handoff, shown" / "From Wi-Fi access point A, down the beam, to the rover" |
| 3a | 10.4-13.3 | "Dead zone 79 m ahead" banner | violet ring on the app's banner |
| 3b | 13.3-17.9 | satellite view over the cutting | rings on both status cards; status card "on satellite, still connected" / "cut off, has to stop" |
| 4 | 17.9-21.9 | "You're driving" | "Take the wheel" + W A S D caps lower right, lit as named |
| 5 | 21.9-26.2 | aerial, blurred and tinted | "20 of 20 drives. Link kept." / "The normal rover: 0 of 20." + experiment fine print |
| 6 | 26.2-29.4 | aerial, blurred and tinted | wordmark, tagline, "by Team Kanban", URL pill, fine print |

## Visual identity

Page `#F6F9FF`; glass surfaces white at 93 %; ink `#111D3A`; muted `#5D6B87`;
accent `#176BFF`; kicker `#1460E6` (AA on glass); brand gradient
`#14B8E8 -> #176BFF -> #5156E8 -> #7A3CFF`; good `#0DB982`, bad `#E5484D`,
satellite violet `#7A3CFF`. The edit's own type is Inter, named outright so
HyperFrames embeds it and the preview and the render set the same lines (left
to `system-ui`, the render substituted Inter and the title wrapped onto three
lines); the app's interface in the footage is Segoe UI, the capture machine's
system font.

## Audio

- **Voice.** Chatterbox (Resemble AI, local), in a voice cloned from a Kokoro
  `am_michael` clip - every take transcribed and checked against the script
  (`work/voice.py`, `work/voice_cb.py`) - one clip a line
  (`assets/vo/i1..i6.wav`), lines and windows in `brag-plan.md`.
- **Bed.** `happy-beats-business-moves-vol-12` at 0.30, ducked to 0.13 under
  each line by a `data-automation` volume lane, faded over the last 1.4 s.
- **SFX.** Sparse: drop on the title (1.6 s), one click per key cap, a soft
  impact on the proof number (22.33 s, beat-locked), a bell on the wordmark.
- **Audio-reactive.** The halo behind the proof and wordmark samples the bed's
  pre-extracted RMS and bass, one `tl.call` a frame. No equaliser bars.

## Truth rules (the project's hard rules)

- Every figure traces to the claim ledger in `brag-plan.md`. 20 of 20 and 0 of
  20 are `phase5-test4-shadow-survey`, 20 paired drives.
- Say "software simulation" and "recorded runs" on screen. Never 5G, MPTCP,
  live network, field test, or guaranteed.
- The camera flight and the driving are the app's own features, captured, not
  animated in the edit.

## Runtime

One paused GSAP timeline at `window.__timelines["main"]`; clips by
`data-start` / `data-duration` / `data-media-start`; no `Date.now()`, no
`Math.random()`. Gate: `npx hyperframes check` - 0 errors, contrast 15/15.
