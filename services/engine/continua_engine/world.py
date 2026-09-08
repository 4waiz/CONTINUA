"""
The world, as the engine sees it.

Reads `packages/contracts/world.json` — the same file `packages/scene` reads —
so the route the vehicle drives in the browser and the route the simulator
measures coverage along are the same route. `tests/engine/test_route_parity.py`
asserts both implementations agree on the arc length.

Nothing here is a measurement. The coverage model is geometric and synthetic;
its parameters live in the JSON, are documented in `docs/ASSUMPTIONS.md`, and
are labelled `modelled_coverage` everywhere they surface.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .contracts import ALL_LINKS, LinkId


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


WORLD_PATH = _repo_root() / "packages" / "contracts" / "world.json"


@lru_cache(maxsize=1)
def world_spec() -> dict:
    with WORLD_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RouteSample:
    distance: float
    x: float
    z: float
    tx: float
    tz: float
    heading: float
    curvature: float


def _catmull_rom(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def _angle_delta(a: float, b: float) -> float:
    d = (b - a) % (2 * math.pi)
    if d > math.pi:
        d -= 2 * math.pi
    if d <= -math.pi:
        d += 2 * math.pi
    return d


class Route:
    """Catmull-Rom spline resampled at a constant arc-length step.

    Deliberately mirrors `packages/scene/src/world/route.ts` step for step —
    same tessellation count, same resampling, same central-difference tangents —
    because the two must agree on what "distance 412 m" means.
    """

    def __init__(self, spec: dict | None = None) -> None:
        route_spec = (spec or world_spec())["route"]
        points: list[tuple[float, float]] = [tuple(p) for p in route_spec["controlPoints"]]
        self.step = float(route_spec["sampleStepM"])
        dense = self._tessellate(points, int(route_spec["stepsPerSegment"]))
        self.samples = self._resample(dense, self.step)
        self.length = self.samples[-1].distance if self.samples else 0.0

    @staticmethod
    def _tessellate(points: list[tuple[float, float]], steps_per_segment: int) -> list[tuple[float, float]]:
        out: list[tuple[float, float]] = []
        n = len(points)
        for i in range(n - 1):
            p0 = points[max(0, i - 1)]
            p1 = points[i]
            p2 = points[i + 1]
            p3 = points[min(n - 1, i + 2)]
            last = steps_per_segment if i == n - 2 else steps_per_segment - 1
            for s in range(last + 1):
                t = s / steps_per_segment
                out.append(
                    (
                        _catmull_rom(p0[0], p1[0], p2[0], p3[0], t),
                        _catmull_rom(p0[1], p1[1], p2[1], p3[1], t),
                    )
                )
        return out

    @staticmethod
    def _resample(dense: list[tuple[float, float]], step: float) -> list[RouteSample]:
        cumulative = [0.0]
        for i in range(1, len(dense)):
            dx = dense[i][0] - dense[i - 1][0]
            dz = dense[i][1] - dense[i - 1][1]
            cumulative.append(cumulative[i - 1] + math.hypot(dx, dz))
        total = cumulative[-1]
        count = max(2, int(total / step) + 1)

        positions: list[tuple[float, float]] = []
        cursor = 0
        for i in range(count):
            target = (i / (count - 1)) * total
            while cursor < len(cumulative) - 2 and cumulative[cursor + 1] < target:
                cursor += 1
            seg = cumulative[cursor + 1] - cumulative[cursor]
            t = (target - cumulative[cursor]) / seg if seg > 1e-6 else 0.0
            positions.append(
                (
                    dense[cursor][0] + (dense[cursor + 1][0] - dense[cursor][0]) * t,
                    dense[cursor][1] + (dense[cursor + 1][1] - dense[cursor][1]) * t,
                )
            )

        raw: list[RouteSample] = []
        distance = 0.0
        for i, (x, z) in enumerate(positions):
            prev = positions[max(0, i - 1)]
            nxt = positions[min(len(positions) - 1, i + 1)]
            dx = nxt[0] - prev[0]
            dz = nxt[1] - prev[1]
            norm = math.hypot(dx, dz) or 1.0
            tx, tz = dx / norm, dz / norm
            heading = math.atan2(-tz, tx)
            if i > 0:
                distance += math.hypot(x - positions[i - 1][0], z - positions[i - 1][1])
            raw.append(RouteSample(distance, x, z, tx, tz, heading, 0.0))

        window = 4
        out: list[RouteSample] = []
        for i, sample in enumerate(raw):
            a = raw[max(0, i - window)]
            b = raw[min(len(raw) - 1, i + window)]
            ds = b.distance - a.distance
            curvature = _angle_delta(a.heading, b.heading) / ds if ds > 1e-6 else 0.0
            out.append(
                RouteSample(sample.distance, sample.x, sample.z, sample.tx, sample.tz, sample.heading, curvature)
            )
        return out

    def at(self, distance: float) -> RouteSample:
        clamped = min(max(distance, 0.0), self.length)
        index = min(max(int(clamped / self.step), 0), len(self.samples) - 2)
        a = self.samples[index]
        b = self.samples[index + 1]
        span = b.distance - a.distance
        t = (clamped - a.distance) / span if span > 1e-6 else 0.0
        return RouteSample(
            clamped,
            a.x + (b.x - a.x) * t,
            a.z + (b.z - a.z) * t,
            a.tx + (b.tx - a.tx) * t,
            a.tz + (b.tz - a.tz) * t,
            a.heading + _angle_delta(a.heading, b.heading) * t,
            a.curvature + (b.curvature - a.curvature) * t,
        )


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------


def _smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = min(max((x - edge0) / (edge1 - edge0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


class Coverage:
    """Geometric coverage 0..1 per link at a world position.

    This is a *model*, not a measurement, and the only place the simulator
    consults geography. The controller never calls it — it only ever sees
    statistics derived from delivered packets.
    """

    def __init__(self, spec: dict | None = None) -> None:
        spec = spec or world_spec()
        self.params = spec["coverage"]
        sites = spec["sites"]
        self.dock = next(s for s in sites if s["id"] == "dock")
        self.wifi = [s for s in sites if s.get("network") == "wifi"]
        self.cell = [s for s in sites if s.get("network") == "cellular"]
        self.zones = spec["zones"]

    def at(self, link: LinkId, x: float, z: float) -> float:
        p = self.params
        if link is LinkId.WIRED:
            d = math.hypot(x - self.dock["x"], z - self.dock["z"])
            return 1.0 - _smoothstep(p["tetherRangeM"] - p["tetherFullOffsetM"], p["tetherRangeM"], d)
        if link is LinkId.WIFI:
            best = 0.0
            for site in self.wifi:
                d = math.hypot(x - site["x"], z - site["z"])
                best = max(best, 1.0 - _smoothstep(p["wifiRangeM"] * p["wifiFullFraction"], p["wifiRangeM"], d))
            return best
        if link is LinkId.CELLULAR:
            best = 0.0
            for site in self.cell:
                d = math.hypot(x - site["x"], z - site["z"])
                best = max(best, 1.0 - _smoothstep(p["cellRangeM"] * p["cellFullFraction"], p["cellRangeM"], d))
            return best
        if link is LinkId.SATELLITE:
            ramp = _smoothstep(p["satelliteRampFromX"], p["satelliteRampToX"], x)
            return min(max(p["satelliteBase"] + ramp * p["satelliteRemoteBonus"], 0.0), 1.0)
        return 0.0

    def all_at(self, x: float, z: float) -> dict[LinkId, float]:
        return {link: self.at(link, x, z) for link in ALL_LINKS}

    def zone_at_x(self, x: float) -> str:
        for zone in self.zones:
            until = zone["untilX"]
            if until is None or x < until:
                return zone["id"]
        return self.zones[-1]["id"]


# ---------------------------------------------------------------------------
# Motion
# ---------------------------------------------------------------------------


class MotionProfile:
    """Distance travelled as a function of time.

    Integrated once, up front, into a table — the same approach Phase 1 uses in
    the browser — so the vehicle's position at time t is a lookup, not a
    stateful accumulation that could drift between a live run and its replay.
    """

    STEP = 0.05

    def __init__(self, route: Route, spec: dict | None = None, speed_scale: float = 1.0, reverse: bool = False) -> None:
        v = (spec or world_spec())["vehicle"]
        self.route = route
        self.reverse = reverse
        self.speed_scale = speed_scale
        self.cruise = v["cruiseSpeedMps"] * speed_scale
        self.curve_slowing = v["curveSlowing"]
        self.min_speed = v["minSpeedMps"] * speed_scale
        self.dwell = v["dockDwellS"]
        self.wheel_radius = v["wheelRadiusM"]

        table: list[float] = []
        distance = 0.0
        t = 0.0
        while distance < route.length and t < 4000:
            table.append(distance)
            speed = 0.0 if t < self.dwell else self.speed_at(distance)
            distance += speed * self.STEP
            t += self.STEP
        table.append(route.length)
        self.table = table
        self.duration = (len(table) - 1) * self.STEP

    def speed_at(self, distance: float) -> float:
        d = self.route.length - distance if self.reverse else distance
        sample = self.route.at(d)
        curve = 1.0 / (1.0 + abs(sample.curvature) * self.curve_slowing)
        launch = min(max(distance / 30.0, 0.25), 1.0)
        arrival = min(max((self.route.length - distance) / 45.0, 0.22), 1.0)
        return max(self.min_speed, self.cruise * curve * min(launch, arrival))

    def distance_at(self, t: float) -> float:
        clamped = min(max(t, 0.0), self.duration)
        index = min(max(int(clamped / self.STEP), 0), len(self.table) - 2)
        frac = clamped / self.STEP - index
        return self.table[index] + (self.table[index + 1] - self.table[index]) * frac

    def sample_at(self, t: float) -> tuple[RouteSample, float]:
        """Returns the route sample the vehicle is at, and its speed."""
        travelled = self.distance_at(t)
        along = self.route.length - travelled if self.reverse else travelled
        speed = 0.0 if t < self.dwell else self.speed_at(travelled)
        return self.route.at(along), speed
