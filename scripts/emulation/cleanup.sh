#!/usr/bin/env bash
#
# CONTINUA emulation topology — cleanup.
#
# Idempotent. Removes ONLY the project-prefixed namespaces and veth devices.
# Touches no host route, no host firewall rule and no interface outside the
# topology. Safe to run when nothing exists.
#
# Usage:  sudo ./scripts/emulation/cleanup.sh [--quiet]
set -uo pipefail

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1
say() { [[ ${QUIET} -eq 1 ]] || echo "$@"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "error: must run as root. sudo $0" >&2
  exit 1
fi

for ns in continua-rover continua-gw; do
  if ip netns list 2>/dev/null | grep -qw "${ns}"; then
    say "· deleting namespace ${ns}"
    ip netns delete "${ns}" 2>/dev/null || true
  fi
done

# Any veth left in the root namespace after a partial setup.
for dev in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | cut -d'@' -f1 | grep '^cnt-' || true); do
  say "· deleting leftover device ${dev}"
  ip link delete "${dev}" 2>/dev/null || true
done

say "cleanup complete. Host routing and firewall were not modified."
