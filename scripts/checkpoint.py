#!/usr/bin/env python3
"""
CONTINUA checkpoint supervisor.

A session-scoped background process that creates a safe Git checkpoint every
`--interval` seconds (default 300) on the project's development branch and
pushes it to `origin`, then verifies the remote SHA.

Design rules (see CLAUDE.md "Checkpoint policy"):

  * Only *ready* paths are staged. The coordinating agent explicitly marks
    completed work with `checkpoint.py ready <path>...`. There is never a
    blanket `git add .`.
  * Every Git operation is serialised behind a lock file. The agent takes the
    same lock around asset exports and multi-file edits via
    `checkpoint.py pause` / `resume`, so a checkpoint can never land in the
    middle of a Blender export or a partially written change.
  * The supervisor refuses to act during a merge, rebase, cherry-pick, bisect
    or while another Git process holds `.git/index.lock`.
  * Content is screened for conflict markers, whitespace corruption, secrets
    and oversized files before it is committed.
  * Transient network failures retry with bounded exponential backoff.
    Authentication failures and remote divergence stop the attempt, preserve
    all local work, and are reported. The supervisor never force-pushes,
    never resets, and never rewrites history.
  * All supervisor state lives in `.checkpoint/`, which is git-ignored, so the
    log can never become the reason for the next commit.

Usage
-----
    python scripts/checkpoint.py start [--interval 300] [--branch continua/build]
    python scripts/checkpoint.py once  [--message "..."]
    python scripts/checkpoint.py status
    python scripts/checkpoint.py stop
    python scripts/checkpoint.py ready <path> [<path> ...]
    python scripts/checkpoint.py unready <path> [<path> ...]
    python scripts/checkpoint.py pause   [--reason "blender export"]
    python scripts/checkpoint.py resume
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

# --------------------------------------------------------------------------
# Paths and constants
# --------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = REPO_ROOT / ".checkpoint"
LOG_FILE = STATE_DIR / "checkpoint.log"
STATE_FILE = STATE_DIR / "state.json"
READY_FILE = STATE_DIR / "ready.json"
PID_FILE = STATE_DIR / "supervisor.pid"
GIT_LOCK = STATE_DIR / "git.lock"
PAUSE_FILE = STATE_DIR / "paused"

DEFAULT_INTERVAL = 300
DEFAULT_BRANCH = "continua/build"
PROTECTED_BRANCHES = {"main", "master"}

# Bounded backoff for transient network trouble.
PUSH_RETRIES = 4
PUSH_BACKOFF_BASE = 4.0  # 4s, 8s, 16s, 32s

# A lock older than this is considered abandoned (crashed process).
LOCK_STALE_SECONDS = 900

# File size policy.
SIZE_WARN_BYTES = 5 * 1024 * 1024  # 5 MB  -> log a warning
SIZE_BLOCK_BYTES = 45 * 1024 * 1024  # 45 MB -> refuse unless tracked by Git LFS

TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx",
    ".css", ".scss", ".html", ".py", ".yml", ".yaml", ".toml", ".txt",
    ".glsl", ".vert", ".frag", ".sh", ".ps1", ".gitignore", ".gitattributes",
}

CONFLICT_MARKER_RE = re.compile(r"^(<{7} |={7}$|>{7} )", re.MULTILINE)

# Secret screening. Deliberately narrow: it must catch real credentials
# without tripping on every hex colour or three.js uniform name.
SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("GitHub fine-grained PAT", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{60,}\b")),
    ("AWS access key id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[0-9A-Za-z\-]{10,}\b")),
    ("OpenAI-style key", re.compile(r"\bsk-[A-Za-z0-9]{32,}\b")),
    ("Anthropic key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}\b")),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    (
        "Hardcoded credential assignment",
        re.compile(
            r"""(?i)\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-./+]{20,}["']"""
        ),
    ),
]

# Paths that must never be checkpointed even if a caller marks them ready.
# Directory prefixes (trailing slash) and exact file names are handled
# separately so that `.env.example` — the one credential-shaped file we *do*
# want tracked — is not caught by a naive `.env` prefix match.
NEVER_STAGE_PREFIXES = (
    ".checkpoint/",
    "node_modules/",
    ".next/",
    ".claude/settings.local.json",
)
NEVER_STAGE_EXACT = (
    ".env",
    ".mcp.json",
)


def is_excluded(rel_path: str) -> bool:
    """True when a path must never be staged, whatever a caller marks ready."""
    rel = rel_path.replace("\\", "/").strip("/")
    if rel in NEVER_STAGE_EXACT:
        return True
    # `.env`, `.env.local`, `apps/web/.env.production` — but never `.env.example`.
    name = rel.rsplit("/", 1)[-1]
    if name.startswith(".env") and name != ".env.example":
        return True
    return any(rel == p.rstrip("/") or rel.startswith(p) for p in NEVER_STAGE_PREFIXES)


# --------------------------------------------------------------------------
# Small utilities
# --------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def log(level: str, message: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    line = f"[{now_iso()}] {level:<7} {message}"
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    # Only the foreground commands echo; the daemon writes to the log alone.
    if os.environ.get("CONTINUA_CHECKPOINT_QUIET") != "1":
        print(line, flush=True)


def git(*args: str, check: bool = False, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=check,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_state() -> dict:
    return read_json(
        STATE_FILE,
        {
            "last_success_iso": None,
            "last_success_sha": None,
            "last_success_remote_sha": None,
            "last_attempt_iso": None,
            "last_attempt_result": None,
            "last_error": None,
            "attempts": 0,
            "commits": 0,
            "pushes": 0,
            "skipped": 0,
            "failed": 0,
            "branch": DEFAULT_BRANCH,
            "push_enabled": True,
        },
    )


def save_state(state: dict) -> None:
    write_json(STATE_FILE, state)


# --------------------------------------------------------------------------
# Locking — serialises all Git operations across agent and supervisor
# --------------------------------------------------------------------------


class LockBusy(RuntimeError):
    pass


def _lock_info() -> dict | None:
    return read_json(GIT_LOCK, None) if GIT_LOCK.exists() else None


def acquire_lock(owner: str, wait_seconds: float = 0.0) -> bool:
    """Take the Git lock. Returns False if it is held by someone else."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + wait_seconds
    while True:
        info = _lock_info()
        if info is not None:
            age = time.time() - float(info.get("ts", 0))
            if age > LOCK_STALE_SECONDS:
                log("WARN", f"clearing stale git lock held by {info.get('owner')} for {age:.0f}s")
                GIT_LOCK.unlink(missing_ok=True)
                info = None
        if info is None:
            try:
                # O_EXCL gives us atomic create-or-fail.
                fd = os.open(GIT_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump({"owner": owner, "pid": os.getpid(), "ts": time.time()}, handle)
                return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.4)


def release_lock() -> None:
    GIT_LOCK.unlink(missing_ok=True)


# --------------------------------------------------------------------------
# Safety gates
# --------------------------------------------------------------------------


def repo_operation_in_progress() -> str | None:
    """Return a reason string if Git is mid-operation, else None."""
    git_dir_out = git("rev-parse", "--git-dir")
    git_dir = REPO_ROOT / (git_dir_out.stdout.strip() or ".git")
    markers = {
        "MERGE_HEAD": "a merge is in progress",
        "REBASE_HEAD": "a rebase is in progress",
        "rebase-merge": "a rebase is in progress",
        "rebase-apply": "a rebase/am is in progress",
        "CHERRY_PICK_HEAD": "a cherry-pick is in progress",
        "REVERT_HEAD": "a revert is in progress",
        "BISECT_LOG": "a bisect is in progress",
        "index.lock": "another Git process holds index.lock",
    }
    for name, reason in markers.items():
        if (git_dir / name).exists():
            return reason
    return None


def paused_reason() -> str | None:
    if PAUSE_FILE.exists():
        try:
            return PAUSE_FILE.read_text(encoding="utf-8").strip() or "paused"
        except OSError:
            return "paused"
    return None


def ready_paths() -> list[str]:
    entries = read_json(READY_FILE, {"paths": []}).get("paths", [])
    return sorted({str(p).replace("\\", "/").strip() for p in entries if str(p).strip()})


def is_lfs_tracked(rel_path: str) -> bool:
    result = git("check-attr", "filter", "--", rel_path)
    return "filter: lfs" in result.stdout


def screen_file(rel_path: str) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for one staged file."""
    errors: list[str] = []
    warnings: list[str] = []
    abs_path = REPO_ROOT / rel_path
    if not abs_path.exists():  # deletion
        return errors, warnings

    size = abs_path.stat().st_size
    if size >= SIZE_BLOCK_BYTES and not is_lfs_tracked(rel_path):
        errors.append(f"{rel_path}: {size / 1048576:.1f} MB exceeds {SIZE_BLOCK_BYTES // 1048576} MB and is not tracked by Git LFS")
    elif size >= SIZE_WARN_BYTES:
        warnings.append(f"{rel_path}: large file, {size / 1048576:.1f} MB")

    suffix = abs_path.suffix.lower()
    if suffix not in TEXT_SUFFIXES and abs_path.name not in {".gitignore", ".gitattributes"}:
        return errors, warnings
    if size > 2 * 1024 * 1024:
        return errors, warnings  # do not scan huge text blobs

    try:
        text = abs_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return errors, warnings

    if CONFLICT_MARKER_RE.search(text):
        errors.append(f"{rel_path}: contains merge conflict markers")

    # `.env.example` is intentionally full of credential-shaped placeholders.
    if not rel_path.endswith(".env.example"):
        for label, pattern in SECRET_PATTERNS:
            match = pattern.search(text)
            if match:
                errors.append(f"{rel_path}: possible {label} at offset {match.start()}")
                break

    for number, line in enumerate(text.splitlines(), start=1):
        if line.rstrip("\r\n") != line.rstrip():
            warnings.append(f"{rel_path}:{number}: trailing whitespace")
            break
    return errors, warnings


# --------------------------------------------------------------------------
# Branch handling
# --------------------------------------------------------------------------


def current_branch() -> str:
    return git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()


def ensure_branch(branch: str) -> str:
    """Make sure we are on a safe development branch. Returns the branch name."""
    head = current_branch()
    if head == branch:
        return branch
    if head not in PROTECTED_BRANCHES and head != "HEAD":
        # An established development branch already exists — respect it.
        log("INFO", f"using established development branch '{head}' (requested '{branch}')")
        return head

    exists = git("rev-parse", "--verify", "--quiet", f"refs/heads/{branch}").returncode == 0
    result = git("checkout", branch) if exists else git("checkout", "-b", branch)
    if result.returncode != 0:
        raise RuntimeError(f"cannot switch to branch '{branch}': {result.stderr.strip()}")
    log("INFO", f"switched to development branch '{branch}'")
    return branch


# --------------------------------------------------------------------------
# The checkpoint itself
# --------------------------------------------------------------------------


def summarise(files: Sequence[str]) -> str:
    """Build a meaningful commit subject from the staged paths."""
    buckets: dict[str, int] = {}
    for path in files:
        parts = path.split("/")
        if parts[0] in {"apps", "packages"} and len(parts) > 1:
            key = f"{parts[0]}/{parts[1]}"
        elif parts[0] in {"assets", "scripts"} and len(parts) > 1:
            key = f"{parts[0]}/{parts[1]}"
        else:
            key = parts[0] if len(parts) > 1 else "root"
        buckets[key] = buckets.get(key, 0) + 1
    ordered = sorted(buckets.items(), key=lambda item: (-item[1], item[0]))
    head = ", ".join(name for name, _ in ordered[:3])
    if len(ordered) > 3:
        head += f" +{len(ordered) - 3} more"
    return head or "workspace"


def stage_ready(paths: Sequence[str]) -> list[str]:
    """Stage only ready paths. Returns the staged path list."""
    usable = [p for p in paths if not is_excluded(p)]
    if not usable:
        return []
    # `--` guards against a path that looks like a flag. Missing paths are
    # tolerated so a removed file cannot wedge the supervisor.
    add = git("add", "--all", "--", *usable)
    if add.returncode != 0:
        log("WARN", f"git add reported: {add.stderr.strip()}")
    staged = git("diff", "--cached", "--name-only")
    return [line.strip() for line in staged.stdout.splitlines() if line.strip()]


def push_with_backoff(branch: str, state: dict) -> tuple[bool, str]:
    """Push with bounded backoff. Returns (ok, detail)."""
    for attempt in range(1, PUSH_RETRIES + 1):
        result = git("push", "--set-upstream", "origin", branch, timeout=240)
        if result.returncode == 0:
            return True, result.stderr.strip() or "pushed"
        combined = f"{result.stdout}\n{result.stderr}".lower()

        if any(token in combined for token in ("authentication failed", "could not read username",
                                               "permission denied", "403 forbidden", "invalid username or password")):
            return False, "AUTH: authentication failed — local work preserved, nothing rewritten"
        if any(token in combined for token in ("non-fast-forward", "fetch first", "rejected", "behind its remote")):
            return False, ("DIVERGED: remote has commits this branch does not contain. "
                           "Local work preserved; resolve manually with `git pull --rebase` — "
                           "the supervisor will not force-push or reset")
        if any(token in combined for token in ("could not resolve host", "timed out", "connection reset",
                                               "network is unreachable", "failed to connect", "operation timed out",
                                               "unexpected disconnect", "rpc failed", "ssl_read")):
            if attempt < PUSH_RETRIES:
                delay = PUSH_BACKOFF_BASE * (2 ** (attempt - 1))
                log("WARN", f"transient network failure on push (attempt {attempt}/{PUSH_RETRIES}); retrying in {delay:.0f}s")
                time.sleep(delay)
                continue
            return False, "NETWORK: push failed after bounded retries — commit is safe locally"
        return False, f"PUSH FAILED: {result.stderr.strip()[:400]}"
    return False, "NETWORK: exhausted retries"


def verify_remote(branch: str, expected_sha: str) -> tuple[bool, str]:
    result = git("ls-remote", "origin", f"refs/heads/{branch}", timeout=120)
    if result.returncode != 0:
        return False, f"could not query remote: {result.stderr.strip()[:200]}"
    for line in result.stdout.splitlines():
        sha, _, ref = line.partition("\t")
        if ref.strip().endswith(f"refs/heads/{branch}"):
            sha = sha.strip()
            return (sha == expected_sha), sha
    return False, "branch not found on remote"


def do_checkpoint(branch: str, message: str | None, push: bool, owner: str = "supervisor") -> str:
    """One checkpoint attempt. Returns a short result token."""
    state = load_state()
    state["attempts"] += 1
    state["last_attempt_iso"] = now_iso()

    reason = paused_reason()
    if reason:
        state["skipped"] += 1
        state["last_attempt_result"] = "skipped"
        save_state(state)
        log("SKIP", f"checkpoint paused ({reason})")
        return "skipped"

    if not acquire_lock(owner, wait_seconds=20.0):
        info = _lock_info() or {}
        state["skipped"] += 1
        state["last_attempt_result"] = "skipped"
        save_state(state)
        log("SKIP", f"git lock held by {info.get('owner', 'unknown')} (pid {info.get('pid')})")
        return "skipped"

    try:
        blocker = repo_operation_in_progress()
        if blocker:
            state["skipped"] += 1
            state["last_attempt_result"] = "skipped"
            save_state(state)
            log("SKIP", f"refusing to checkpoint: {blocker}")
            return "skipped"

        try:
            branch = ensure_branch(branch)
        except RuntimeError as exc:
            state["failed"] += 1
            state["last_attempt_result"] = "failed"
            state["last_error"] = str(exc)
            save_state(state)
            log("ERROR", str(exc))
            return "failed"

        state["branch"] = branch
        marked = ready_paths()
        if not marked:
            state["skipped"] += 1
            state["last_attempt_result"] = "skipped"
            save_state(state)
            log("SKIP", "no paths marked ready by the coordinating agent")
            return "skipped"

        staged = stage_ready(marked)
        if not staged:
            state["skipped"] += 1
            state["last_attempt_result"] = "skipped"
            save_state(state)
            log("SKIP", "ready paths contain no changes to commit")
            return "skipped"

        errors: list[str] = []
        warnings: list[str] = []
        for rel in staged:
            file_errors, file_warnings = screen_file(rel)
            errors.extend(file_errors)
            warnings.extend(file_warnings)

        for warning in warnings[:12]:
            log("WARN", warning)

        if errors:
            git("reset", "HEAD", "--")  # unstage; never discard working-tree content
            state["failed"] += 1
            state["last_attempt_result"] = "failed"
            state["last_error"] = "; ".join(errors[:5])
            save_state(state)
            for error in errors[:8]:
                log("ERROR", f"content check: {error}")
            log("ERROR", "checkpoint aborted — files unstaged, working tree untouched")
            return "failed"

        subject = message or f"checkpoint: {summarise(staged)}"
        body = (
            f"Automated CONTINUA checkpoint.\n\n"
            f"Files: {len(staged)}\n"
            f"Marked ready: {len(marked)} path(s)\n"
            f"Time: {now_iso()}\n"
        )
        commit = git("commit", "-m", subject, "-m", body)
        if commit.returncode != 0:
            if "nothing to commit" in (commit.stdout + commit.stderr).lower():
                state["skipped"] += 1
                state["last_attempt_result"] = "skipped"
                save_state(state)
                log("SKIP", "nothing to commit")
                return "skipped"
            state["failed"] += 1
            state["last_attempt_result"] = "failed"
            state["last_error"] = commit.stderr.strip()[:400]
            save_state(state)
            log("ERROR", f"commit failed: {commit.stderr.strip()[:400]}")
            return "failed"

        sha = git("rev-parse", "HEAD").stdout.strip()
        state["commits"] += 1
        log("OK", f"committed {sha[:10]} — {subject} ({len(staged)} files)")

        if not push or not state.get("push_enabled", True):
            state["last_attempt_result"] = "committed (push disabled)"
            save_state(state)
            return "committed"

        ok, detail = push_with_backoff(branch, state)
        if not ok:
            state["failed"] += 1
            state["last_attempt_result"] = "commit ok / push failed"
            state["last_error"] = detail
            save_state(state)
            log("ERROR", f"push: {detail}")
            return "push-failed"

        verified, remote_sha = verify_remote(branch, sha)
        state["pushes"] += 1
        state["last_success_iso"] = now_iso()
        state["last_success_sha"] = sha
        state["last_success_remote_sha"] = remote_sha
        state["last_attempt_result"] = "pushed+verified" if verified else "pushed (unverified)"
        state["last_error"] = None
        save_state(state)
        if verified:
            log("OK", f"pushed to origin/{branch}; remote SHA verified = {remote_sha}")
        else:
            log("WARN", f"pushed to origin/{branch} but remote SHA is {remote_sha}, expected {sha}")
        return "pushed"
    finally:
        release_lock()


# --------------------------------------------------------------------------
# Daemon
# --------------------------------------------------------------------------


def supervisor_alive() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    try:
        if os.name == "nt":
            probe = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, timeout=30,
            )
            return pid if str(pid) in probe.stdout else None
        os.kill(pid, 0)
        return pid
    except (OSError, subprocess.SubprocessError):
        return None


def run_loop(branch: str, interval: int, push: bool) -> None:
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    state = load_state()
    state["branch"] = branch
    state["push_enabled"] = push
    save_state(state)
    log("INFO", f"supervisor started (pid {os.getpid()}, branch {branch}, interval {interval}s, push={push})")

    stop = {"flag": False}

    def handle(_signum, _frame):
        stop["flag"] = True

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handle)
        except (ValueError, OSError):
            pass

    try:
        while not stop["flag"]:
            # Sleep first: `start` is normally issued right after a manual
            # checkpoint, so an immediate second attempt would just be skipped.
            for _ in range(interval):
                if stop["flag"]:
                    break
                time.sleep(1)
            if stop["flag"]:
                break
            try:
                do_checkpoint(branch, None, push)
            except Exception as exc:  # never let one bad cycle kill the loop
                log("ERROR", f"unhandled error in cycle: {exc!r}")
    finally:
        log("INFO", "supervisor stopped")
        PID_FILE.unlink(missing_ok=True)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def cmd_start(args: argparse.Namespace) -> int:
    existing = supervisor_alive()
    if existing:
        print(f"supervisor already running (pid {existing})")
        return 0
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if args.foreground:
        run_loop(args.branch, args.interval, not args.no_push)
        return 0

    env = dict(os.environ, CONTINUA_CHECKPOINT_QUIET="1")
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0)
    command = [
        sys.executable, str(Path(__file__).resolve()), "start",
        "--foreground", "--interval", str(args.interval), "--branch", args.branch,
    ]
    if args.no_push:
        command.append("--no-push")
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        process = subprocess.Popen(
            command, cwd=REPO_ROOT, stdout=handle, stderr=handle,
            stdin=subprocess.DEVNULL, env=env, creationflags=creationflags,
        )
    time.sleep(1.5)
    print(f"checkpoint supervisor started (pid {process.pid}); interval {args.interval}s, branch {args.branch}")
    print(f"log: {LOG_FILE}")
    return 0


def cmd_stop(_args: argparse.Namespace) -> int:
    pid = supervisor_alive()
    if not pid:
        PID_FILE.unlink(missing_ok=True)
        print("no supervisor running")
        return 0
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=30)
        else:
            os.kill(pid, signal.SIGTERM)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"could not stop pid {pid}: {exc}")
        return 1
    time.sleep(1.0)
    PID_FILE.unlink(missing_ok=True)
    log("INFO", f"supervisor stopped by request (pid {pid})")
    print(f"checkpoint supervisor stopped (pid {pid})")
    return 0


def cmd_once(args: argparse.Namespace) -> int:
    result = do_checkpoint(args.branch, args.message, not args.no_push, owner="agent")
    return 0 if result in {"pushed", "committed", "skipped"} else 1


def cmd_status(_args: argparse.Namespace) -> int:
    state = load_state()
    pid = supervisor_alive()
    marked = ready_paths()
    print("CONTINUA checkpoint status")
    print("--------------------------")
    print(f"  supervisor        : {'running (pid ' + str(pid) + ')' if pid else 'stopped'}")
    print(f"  branch            : {state.get('branch')}")
    print(f"  paused            : {paused_reason() or 'no'}")
    print(f"  git lock          : {(_lock_info() or {}).get('owner', 'free')}")
    print(f"  ready paths       : {len(marked)}")
    for path in marked[:20]:
        print(f"      - {path}")
    if len(marked) > 20:
        print(f"      ... {len(marked) - 20} more")
    print(f"  attempts          : {state.get('attempts')} "
          f"(commits {state.get('commits')}, pushes {state.get('pushes')}, "
          f"skipped {state.get('skipped')}, failed {state.get('failed')})")
    print(f"  last attempt      : {state.get('last_attempt_iso')} -> {state.get('last_attempt_result')}")
    print(f"  LAST SUCCESSFUL PUSH : {state.get('last_success_iso') or 'never'}")
    print(f"  verified remote SHA  : {state.get('last_success_remote_sha') or '-'}")
    if state.get("last_error"):
        print(f"  last error        : {state['last_error']}")
    print(f"  log               : {LOG_FILE}")
    return 0


def _mutate_ready(paths: Iterable[str], add: bool) -> int:
    current = set(ready_paths())
    changed: list[str] = []
    for raw in paths:
        candidate = Path(raw)
        if candidate.is_absolute():
            try:
                candidate = candidate.resolve().relative_to(REPO_ROOT)
            except ValueError:
                print(f"skipping path outside the repository: {raw}")
                continue
        rel = str(candidate).replace("\\", "/").strip("/")
        if not rel:
            continue
        if add and is_excluded(rel):
            print(f"refusing to mark excluded path ready: {rel}")
            continue
        if add:
            if rel not in current:
                current.add(rel)
                changed.append(rel)
        elif rel in current:
            current.discard(rel)
            changed.append(rel)
    write_json(READY_FILE, {"paths": sorted(current), "updated": now_iso()})
    verb = "marked ready" if add else "removed from ready set"
    print(f"{verb}: {len(changed)} path(s); {len(current)} total")
    return 0


def cmd_ready(args: argparse.Namespace) -> int:
    return _mutate_ready(args.paths, add=True)


def cmd_unready(args: argparse.Namespace) -> int:
    return _mutate_ready(args.paths, add=False)


def cmd_pause(args: argparse.Namespace) -> int:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PAUSE_FILE.write_text(args.reason, encoding="utf-8")
    log("INFO", f"checkpoints paused: {args.reason}")
    return 0


def cmd_resume(_args: argparse.Namespace) -> int:
    PAUSE_FILE.unlink(missing_ok=True)
    log("INFO", "checkpoints resumed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="checkpoint.py", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--branch", default=os.environ.get("CONTINUA_CHECKPOINT_BRANCH", DEFAULT_BRANCH))
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start", help="start the background supervisor")
    p_start.add_argument("--interval", type=int,
                         default=int(os.environ.get("CONTINUA_CHECKPOINT_INTERVAL", DEFAULT_INTERVAL)))
    p_start.add_argument("--foreground", action="store_true", help="run the loop in this process")
    p_start.add_argument("--no-push", action="store_true", help="commit locally, never push")
    p_start.set_defaults(func=cmd_start)

    p_once = sub.add_parser("once", help="run a single checkpoint now")
    p_once.add_argument("--message", "-m", default=None)
    p_once.add_argument("--no-push", action="store_true")
    p_once.set_defaults(func=cmd_once)

    sub.add_parser("status", help="show checkpoint status").set_defaults(func=cmd_status)
    sub.add_parser("stop", help="stop the supervisor").set_defaults(func=cmd_stop)

    p_ready = sub.add_parser("ready", help="mark completed paths as safe to checkpoint")
    p_ready.add_argument("paths", nargs="+")
    p_ready.set_defaults(func=cmd_ready)

    p_unready = sub.add_parser("unready", help="remove paths from the ready set")
    p_unready.add_argument("paths", nargs="+")
    p_unready.set_defaults(func=cmd_unready)

    p_pause = sub.add_parser("pause", help="suspend checkpoints (asset export, bulk edit)")
    p_pause.add_argument("--reason", default="manual pause")
    p_pause.set_defaults(func=cmd_pause)

    sub.add_parser("resume", help="resume checkpoints").set_defaults(func=cmd_resume)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
