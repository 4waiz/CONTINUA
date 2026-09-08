#!/usr/bin/env python3
"""
Cross-platform launcher for the engine's command-line modules.

`PYTHONPATH=services/engine python -m ...` does not work through npm scripts on
Windows, where scripts run under cmd.exe. This inserts the path itself and then
runs the requested module, so one command line works everywhere.

    python scripts/engine_cli.py continua_engine.experiments --trials 20
"""

from __future__ import annotations

import pathlib
import runpy
import sys

ENGINE = pathlib.Path(__file__).resolve().parent.parent / "services" / "engine"
sys.path.insert(0, str(ENGINE))

if len(sys.argv) < 2:
    print(__doc__)
    raise SystemExit(2)

module = sys.argv[1]
sys.argv = sys.argv[1:]
runpy.run_module(module, run_name="__main__")
