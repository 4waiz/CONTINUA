"""
Linux emulation adapter.

Drives the namespace topology created by `scripts/emulation/*.sh` and records
what the kernel actually did. It is deliberately conservative:

* It refuses to run at all unless `capability.probe()` says every required
  capability is genuinely present.
* It never claims MPTCP. `verify()` inspects `ss` output and records the
  protocol that was actually negotiated; a plain-TCP fallback is recorded as
  plain TCP, and the run's protocol verification is stored alongside its
  metrics.
* It runs no command constructed from user input. The topology is fixed, the
  script paths are fixed, and the only variables are numbers that have already
  been range-checked.
* It never touches the host default route or firewall — that is enforced in the
  shell scripts, and this module only ever invokes those scripts.

**Status on the development host: NOT VERIFIED HERE.** The WSL2 kernel has
`CONFIG_MPTCP` unset and passwordless sudo is unavailable, so no emulation run
has been executed. Writing this adapter is not the same as having run an
experiment, and nothing in the project reports otherwise.
"""

from __future__ import annotations

import json
import platform
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .capability import CapabilityReport, probe

SCRIPT_DIR = Path(__file__).resolve().parents[4] / "scripts" / "emulation"
ROVER_NS = "continua-rover"
GW_NS = "continua-gw"

LINK_SUBNETS = {"wired": 11, "wifi": 12, "cellular": 13, "satellite": 14}


class EmulationUnavailable(RuntimeError):
    """Raised instead of silently degrading to something that is not emulation."""


@dataclass
class ProtocolVerification:
    """What the kernel actually negotiated. Recorded with every emulation run."""

    checked_at: str
    mptcp_endpoints_configured: bool
    mptcp_subflows_observed: int
    transport: str  # "mptcp" | "tcp" | "unknown"
    evidence: list[str] = field(default_factory=list)
    verdict: str = ""


@dataclass
class TopologyState:
    created_at: str
    namespaces: list[str]
    links: dict[str, str]
    shaping: dict[str, str]


def _shell(command: str, timeout: int = 40) -> tuple[int, str]:
    if platform.system() == "Linux":
        result = subprocess.run(["bash", "-lc", command], capture_output=True, text=True, timeout=timeout)
    elif shutil.which("wsl.exe"):
        result = subprocess.run(
            ["wsl.exe", "--", "bash", "-lc", command], capture_output=True, text=True, timeout=timeout
        )
    else:
        return 127, "no Linux shell available"
    return result.returncode, (result.stdout + result.stderr).replace("\x00", "").strip()


class LinuxEmulationAdapter:
    """Sets up, verifies and tears down the emulation topology."""

    def __init__(self, report: CapabilityReport | None = None) -> None:
        self.report = report or probe()

    # -- gating --------------------------------------------------------------

    def require_supported(self) -> None:
        if not self.report.emulation_supported:
            raise EmulationUnavailable(
                "Emulation is not available on this host: "
                + "; ".join(self.report.blocking_reasons)
                + ". The simulator is unaffected."
            )

    @property
    def may_claim_mptcp(self) -> bool:
        return self.report.mptcp_supported

    # -- lifecycle -----------------------------------------------------------

    def setup(self) -> TopologyState:
        """Create the topology. Requires privilege; refuses if unsupported."""
        self.require_supported()
        code, output = _shell(f"sudo -n bash {SCRIPT_DIR.as_posix()}/setup.sh", timeout=180)
        if code != 0:
            raise EmulationUnavailable(f"setup.sh failed (exit {code}):\n{output}")
        return self.inspect()

    def cleanup(self) -> str:
        """Idempotent teardown. Safe to call when nothing exists."""
        _code, output = _shell(f"sudo -n bash {SCRIPT_DIR.as_posix()}/cleanup.sh", timeout=90)
        return output

    def inspect(self) -> TopologyState:
        _c, namespaces = _shell("ip netns list 2>/dev/null | awk '{print $1}'")
        _c, addresses = _shell(f"sudo -n ip netns exec {ROVER_NS} ip -brief addr show 2>/dev/null")
        shaping: dict[str, str] = {}
        for link in LINK_SUBNETS:
            device = f"cnt-{link}-r"
            _c, qdisc = _shell(
                f"sudo -n ip netns exec {ROVER_NS} tc qdisc show dev {device} 2>/dev/null"
            )
            if qdisc:
                shaping[link] = qdisc
        links = {}
        for line in addresses.splitlines():
            parts = line.split()
            if parts and parts[0].startswith("cnt-"):
                links[parts[0]] = parts[-1] if len(parts) > 2 else ""
        return TopologyState(
            created_at=datetime.now(timezone.utc).isoformat(),
            namespaces=[n for n in namespaces.split() if n.startswith("continua-")],
            links=links,
            shaping=shaping,
        )

    # -- verification --------------------------------------------------------

    def verify(self) -> ProtocolVerification:
        """Inspect what the kernel negotiated. Never optimistic."""
        evidence: list[str] = []

        code, endpoints = _shell(f"sudo -n ip netns exec {ROVER_NS} ip mptcp endpoint show 2>&1")
        endpoints_ok = code == 0 and "Error" not in endpoints and bool(endpoints.strip())
        evidence.append(f"ip mptcp endpoint show -> exit {code}: {endpoints[:200] or '(empty)'}")

        # `ss -tanM` lists MPTCP sockets specifically. No output means no MPTCP.
        code, sockets = _shell(f"sudo -n ip netns exec {ROVER_NS} ss -tanM 2>&1")
        subflow_lines = [line for line in sockets.splitlines() if re.search(r"\d+\.\d+\.\d+\.\d+", line)]
        subflows = len(subflow_lines)
        evidence.append(f"ss -tanM -> exit {code}, {subflows} socket line(s)")

        code, tcp_sockets = _shell(f"sudo -n ip netns exec {ROVER_NS} ss -tan 2>&1")
        tcp_lines = [line for line in tcp_sockets.splitlines() if "ESTAB" in line]
        evidence.append(f"ss -tan -> {len(tcp_lines)} established TCP socket(s)")

        if not self.report.mptcp_supported:
            transport = "tcp" if tcp_lines else "unknown"
            verdict = (
                "Kernel MPTCP is unavailable. Any traffic carried over this topology is plain "
                "TCP/UDP. This run must NOT be described as MPTCP."
            )
        elif subflows >= 2:
            transport = "mptcp"
            verdict = f"MPTCP verified: {subflows} subflows observed on live sockets."
        elif endpoints_ok:
            transport = "tcp"
            verdict = (
                "MPTCP endpoints are configured but no multi-subflow socket was observed. "
                "Treat this run as plain TCP until subflows are seen."
            )
        else:
            transport = "unknown"
            verdict = "Could not determine the transport. Do not claim MPTCP."

        return ProtocolVerification(
            checked_at=datetime.now(timezone.utc).isoformat(),
            mptcp_endpoints_configured=endpoints_ok,
            mptcp_subflows_observed=subflows,
            transport=transport,
            evidence=evidence,
            verdict=verdict,
        )

    # -- reporting -----------------------------------------------------------

    def status(self) -> dict:
        """A complete, honest description of what this host can do."""
        payload: dict = {
            "capability": self.report.to_dict(),
            "scripts": {
                "setup": str(SCRIPT_DIR / "setup.sh"),
                "cleanup": str(SCRIPT_DIR / "cleanup.sh"),
                "verify": str(SCRIPT_DIR / "verify.sh"),
            },
            "topology": {
                "rover_namespace": ROVER_NS,
                "gateway_namespace": GW_NS,
                "links": {name: f"10.90.{octet}.0/24" for name, octet in LINK_SUBNETS.items()},
            },
            "limitations": [
                "The cellular and satellite links are traffic-shaped ACCESS-NETWORK PROFILES. "
                "They are not radio simulations, 5G core implementations or satellite "
                "constellation models. Nothing here models RAN scheduling, handover signalling, "
                "beam steering or orbital dynamics.",
                "Shaping is netem delay/jitter/loss plus a token bucket rate limit, applied in "
                "both directions.",
                "MPTCP is only claimed when `ss` shows multiple subflows on a live socket.",
            ],
        }
        if not self.report.emulation_supported:
            payload["status"] = "NOT VERIFIED HERE"
            payload["reason"] = self.report.blocking_reasons
        else:
            payload["status"] = "AVAILABLE (not yet executed)"
        return payload


def main() -> None:  # pragma: no cover
    import argparse

    parser = argparse.ArgumentParser(description="CONTINUA Linux emulation adapter")
    parser.add_argument("command", choices=["status", "setup", "verify", "cleanup"])
    args = parser.parse_args()

    adapter = LinuxEmulationAdapter()
    if args.command == "status":
        print(json.dumps(adapter.status(), indent=2))
        return
    if args.command == "cleanup":
        print(adapter.cleanup())
        return
    try:
        if args.command == "setup":
            print(json.dumps(asdict(adapter.setup()), indent=2))
        else:
            print(json.dumps(asdict(adapter.verify()), indent=2))
    except EmulationUnavailable as exc:
        print(f"EMULATION UNAVAILABLE: {exc}")
        raise SystemExit(2) from exc


if __name__ == "__main__":  # pragma: no cover
    main()
