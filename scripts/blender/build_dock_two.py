# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-6CD7221D5780
"""
CONTINUA - the second dock bay, DOCK 02.

When a run is shown with the normal rover beside it, the normal rover starts in
a bay of its own across the route from the first dock's equipment
(packages/scene/src/world/lanes.ts): the same dock, lettered DOCK 02, without
the pillar, cabinet and floodlights that serve the yard from DOCK 01.

    node scripts/run-blender.mjs scripts/blender/build_dock_two.py

Outputs
    apps/web/public/models/continua_dock02.glb    one node, PROP_DockStation_02, at the origin

Built by world_industry.prop_dock_station with the props' own materials, AO
bake and export settings (build_props.py), so it is DOCK 01's twin. A file of
its own rather than another node in continua_props.glb: adding it does not
rebuild, re-bake and re-ship the whole library.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_props  # noqa: E402
import continua_arch as arch  # noqa: E402
import continua_lib as lib  # noqa: E402
import world_foliage  # noqa: E402
import world_industry  # noqa: E402


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    samples = 16 if "--draft" in argv else 64

    lib.banner("CONTINUA - building the second dock bay (DOCK 02)")
    lib.reset_scene("CONTINUA_DockTwo")
    materials = world_foliage.add_materials(arch.world_materials())
    dock = world_industry.prop_dock_station(materials, name="PROP_DockStation_02", number="DOCK 02", equipment=False)
    props = [dock]
    if "--no-bake" not in argv:
        build_props.bake(props, samples)
    build_props.report(props)
    build_props.export(props, lib.out_path("apps", "web", "public", "models", "continua_dock02.glb"))
    lib.write_model_versions()


if __name__ == "__main__":
    main()
