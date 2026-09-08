"""CONTINUA engine: scenario generator, network simulator, controller and experiment runner."""

from .contracts import SCHEMA_VERSION, POLICY_VERSION

__version__ = SCHEMA_VERSION
__all__ = ["SCHEMA_VERSION", "POLICY_VERSION", "__version__"]
