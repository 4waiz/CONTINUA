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
  near, haze-blue far - and the south is left open to the horizon.
* **Grounded, not pasted.** Ground-truth ambient occlusion on the high tier
  darkens wherever one object meets another, and a soft occlusion footprint
  under every solid building darkens the ground around it; baked AO already
  shades each object's own creases.
* **A world with a job.** An operations campus (operations centre, gateway
  hall, hangar, response station, gatehouse, carports), an industrial corridor
  (halls, tank farm, pipe rack, stack, substation, pylons), and a remote sector
  (ground station, pipeline and valve station, solar, an offshore wind farm),
  dressed with palms, broadleaf woods, scarlet flame trees, violet jacarandas,
  bougainvillea in four colours and bedding along the campus road. The full
  list is in `ASSET_MANIFEST.md`.
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
Pre-warming links use the same beam form, dashed and at 45 % opacity. The wired
tether sags *downward* like a cable; radio links bow *upward*.

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
