# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-192F816DA237
"""
Phase 4 regression guard.

Every Phase 4 mechanism sits behind a `PolicyConfig` flag that defaults to off.
This test proves the claim: the six pre-Phase-4 policies must produce exactly
the metrics and exactly the decision stream they produced before Phase 4
existed, for a fixed seed on four scenarios. The reference was generated from
commit 95cdfd0 by `regression_fixture.py` and must not be regenerated to make
this test pass.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from regression_fixture import (  # noqa: E402
    FIXTURE_PATH,
    GUARD_POLICIES,
    GUARD_SCENARIOS,
    GUARD_SEED,
    snapshot,
)
from continua_engine.contracts import PolicyId  # noqa: E402

FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _assert_subset_equal(expected, actual, path: str) -> None:
    """Every value recorded in the fixture must be reproduced exactly.

    New metric keys added by Phase 4 are allowed to appear; nothing recorded
    before Phase 4 may change value or disappear.
    """
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected a mapping"
        for key, value in expected.items():
            assert key in actual, f"{path}.{key}: metric disappeared"
            _assert_subset_equal(value, actual[key], f"{path}.{key}")
        return
    assert expected == actual, f"{path}: {expected!r} != {actual!r}"


def test_fixture_matches_declared_guard_set():
    assert FIXTURE["seed"] == GUARD_SEED
    assert FIXTURE["scenarios"] == list(GUARD_SCENARIOS)
    assert FIXTURE["policies"] == [policy.value for policy in GUARD_POLICIES]
    assert len(FIXTURE["runs"]) == len(GUARD_SCENARIOS) * len(GUARD_POLICIES)


@pytest.mark.parametrize("scenario_id", GUARD_SCENARIOS)
@pytest.mark.parametrize("policy", GUARD_POLICIES, ids=[p.value for p in GUARD_POLICIES])
def test_existing_policies_are_unchanged_by_phase4(scenario_id: str, policy: PolicyId):
    expected = FIXTURE["runs"][f"{scenario_id}::{policy.value}"]
    actual = snapshot(scenario_id, policy)
    _assert_subset_equal(expected["metrics"], actual["metrics"], f"{scenario_id}/{policy.value}")
    assert actual["events"] == expected["events"], "event count changed"
    assert actual["event_digest"] == expected["event_digest"], (
        "decision stream changed: time, state, carrying path, first action or reason differ"
    )
