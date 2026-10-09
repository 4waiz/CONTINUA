# CONTINUA - design specification

Reference analysis and the token set derived from it.

## 1. The references

Saved in `assets/reference/`:

| File | What it is | How it was used |
| --- | --- | --- |
| `continua-dashboard-light.png` | The primary light-mode dashboard mock (1591 KB, supplied by the user) | Layout, palette, panel language, header lockup |
| `continua-dashboard-dark.png` | The dark-mode variant of the same mock (1529 KB) | Confirmed which elements are structural vs. mode-specific |
| `continua-journey-banner.png` | Horizontal journey banner: city → facility → field → remote | The four-zone world layout and the rover's role |
| `continua-pipeline-5stage.png` | Observe → Predict → Prepare → Steer → Explain | Reserved for Phase 2; shaped the `Decision` contract |

**Light mode is the build target.** The dark variant is recorded for completeness
and is out of scope for Phase 1.

## 2. What the reference actually shows

Reading the light mock closely:

* A **header lockup**: "CONTINUA" set large in a blue→violet gradient, subtitle
  "Predictive Network Continuity" beneath, "by Team Kanban" in blue, then the
  tagline with "doesn't." emphasised. A thin vertical gradient rule on the left.
* A **left rail** of three metric cards (signal quality, latency, packet loss),
  each with a label, a large number, a qualitative word, and a small chart.
* A **centre stage**: four network nodes in circles above a hero vehicle in a
  pale landscape, with a caption strip underneath.
* A **right rail**: a QoS donut, a telemetry line chart, and a "live feed" tile.
* A **footer strip** of four capability blurbs.
* Palette: white and very pale blue/lilac grounds, dark-navy type, cyan →
  electric blue → violet accents. Generous radii, hairline borders, shadows so
  soft they read as elevation rather than drop shadow.

### Two deliberate departures

**1. The four networks are drawn as a fan, not a chain.**
The reference joins Wired → Wi-Fi → 5G → Satellite with a single flowing line,
which reads as a sequence packets traverse. They are not: they are four
*alternative* links to one session gateway, and exactly one carries the session
at a time. `apps/web/src/components/LinkFan.tsx` draws four candidates
converging on a single gateway node - carrying link solid, pre-warming link
dashed, available links faint, out-of-coverage greyed. Wired only appears while
the rover is physically tethered.

**2. The reference's numbers are design content, not results.**
`-67 dBm`, `24 ms`, `0.01 %`, `99.99 %`, `96 score` are illustrative. Phase 1
has no measurement engine, so the dashboard shows the quantities that genuinely
exist - modelled coverage, route progress, planned handoffs, speed, heading -
and every panel carries a `SCENE PREVIEW` badge. No dBm, no latency, no loss
figures are invented anywhere.

## 3. Tokens

Defined once in `packages/scene/src/theme.ts` and mirrored as CSS custom
properties in `apps/web/src/app/globals.css`.

### Colour - interface

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#F7FAFF` | page ground |
| `surface` | `#FFFFFF` | panels |
| `surface-muted` | `#F1F5FC` | inset blocks, hover |
| `ink` | `#14213D` | headings and body |
| `muted` | `#667593` | secondary labels |
| `line` | `#E2E9F5` | hairline borders |
| `cyan` | `#12B9E8` | wired and Wi-Fi |
| `blue` | `#176BFF` | primary accent, cellular |
| `violet` | `#7C3CFF` | satellite |
| `good` | `#12B981` | session continuity |
| `warn` | `#F59E0B` | the preview badge |

### Colour - scene

A green coastal island on a clear day: meadow greens, white beaches, a
turquoise-to-sapphire sea under a deep blue sky with fair-weather cumulus, and
flowering trees for colour. Colourful but natural and light - the white rover
is still the cleanest object in frame, and the interface's cyan / blue / violet
still read as the network's colours, not the landscape's. (Phase 8 replaced the
original pale desert at the owner's request.) Values live in `SCENE_COLOR`
(`packages/scene/src/theme.ts`).

| Token | Value | Use |
| --- | --- | --- |
| `sky` / `skyHorizon` | `#3F8EDC` / `#D8EAF8` | sky shader zenith and horizon |
| `sun` | `#FFF2DC` | key light colour |
| `fog` | `#D3E5F5` | coastal haze, 320 m → 2400 m (the camera's far plane: sea meets sky without a seam) |
| `campus` | `#76A74B` | mown campus lawn, striped |
| `grass` / `grassLush` / `grassDry` / `heath` | `#79A24C` / `#557F39` / `#B9B76C` / `#8C8D5E` | meadow patchwork |
| `flowerA`–`flowerD` | `#F2C230` / `#F4F1EA` / `#C46BD8` / `#F07A8E` | wildflowers in the meadow shader |
| `beach` | `#EEE3C6` | beach above the waterline, wet sand at it |
| `seaShallow` / `seaMid` / `seaDeep` | `#4FD6C8` / `#1AA6C8` / `#0F5E9C` | sea colour by water depth |
| `rockTint` | `#8D958C` | slopes and the headland's cliffs |
| `mountainFoot` / `mountainRock` | `#4E8A44` / `#8C9690` | near ranges: woods below, rock on the spurs |
| `mountainFar` / `mountainFarRock` | `#6F9C8C` / `#9FB0BB` | far ranges, blued by the haze |
| `concrete` / `apron` | `#C9CDD2` / `#C6CBD1` | building pads, aprons, terminus |
| `road` | `#4F5664` | asphalt carriageway |
| `roadEdge` / `roadLine` / `roadCentre` | `#B9B3A6` / `#F4F2EC` / `#F2C14E` | gravel shoulder, edge lines, dashed centre line |

### Spacing, radius, type

* Spacing scale: `4, 8, 12, 16, 24, 32`.
* Radii: panel and glass `18px`, control `10px`, row `12px`, pill `999px`.
* Type: system sans stack (no webfont fetch, so the build works offline);
  `ui-monospace` for identifiers and timestamps. Section labels are 11 px, 650
  weight, `0.085em` tracking, uppercase. Body 12–14 px. **Nothing on screen is
  smaller than 11 px** at any of the target viewports - `scripts/ui-screenshots.mjs`
  measures it.
* Numerals use `font-variant-numeric: tabular-nums` so readouts do not jitter.
* Shadows: `0 1px 2px rgb(20 33 61 / .04), 0 8px 24px -12px rgb(20 33 61 / .12)`.

## 4. Interface layout

One screen, no page scroll, at 1920×1080, 1440×900, 1366×768 and 1280×720.

* **Top bar** (60 px, 52 px under 800 px tall): the CONTINUA lockup, a
  segmented page switcher, and on run pages a compact run status (mode,
  connection, run id).
* **Immersive pages** (Mission, Scenario Lab, Scene Lab) put the 3D scene edge
  to edge under the bar. Everything else floats over it on `.glass` surfaces -
  90 % white behind the text, so contrast never depends on what the scene shows
  underneath:
  * a left column (links, or scenario set-up), a right column (application
    health and camera, or the run summary), each scrolling on its own;
  * a bottom **dock** with the run controls and a timeline painted with the
    link that carried the session over time, with decision ticks;
  * small HUD chips top-centre: what the scene is (run, replay or preview), the
    zone, the carrying link; a toast when a handoff happens.
* **Document pages** (Experiments, Decision Log) keep white panels on the page
  ground, one header strip each instead of a toolbar plus a row of stat cards.
* Sections inside one surface are separated by hairlines, not nested cards.
  Nested cards were most of what made the earlier dashboard read as bloated.

### Mission's three moods

* **Landing.** A still island - the scene's clock held, nothing moving until
  asked - and one card: what this is in two sentences and one button, **Drive
  it yourself**. An earlier landing offered a story and a drive side by side
  over a scene already driving itself; it read as something that had started
  without the viewer.
* **Drive.** The button starts the run that shows what CONTINUA is for - the
  shadowed route, CONTINUA with its road map beside the normal rover - and the
  dock changes it from there: scenario, strategy, the normal rover beside it,
  Start run, the road strip where it has something to show (a scenario with a
  cutting, or the road-map strategy), the transport and a timeline with **key
  moments**. Plain words by default; **Details** brings back the access-link
  figures, the application-health card, the control-mode chips, the pipeline,
  the timeline's colour key and each rover's total time offline.
* **Story** (`/?story`, the link to send someone). The one-minute film of the
  run (`mission/StoryFilm.tsx`); its "Replay it in 3D" plays the same run as a
  guided minute (`mission/story.tsx`): five chapters in one bar - a progress
  line, one caption read aloud, the transport - in real time but for the
  cutting, played at half speed under a "Slow motion · ½×" label, ending on the
  stored twenty-drive comparison as one plain bar a strategy.
* **The picture clears the panels.** The page measures how much of the stage
  its top cards and its dock cover and hands that to the scene, whose cameras
  shift the lens (`setViewOffset`) so what they frame sits in the middle of
  what is left - the same shot, not a different one. The follow and approach
  rigs aim a few metres ahead of the rover rather than far up the road, so it
  stands in the clear band at 1280 x 720 as at 1920 x 1080.
* **A paused video is not a lost link.** In the operator views a stream that
  has stalled for over a second while its link holds is amber, "VIDEO
  PAUSED", with "satellite delay" under it when the video rides the satellite
  path, whose round trip leaves most frames too late to show; a shorter stall
  shows only as the picture stuttering, not as a badge that blinks with every
  late frame. A rover with no link is red, "LINK LOST", at once ("STALLED · n
  ms", the receiver's flag as it is, and "SESSION DOWN" in Details).
* **The end of a run, in words.** One card per rover - kept its connection or
  lost it, seconds without a link, whether it had to stop - then how often each
  changed network and what each sent over satellite, whichever way those fall,
  and on the featured run what the stored comparison found. The table is under
  Details.

### Showing a change of network

When the carrying network changes, the follow and close-up cameras turn to
where the new link comes from - the access point, the mast, or the sky the
satellite link climbs into - hold it for 2.6 s, and come back, easing in and
out. The camera stands back from the rover, low, part-way between behind it
on the road and over its shoulder away from the far end, so the rover and the
far end line up near the middle of the screen; near a cutting, and for
satellite, it keeps to the road, clear of the walls. A change that comes while
the last is still on screen takes over from it. All of it is a function of
the run's time and its recorded changes, so a scrubbed or captured frame is
the frame that plays.

### The voice

The page says what changed, word for word what the screen says: driving, the
handoff toast ("Moved to Satellite"), the road strip's warning ("Gap ahead:
getting satellite ready") and the status cards ("Normal rover: connection
lost") - short, so a run of changes close together, as at the cutting, is
still said as it happens; in the story, each caption and the proof card.
One line at a time, never cut off; a caption replaces a caption still
waiting, an announcement waits its turn unless it has waited eight seconds,
and "connected again" withdraws a "connection lost" that was never said. The
lines are recorded ahead of time (`npm run voice:lines`, `npm run
voice:build`); a line with no recording is read by a local browser voice, or
not at all. A speaker button in the dock and the story bar turns it off.

### Plain words

Strategies are named for what they do ("Switch after it breaks", "CONTINUA +
road map", ids kept beside them); networks are Cable, Wi-Fi, Cellular,
Satellite; states are "Carrying the link", "Ready as backup", "Starting up",
"Out of reach". A decision becomes a sentence built from the event's own
actions and reason (`mission/plain.ts`) - nothing added; the engine's wording
is in each line's tooltip and in the Decision log.

### The road strip

The route as one strip: where the radio map the policy uses expects Wi-Fi,
cellular and satellite (`GET /api/radio-maps/{id}`, available where under half
of survey samples were unusable), the scenario's cuttings hatched, the rover,
and - for the route-aware policy - its 8 s look-ahead, violet with "Gap ahead:
getting satellite ready" while it is preparing. The zones are named on the
route card, not again beneath the strip.

## 5. Scene art direction

* **Clear, warm daylight.** A sun key at intensity 3.0, 41° up over the sea -
  mid-morning, so every building, tank and tree throws a shadow long enough to
  give the ground form - a hemisphere fill at 0.5 (sky above, meadow bounce
  below), and an environment map rendered at runtime from the same procedural
  sky shader the background uses, cumulus included (`scene.environmentIntensity`
  0.38) - no HDR download, so the scene renders identically offline. Neutral
  tone mapping at exposure 0.92.
* **Stable shadows.** The 4096 / 2048 / 1024 shadow map (by quality tier)
  follows the rover with its frustum snapped to whole texels in light space, so
  shadow edges do not crawl as the camera moves. The rover also carries a soft
  procedural contact shadow.
* **Ground that reads as a place.** Terrain, road and concrete are procedural
  shaders: a mown, striped campus lawn; meadows in a field-scale patchwork with
  wildflowers that resolve into single blooms close up; rock on steep slopes;
  a beach and wet sand at the waterline; an asphalt road with edge lines, a
  dashed centre line and wheel-path wear over a gravel shoulder; jointed
  concrete pads under every building, and service roads to each one. Grass
  tufts, flowering tufts and gravel fringe the open road, swaying with the
  scene clock.
* **An island.** The land is a broad island: sea along the south shore, a
  headland past the ground station, a strait to the north, the town on the
  west coast, every shore at least a hundred metres from the route. The sea's
  colour comes from the water depth under each point (the island's heights,
  sampled once), turquoise over the shelf to sapphire offshore, with surf that
  breathes at the waterline and waves that are a function of the scene clock.
  Mountain ranges across the water are solid, sunlit bands - woods and rock
  near, haze-blue far - and the south is left open to the horizon. The road
  ends in a turning circle on a concrete forecourt in front of the ground
  station, its edge line carried round the circle.
* **A start, not a parking space.** Every run starts at the rover's dock: a
  charcoal bay with its number painted on it, under a launch gantry whose
  status line is red while the rover stands in the bay and green once it has
  pulled out (a function of the rover's distance, so still of the clock), in
  a kerbed concrete yard between the operations centre's forecourt, the
  gateway yard and the rover's garage, whose door opens onto it. The campus
  road leaves the yard through a bell-mouth, its edge lines carried in across
  the yard to the bay's front corners. Every paved surface that meets grass
  has a kerb (`world/kerbs.ts`).
* **Glass you can see into.** Office glazing mirrors the sky, more toward a
  grazing angle, and behind it each pane shows a room found by interior
  mapping (`windows.ts`): floor, ceiling light, a back wall with desks and
  screens, blinds part-drawn, a few rooms dark; the response station's bays
  hold their appliances. Rooms are laid out in each building's own frame with
  its storey heights, so a floor never crosses a window; they fade to an
  average before they are small enough to shimmer. No geometry, no texture;
  the low tier draws the plain tinted glass.
* **Grounded, not pasted.** Ground-truth ambient occlusion on the high tier
  darkens wherever one object meets another, and a soft occlusion footprint
  under every solid building darkens the ground around it; baked AO already
  shades each object's own creases.
* **A world with a job.** An operations campus (operations centre, gateway
  hall, hangar, response station, gatehouse, carports), an industrial corridor
  (halls, tank farm, pipe rack, stack, substation, pylons), and a remote sector
  (ground station, pipeline and valve station, solar, an offshore wind farm),
  a waterfront (a lighthouse on the headland, a jetty with a moored rescue
  boat, lifeguard towers, yachts and a rescue boat on slow fixed courses that
  ride the swell as a function of the scene clock), dressed with palms,
  broadleaf woods, scarlet flame trees, violet jacarandas, bougainvillea in
  four colours and bedding along the campus road. The full list is in
  `ASSET_MANIFEST.md`.
* **An opening worth staying for.** With no run, Mission plays the preview
  behind its introduction under a director's cut that begins with an aerial of
  the whole island and descends to the rover; soft cloud shadows drift over
  land and sea.
* **A cutting where the scenario has one.** The five `shadow-*` scenarios
  shadow the radio links over stretches of route; the world stands what that
  stands for there and only there (`world/deadZones.ts`, `DeadZone.tsx`):
  grassed banks drawn with the ground's own shader, held back by precast
  retaining panels with stepped wings, a worn hazard band at the road face and
  chevrons on the ends, open to the sky so the satellite still sees the rover.
  The lane stops at the gatehouse canopy; the bedding it would cut is left out.
* **Forest on the ranges.** The near range carries some twelve thousand
  instanced crowns in stands, on forested ground on the island-facing faces,
  leafy-shaded and in sixteen culled sectors; the faces between them have
  knolls, stands of a yellower or bluer green, and bedded rock.
* **A light grade.** After the AO pass, on the display image: a soft S-curve,
  a little more colour in the mid-tones, sun-warm light over sky-cool shade,
  a soft vignette. Clouds drift on the same breeze as their shadows.
* **Restraint.** No bloom, no god rays, no particles, no floating labels over
  the vehicle. Infrastructure is marked with a thin ground ring that only grows
  a vertical stem when selected.
* **The vehicle is the hero.** It is the only pure-white object, the only one
  with clearcoat, and the only one carrying saturated accents.

### The three-concept separation

Kept visually distinct at all times, because conflating them is the fastest way
to make a network diagram meaningless:

| Concept | How it is drawn |
| --- | --- |
| **Route** - where the rover drives | A physical road ribbon on the terrain, with shoulder and centre line |
| **Coverage** - where a network is available | Translucent ground footprints, off by default, toggled per session |
| **Active link** - what carries the session | One bright arced beam from the rover's roof mast to the serving site |

The carrying beam fades from full colour at the rover to a pale tint at the
site, with a faint wide halo, so a beam to a distant tower reads as a link
rather than a line slashed across the frame. A handoff is drawn, not swapped:
the new link reaches out from its site to the rover behind a bright head, the
link it replaced fades out as a ghost, and the site and the rover's antenna
ping - all as a pure function of the clock and the recorded handoff time. Small packets travel along it toward the rover as a pure
function of the scene clock - they show direction, not a measured rate.
Pre-warming links use the same beam form, dashed, thinner, pulsing between
30 % and 70 % opacity - the moment the story points at has to be seen. The wired
tether sags *downward* like a cable; radio links bow *upward*.

A **satellite** link is served from the sky, not from a site on the ground, and
is drawn that way: a straight beam rises from the rover's roof toward the
satellite - due south, 45 degrees up, the side of the sky a geostationary
satellite holds - and a second rises from the ground station's dish, which is
built pointing there, its gateway end. Both fade into the sky; while the
satellite carries or warms, a small violet mark sits where they meet.

### Cameras

Follow, overview and close-up for working; a **cinematic** director for
showing - follow, side tracking, a high orbit, a low lead shot looking back up
the road, and a crane - eased into one another, and still a pure function of
time. The preview opens on it; a run switches to follow, which keeps the link
beams in frame.

## 6. Rules this project will not break

* No dark cyberpunk treatment.
* No heavy bloom, no neon spaghetti, no random particles.
* No giant floating labels, no illegible glass panels.
* No decorative metric that is presented as a measurement.
* Nothing that implies packets travel through all four networks in series.
