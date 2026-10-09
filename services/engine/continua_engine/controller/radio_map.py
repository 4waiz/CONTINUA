# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-66A630FE1A58
"""
The radio map: what earlier drives of the route measured, by position.

A fleet that drives the same route learns where each network is unavailable -
a cutting that shadows Wi-Fi and the cell together, the stretch past the last
access point - and a vehicle that knows where it is on its planned route can
look that up ahead of itself. That is the prediction this module serves, and
it is the one kind the Phase 2 and Phase 4 findings left open: a trend can
only see a link failing once it has started to fail; a map sees the place.

The map is built by `scripts/build_radio_map.py` from **observations only** -
each link's phase (unavailable or not) and its reported coverage, recorded
with the vehicle's position along the route on survey drives in the `train`
seed block. It never reads the exogenous trace, and the controller is never
handed one: it is handed this table of past observations, binned by metre.

A missing or unreadable map file means no route-aware preparation, never a
guess.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from ..contracts import ALL_LINKS, LinkId

MAP_DIR = Path(__file__).resolve().parents[1] / "models"
MAP_VERSION = "radio-map-1"


def map_path(survey_id: str) -> Path:
    return MAP_DIR / f"radio_map-{survey_id}.json"


@dataclass(slots=True, frozen=True)
class MissionPlan:
    """The route the vehicle has been told to drive: its length, and which way.

    A vehicle on a mission knows its planned route and how far along it it has
    come; `distance_m` in `VehicleObservation` is that progress. Nothing here
    says how fast it will go or when it will get anywhere.
    """

    length_m: float
    reverse: bool = False

    def route_coordinate(self, travelled_m: float) -> float:
        """Position along the route as the map indexes it (from the forward start)."""
        return self.length_m - travelled_m if self.reverse else travelled_m

    def ahead(self, travelled_m: float, reach_m: float) -> tuple[float, float]:
        """The stretch of route coordinates the vehicle will cover in the next `reach_m`."""
        here = self.route_coordinate(travelled_m)
        if self.reverse:
            return max(here - reach_m, 0.0), here
        return here, min(here + reach_m, self.length_m)


@dataclass(slots=True, frozen=True)
class LinkOutlook:
    """What the map says about one link over a stretch of route."""

    #: Highest share of survey samples in any bin of the stretch where the link was unavailable.
    worst_unusable: float
    #: Mean reported coverage over the stretch.
    mean_coverage: float
    #: Route coordinates of the first and last bin judged unavailable, if any.
    lost_from_m: float | None
    lost_to_m: float | None


class RadioMap:
    """Per-link availability by route position, from survey observations."""

    def __init__(self, blob: dict, source: Path | None = None) -> None:
        self.source = str(source) if source else ""
        self.version = str(blob.get("version", ""))
        self.survey = str(blob.get("survey_scenario", ""))
        self.bin_m = float(blob["bin_m"])
        self.length_m = float(blob["length_m"])
        links = blob["links"]
        # Named for what they are: survey observations, binned. (The leak test
        # walks the controller's attributes for anything shaped like a trace.)
        self._unusable: dict[LinkId, list[float]] = {
            link: [float(v) for v in links[link.value]["unusable_share"]] for link in ALL_LINKS
        }
        self._coverage: dict[LinkId, list[float]] = {
            link: [float(v) for v in links[link.value]["mean_coverage"]] for link in ALL_LINKS
        }

    @classmethod
    def load(cls, survey_id: str) -> "RadioMap | None":
        path = map_path(survey_id)
        try:
            with path.open("r", encoding="utf-8") as handle:
                blob = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return None
        if blob.get("version") != MAP_VERSION:
            return None
        try:
            return cls(blob, path)
        except (KeyError, TypeError, ValueError):
            return None

    def _bins(self, lo_m: float, hi_m: float) -> range:
        count = len(self._unusable[LinkId.WIFI])
        first = max(int(math.floor(lo_m / self.bin_m)), 0)
        last = min(int(math.floor(hi_m / self.bin_m)), count - 1)
        return range(first, last + 1)

    def lost_span(self, link: LinkId, at_m: float, unusable_at: float = 0.5) -> tuple[float, float] | None:
        """The whole stretch around `at_m` where the map has `link` unavailable,
        as route coordinates - the gap's identity, wherever it is seen from."""
        shares = self._unusable[link]
        index = min(max(int(math.floor(at_m / self.bin_m)), 0), len(shares) - 1)
        if shares[index] < unusable_at:
            return None
        first = last = index
        while first > 0 and shares[first - 1] >= unusable_at:
            first -= 1
        while last < len(shares) - 1 and shares[last + 1] >= unusable_at:
            last += 1
        return first * self.bin_m, (last + 1) * self.bin_m

    def outlook(self, lo_m: float, hi_m: float, unusable_at: float = 0.5) -> dict[LinkId, LinkOutlook]:
        """Each link's prospects over route coordinates [lo_m, hi_m]."""
        bins = self._bins(lo_m, hi_m)
        out: dict[LinkId, LinkOutlook] = {}
        for link in ALL_LINKS:
            shares = [self._unusable[link][i] for i in bins]
            coverage = [self._coverage[link][i] for i in bins]
            lost = [i for i in bins if self._unusable[link][i] >= unusable_at]
            out[link] = LinkOutlook(
                worst_unusable=max(shares, default=0.0),
                mean_coverage=sum(coverage) / len(coverage) if coverage else 0.0,
                lost_from_m=lost[0] * self.bin_m if lost else None,
                lost_to_m=(lost[-1] + 1) * self.bin_m if lost else None,
            )
        return out
