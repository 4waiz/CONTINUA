# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-AB8A76D2E21D
"""
The emulation capability probe must describe this host truthfully.

These tests stub the shell so they run anywhere; they check the probe's
reasoning, not the host. The real probe's output for this machine is in
`data/emulation_capability.json`.
"""

from __future__ import annotations

import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "services" / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from continua_engine.emulation import adapter, capability  # noqa: E402

NO_DISTRO = (
    "Windows Subsystem for Linux has no installed distributions.\n"
    "You can resolve this by installing a distribution with the instructions below:"
)


def _fake_shell(responses: dict[str, tuple[int, str]], default=(1, "")):
    def shell(command: str, timeout: int = 25, as_root: bool = False):
        key = ("root:" if as_root else "") + command
        if key in responses:
            return responses[key]
        if command in responses:
            return responses[command]
        return default

    return shell


def test_wsl_without_a_distribution_is_one_blocker_not_a_missing_toolchain(monkeypatch):
    monkeypatch.setattr(capability.platform, "system", lambda: "Windows")
    monkeypatch.setattr(capability.shutil, "which", lambda name: "C:\\Windows\\system32\\wsl.exe")
    monkeypatch.setattr(capability, "_shell", _fake_shell({"uname -r": (0, NO_DISTRO)}))
    report = capability.probe()
    assert report.probe_target == "wsl"
    assert report.emulation_supported is False
    assert report.mptcp_supported is False
    kernel = next(check for check in report.checks if check.name == "kernel")
    assert kernel.ok is False, "WSL's error text must not be read as a kernel release"
    assert any("no Linux distribution" in reason for reason in report.blocking_reasons)
    assert not any("iproute2" in reason for reason in report.blocking_reasons)
    assert "Nothing was executed" in report.summary


def test_root_shell_through_wsl_satisfies_the_privilege_requirement(monkeypatch):
    monkeypatch.setattr(capability.platform, "system", lambda: "Windows")
    monkeypatch.setattr(capability.shutil, "which", lambda name: "C:\\Windows\\system32\\wsl.exe")
    responses = {
        "uname -r": (0, "6.6.87.2-microsoft-standard-WSL2"),
        "sysctl -n net.mptcp.enabled 2>/dev/null": (1, ""),
        "ip -V": (0, "ip utility, iproute2-6.1.0"),
        "tc -V": (0, "tc utility, iproute2-6.1.0"),
        "modinfo sch_netem 2>&1 | head -1": (0, "filename: sch_netem.ko"),
        "command -v ss": (0, "/usr/bin/ss"),
        "command -v tcpdump": (1, ""),
        "command -v python3": (0, "/usr/bin/python3"),
        "sudo -n true 2>/dev/null": (1, ""),
        "root:id -u": (0, "0"),
        "test -w /var/run/netns 2>/dev/null || test -d /var/run/netns": (0, ""),
    }
    monkeypatch.setattr(capability, "_shell", _fake_shell(responses, default=(1, "")))
    report = capability.probe()
    privilege = next(check for check in report.checks if check.name == "privilege")
    assert privilege.ok is True and privilege.value == "wsl -u root"
    assert report.emulation_supported is True, report.blocking_reasons
    assert report.mptcp_supported is False
    assert "WITHOUT MPTCP" in report.summary
    # The adapter routes privileged commands through the root shell, not sudo.
    seen: list[tuple[str, bool]] = []

    def record(command: str, timeout: int = 40, as_root: bool = False):
        seen.append((command, as_root))
        return 0, ""

    monkeypatch.setattr(adapter, "_shell", record)
    emu = adapter.LinuxEmulationAdapter(report)
    emu.cleanup()
    assert seen and seen[-1][1] is True and "cleanup.sh" in seen[-1][0]
    assert "sudo" not in seen[-1][0]


def test_without_any_route_to_root_the_adapter_refuses(monkeypatch):
    monkeypatch.setattr(capability.platform, "system", lambda: "Windows")
    monkeypatch.setattr(capability.shutil, "which", lambda name: "C:\\Windows\\system32\\wsl.exe")
    responses = {
        "uname -r": (0, "6.6.87.2-microsoft-standard-WSL2"),
        "ip -V": (0, "ip utility"),
        "tc -V": (0, "tc utility"),
        "modinfo sch_netem 2>&1 | head -1": (0, "filename: sch_netem.ko"),
        "command -v python3": (0, "/usr/bin/python3"),
        "root:id -u": (0, "1000"),
    }
    monkeypatch.setattr(capability, "_shell", _fake_shell(responses, default=(1, "")))
    report = capability.probe()
    assert report.emulation_supported is False
    assert "missing capability: privilege" in report.blocking_reasons
    emu = adapter.LinuxEmulationAdapter(report)
    try:
        emu.setup()
    except adapter.EmulationUnavailable as exc:
        assert "not available" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("setup must refuse without a route to root")
