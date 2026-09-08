# CONTINUA — design specification

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
converging on a single gateway node — carrying link solid, pre-warming link
dashed, available links faint, out-of-coverage greyed. Wired only appears while
the rover is physically tethered.

**2. The reference's numbers are design content, not results.**
`-67 dBm`, `24 ms`, `0.01 %`, `99.99 %`, `96 score` are illustrative. Phase 1
has no measurement engine, so the dashboard shows the quantities that genuinely
exist — modelled coverage, route progress, planned handoffs, speed, heading —
and every panel carries a `SCENE PREVIEW` badge. No dBm, no latency, no loss
figures are invented anywhere.

## 3. Tokens

Defined once in `packages/scene/src/theme.ts` and mirrored as CSS custom
properties in `apps/web/src/app/globals.css`.

### Colour — interface

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#F7FAFF` | page ground |
| `surface` | `#FFFFFF` | panels |
| `surface-muted` | `#F1F5FC` | inset blocks, hover |
| `ink` | `#14213D` | headings and body |
| `muted` | `#667593` | secondary labels |
| `line` | `#E2E9F5` | hairline borders |
| `cyan` | `#12B9E8` | wired and Wi-Fi |
| `blue` | `#176BFF` | primary accent, 5G |
| `violet` | `#7C3CFF` | satellite |
| `good` | `#12B981` | session continuity |
| `warn` | `#F59E0B` | the preview badge |

### Colour — scene

Deliberately desaturated and a step darker than the UI so the white vehicle
stays the brightest object in frame.

| Token | Value | Use |
| --- | --- | --- |
| `sky` / `skyHorizon` | `#EDF3FD` / `#FBFCFE` | vertical sky gradient |
| `fog` | `#EEF3FB` | atmospheric depth, 320 m → 1750 m |
| `groundNear` | `#BAC7DC` | engineered ground at the facility |
| `groundFar` | `#CFC0A4` | sand out in the remote sector |
| `groundHigh` | `#E3D9C6` | sunlit high ground |
| `road` | `#7F8CA3` | carriageway |
| `roadEdge` | `#B4BFD1` | shoulder |
| `apron` | `#AEBBCE` | facility apron, terminus pad |
| `grid` | `#7C93B6` | survey wireframe |
| `ridge` / `ridgeFar` | `#BAC8DE` / `#D3DDEC` | distant silhouettes |

### Spacing, radius, type

* Spacing scale: `4, 8, 12, 16, 24, 32`.
* Radii: panel `18px`, control `10px`, pill `999px`.
* Type: system sans stack (no webfont fetch, so the build works offline);
  `ui-monospace` for identifiers and timestamps. Panel labels are 10.5 px, 600
  weight, `0.09em` tracking, uppercase. Body 12–14 px. The header display size
  is `clamp(30px, 4vw, 52px)`.
* Numerals use `font-variant-numeric: tabular-nums` so readouts do not jitter.
* Shadows: `0 1px 2px rgb(20 33 61 / .04), 0 8px 24px -12px rgb(20 33 61 / .12)`.

## 4. Scene art direction

* **Soft daylight.** One directional key at intensity 0.95 whose shadow frustum
  follows the rover, a hemisphere fill at 0.30, ambient at 0.05, and a locally
  generated environment map built from three `Lightformer`s — no HDR download,
  so the scene renders identically offline. Tone mapping ACES at exposure 0.88.
* **Pale terrain** with a subtle triangulated survey wireframe laid exactly on
  the surface, and low-poly ridge silhouettes far beyond the playable bounds.
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
| **Route** — where the rover drives | A physical road ribbon on the terrain, with shoulder and centre line |
| **Coverage** — where a network is available | Translucent ground footprints, off by default, toggled per session |
| **Active link** — what carries the session | One bright arced beam from the rover's roof mast to the serving site |

Pre-warming links use the same beam form, dashed and at 40 % opacity. The wired
tether sags *downward* like a cable; radio links bow *upward*.

## 5. Rules this project will not break

* No dark cyberpunk treatment.
* No heavy bloom, no neon spaghetti, no random particles.
* No giant floating labels, no illegible glass panels.
* No decorative metric that is presented as a measurement.
* Nothing that implies packets travel through all four networks in series.
