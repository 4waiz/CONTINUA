# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-5B37A21F8975
"""
CONTINUA - the ridge tunnel.

Where the industrial corridor meets the remote hills the road goes through a
ridge (world_tunnel.py): the portals, the lining, the jet fans, the emergency
stations, and the pipeline's turn down into the ground where it meets the
ridge.

    node scripts/run-blender.mjs scripts/blender/build_tunnel.py

Outputs
    apps/web/public/models/continua_tunnel.glb    one node per prop, each at the origin

Built with the props' own materials, AO bake and export settings
(build_props.py). A file of its own rather than more nodes in
continua_props.glb, like DOCK 02: adding the tunnel does not rebuild, re-bake
and re-ship the whole library. The hill over it and where each piece stands
are the scene's (packages/scene/src/world/tunnel.ts).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_props  # noqa: E402
import continua_arch as arch  # noqa: E402
import continua_lib as lib  # noqa: E402
import world_tunnel  # noqa: E402


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    samples = 16 if "--draft" in argv else 64

    lib.banner("CONTINUA - building the ridge tunnel")
    lib.reset_scene("CONTINUA_Tunnel")
    props = world_tunnel.build_all(arch.world_materials())
    if "--no-bake" not in argv:
        build_props.bake(props, samples)
    build_props.report(props)
    build_props.export(props, lib.out_path("apps", "web", "public", "models", "continua_tunnel.glb"))
    lib.write_model_versions()


if __name__ == "__main__":
    main()
