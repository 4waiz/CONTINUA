"""
Run storage.

SQLite for run metadata (queryable), JSONL for the event stream (append-only,
greppable, diffable) and JSON for aggregate results. Everything a run needs to
be reproduced is written next to it: scenario spec, seed, policy, predictor,
engine version and the code commit.

Nothing here is a cache. If a file is missing, the run did not happen.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator

from ..contracts import EngineEvent, ExecutionMode, PolicyId, RunStatus, RunSummary

DEFAULT_ROOT = Path(
    os.environ.get("CONTINUA_DATA_DIR")
    or (Path(__file__).resolve().parents[4] / "data" / "runs")
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id        TEXT PRIMARY KEY,
    mode          TEXT NOT NULL,
    scenario_id   TEXT NOT NULL,
    policy_id     TEXT NOT NULL,
    seed          INTEGER NOT NULL,
    status        TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    duration_s    REAL,
    events        INTEGER DEFAULT 0,
    source_mode   TEXT,
    source_run_id TEXT,
    recorded_at   TEXT,
    code_commit   TEXT,
    engine_version TEXT,
    predictor     TEXT,
    horizon_s     REAL,
    notes         TEXT DEFAULT '',
    metrics_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    scenario_id   TEXT NOT NULL,
    trials        INTEGER NOT NULL,
    policies      TEXT NOT NULL,
    status        TEXT NOT NULL,
    completed     INTEGER DEFAULT 0,
    results_path  TEXT,
    notes         TEXT DEFAULT ''
);
"""


def code_commit() -> str | None:
    """Best-effort commit id, recorded with every run for reproducibility."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parents[4],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip()[:40] or None
    except (OSError, subprocess.SubprocessError):
        return None


class RunStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or DEFAULT_ROOT)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "continua.sqlite"
        with closing(self._connect()) as conn:
            conn.executescript(SCHEMA)
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    # -- paths ---------------------------------------------------------------

    def run_dir(self, run_id: str) -> Path:
        path = self.root / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def events_path(self, run_id: str) -> Path:
        return self.run_dir(run_id) / "events.jsonl"

    def manifest_path(self, run_id: str) -> Path:
        return self.run_dir(run_id) / "manifest.json"

    def metrics_path(self, run_id: str) -> Path:
        return self.run_dir(run_id) / "metrics.json"

    # -- writing -------------------------------------------------------------

    def begin_run(
        self,
        run_id: str,
        mode: ExecutionMode,
        scenario: dict,
        policy_id: PolicyId,
        seed: int,
        predictor: str,
        horizon_s: float,
        engine_version: str,
        source: RunSummary | None = None,
    ) -> None:
        started = datetime.now(timezone.utc).isoformat()
        manifest = {
            "run_id": run_id,
            "mode": mode.value,
            "scenario": scenario,
            "policy_id": policy_id.value,
            "seed": seed,
            "predictor": predictor,
            "horizon_s": horizon_s,
            "engine_version": engine_version,
            "code_commit": code_commit(),
            "started_at": started,
            "environment": {
                "python": os.sys.version.split()[0],
                "platform": os.sys.platform,
            },
        }
        if source is not None:
            manifest["source"] = {
                "mode": source.mode.value,
                "run_id": source.run_id,
                "recorded_at": source.started_at,
            }
        self.manifest_path(run_id).write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        with closing(self._connect()) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO runs
                   (run_id, mode, scenario_id, policy_id, seed, status, started_at,
                    source_mode, source_run_id, recorded_at, code_commit, engine_version,
                    predictor, horizon_s)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id,
                    mode.value,
                    scenario["id"],
                    policy_id.value,
                    seed,
                    RunStatus.RUNNING.value,
                    started,
                    source.mode.value if source else None,
                    source.run_id if source else None,
                    source.started_at if source else None,
                    manifest["code_commit"],
                    engine_version,
                    predictor,
                    horizon_s,
                ),
            )
            conn.commit()

    def write_events(self, run_id: str, events: Iterable[EngineEvent]) -> int:
        count = 0
        with self.events_path(run_id).open("a", encoding="utf-8") as handle:
            for event in events:
                handle.write(event.model_dump_json() + "\n")
                count += 1
        return count

    def finish_run(
        self,
        run_id: str,
        status: RunStatus,
        duration_s: float,
        event_count: int,
        metrics: dict | None = None,
    ) -> None:
        if metrics is not None:
            self.metrics_path(run_id).write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        with closing(self._connect()) as conn:
            conn.execute(
                """UPDATE runs SET status=?, finished_at=?, duration_s=?, events=?, metrics_json=?
                   WHERE run_id=?""",
                (
                    status.value,
                    datetime.now(timezone.utc).isoformat(),
                    duration_s,
                    event_count,
                    json.dumps(metrics) if metrics is not None else None,
                    run_id,
                ),
            )
            conn.commit()

    # -- reading -------------------------------------------------------------

    def list_runs(self, limit: int = 50, scenario_id: str | None = None) -> list[dict]:
        query = "SELECT * FROM runs"
        params: list = []
        if scenario_id:
            query += " WHERE scenario_id = ?"
            params.append(scenario_id)
        query += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        with closing(self._connect()) as conn:
            return [dict(row) for row in conn.execute(query, params).fetchall()]

    def get_run(self, run_id: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
            return dict(row) if row else None

    def get_manifest(self, run_id: str) -> dict | None:
        path = self.manifest_path(run_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def iter_events(self, run_id: str) -> Iterator[dict]:
        path = self.events_path(run_id)
        if not path.exists():
            return
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)

    def read_metrics(self, run_id: str) -> dict | None:
        path = self.metrics_path(run_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def delete_run(self, run_id: str) -> None:
        import shutil

        directory = self.root / run_id
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
        with closing(self._connect()) as conn:
            conn.execute("DELETE FROM runs WHERE run_id = ?", (run_id,))
            conn.commit()

    # -- experiments ---------------------------------------------------------

    def record_experiment(
        self,
        experiment_id: str,
        scenario_id: str,
        trials: int,
        policies: list[str],
        status: str,
        completed: int,
        results_path: str | None,
        notes: str = "",
    ) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO experiments
                   (experiment_id, created_at, scenario_id, trials, policies, status,
                    completed, results_path, notes)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    experiment_id,
                    datetime.now(timezone.utc).isoformat(),
                    scenario_id,
                    trials,
                    ",".join(policies),
                    status,
                    completed,
                    results_path,
                    notes,
                ),
            )
            conn.commit()

    def list_experiments(self, limit: int = 50) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM experiments ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def experiment_results(self, experiment_id: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT results_path FROM experiments WHERE experiment_id = ?", (experiment_id,)
            ).fetchone()
        if not row or not row["results_path"]:
            return None
        path = Path(row["results_path"])
        if not path.is_absolute():
            path = self.root.parent / path
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))


_default_store: RunStore | None = None


def default_store() -> RunStore:
    global _default_store
    if _default_store is None:
        _default_store = RunStore()
    return _default_store
