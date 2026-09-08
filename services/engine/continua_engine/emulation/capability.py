"""
Emulation capability probe.

Emulation mode is only ever offered after this probe has actually run and every
required capability has actually been found. There is no "assume it works"
path, and creating the setup scripts does not count as having executed an
experiment.

The probe is read-only. It runs no privileged command and changes nothing.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Check:
    name: str
    required_for: str
    ok: bool
    detail: str
    value: str | None = None


@dataclass
class CapabilityReport:
    generated_at: str
    host_platform: str
    probe_target: str
    checks: list[Check] = field(default_factory=list)
    emulation_supported: bool = False
    mptcp_supported: bool = False
    blocking_reasons: list[str] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            **{k: v for k, v in asdict(self).items() if k != "checks"},
            "checks": [asdict(c) for c in self.checks],
        }


def _run(cmd: list[str], timeout: int = 20) -> tuple[int, str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode, (result.stdout + result.stderr).strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, f"{exc!r}"


def _wsl_available() -> bool:
    return platform.system() == "Windows" and shutil.which("wsl.exe") is not None


def _shell(command: str, timeout: int = 25) -> tuple[int, str]:
    """Run a shell command on Linux, or inside WSL when the host is Windows."""
    if platform.system() == "Linux":
        return _run(["bash", "-lc", command], timeout=timeout)
    if _wsl_available():
        code, out = _run(["wsl.exe", "--", "bash", "-lc", command], timeout=timeout)
        # WSL sometimes returns UTF-16-ish output through the Windows console.
        return code, out.replace("\x00", "")
    return 127, "no Linux shell available on this host"


def probe() -> CapabilityReport:
    target = (
        "linux"
        if platform.system() == "Linux"
        else ("wsl" if _wsl_available() else "unavailable")
    )
    report = CapabilityReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        host_platform=f"{platform.system()} {platform.release()}",
        probe_target=target,
    )

    if target == "unavailable":
        report.checks.append(
            Check(
                "linux_shell",
                "all emulation",
                False,
                "No Linux shell. Emulation needs network namespaces, which are a Linux kernel feature.",
            )
        )
        report.blocking_reasons.append("no Linux environment available on this host")
        report.summary = "Emulation NOT AVAILABLE on this host. Simulation mode is unaffected."
        return report

    # --- kernel ------------------------------------------------------------
    _, kernel = _shell("uname -r")
    report.checks.append(Check("kernel", "all emulation", bool(kernel), "Linux kernel release", kernel))

    # --- MPTCP -------------------------------------------------------------
    code, mptcp_sysctl = _shell("sysctl -n net.mptcp.enabled 2>/dev/null")
    sysctl_ok = code == 0 and mptcp_sysctl.strip() in {"0", "1"}
    _, mptcp_config = _shell(
        "(zcat /proc/config.gz 2>/dev/null || cat /boot/config-$(uname -r) 2>/dev/null) | grep -i '^CONFIG_MPTCP' || true"
    )
    mptcp_built = "CONFIG_MPTCP=y" in mptcp_config or "CONFIG_MPTCP=m" in mptcp_config
    report.mptcp_supported = bool(sysctl_ok and mptcp_built)
    report.checks.append(
        Check(
            "kernel_mptcp",
            "MPTCP claims",
            report.mptcp_supported,
            "Kernel MPTCP support (net.mptcp.enabled and CONFIG_MPTCP)",
            f"sysctl={mptcp_sysctl or 'absent'}; config={mptcp_config.strip() or 'absent'}",
        )
    )

    code, ip_mptcp = _shell("ip mptcp endpoint show 2>&1 | head -2")
    report.checks.append(
        Check(
            "ip_mptcp",
            "MPTCP claims",
            code == 0 and "Error" not in ip_mptcp,
            "iproute2 `ip mptcp` subcommand talks to the kernel",
            ip_mptcp,
        )
    )

    # --- namespaces and shaping --------------------------------------------
    for command, name, label, needed in (
        ("ip -V", "iproute2", "iproute2 present", "namespaces and shaping"),
        ("tc -V", "tc", "tc present", "traffic shaping"),
        ("modinfo sch_netem 2>&1 | head -1", "sch_netem", "netem qdisc module", "delay/loss shaping"),
        ("command -v ss", "ss", "ss present", "subflow inspection"),
        ("command -v tcpdump", "tcpdump", "tcpdump present", "packet capture verification"),
        ("command -v python3", "python3", "python3 present", "traffic endpoints"),
    ):
        code, out = _shell(command)
        report.checks.append(Check(name, needed, code == 0 and bool(out), label, out.splitlines()[0] if out else ""))

    # --- privilege ----------------------------------------------------------
    code, _ = _shell("sudo -n true 2>/dev/null")
    passwordless = code == 0
    report.checks.append(
        Check(
            "sudo_nopasswd",
            "namespace creation",
            passwordless,
            "Passwordless sudo (required to create namespaces and qdiscs non-interactively)",
            "available" if passwordless else "password required",
        )
    )

    code, _ = _shell("test -w /var/run/netns 2>/dev/null || test -d /var/run/netns")
    report.checks.append(
        Check("netns_dir", "namespace creation", code == 0, "/var/run/netns exists", "present" if code == 0 else "absent")
    )

    # --- Mininet-WiFi (optional) -------------------------------------------
    code, _ = _shell("python3 -c 'import mn_wifi' 2>/dev/null")
    report.checks.append(
        Check("mininet_wifi", "optional richer topologies", code == 0, "Mininet-WiFi importable", "yes" if code == 0 else "no")
    )

    # --- verdict ------------------------------------------------------------
    required = {"iproute2", "tc", "sch_netem", "python3", "sudo_nopasswd"}
    failed = [c.name for c in report.checks if c.name in required and not c.ok]
    report.emulation_supported = not failed
    if failed:
        report.blocking_reasons.extend(f"missing capability: {name}" for name in failed)
    if not report.mptcp_supported:
        report.blocking_reasons.append(
            "kernel MPTCP is unavailable, so no run on this host may be described as verified MPTCP"
        )

    if report.emulation_supported and report.mptcp_supported:
        report.summary = "Emulation available WITH kernel MPTCP."
    elif report.emulation_supported:
        report.summary = (
            "Emulation available WITHOUT MPTCP: namespaces and netem shaping work, so real "
            "sockets over shaped links can be tested, but multipath transport cannot."
        )
    else:
        report.summary = (
            "Emulation NOT VERIFIED HERE. " + "; ".join(report.blocking_reasons) + ". "
            "Simulation mode is fully operational and unaffected."
        )
    return report


def write_report(path: Path | None = None) -> Path:
    report = probe()
    target = path or (
        Path(os.environ.get("CONTINUA_DATA_DIR") or Path(__file__).resolve().parents[4] / "data")
        / "emulation_capability.json"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    return target


if __name__ == "__main__":  # pragma: no cover
    result = probe()
    print(json.dumps(result.to_dict(), indent=2))
    print("\n" + result.summary)
