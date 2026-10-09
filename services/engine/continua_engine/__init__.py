# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-156D3DC00CE2
"""CONTINUA engine: scenario generator, network simulator, controller and experiment runner."""

from .contracts import SCHEMA_VERSION, POLICY_VERSION

__version__ = SCHEMA_VERSION
__all__ = ["SCHEMA_VERSION", "POLICY_VERSION", "__version__"]
