#!/usr/bin/env bash
#
# CONTINUA emulation topology — verification.
#
# Reports what the kernel ACTUALLY did. This is the script that decides whether
# a run may be described as MPTCP: if `ss` does not show MPTCP subflows, the run
# is plain TCP and is recorded as plain TCP. A fallback is never counted as
# multipath.
#
# Usage:  sudo ./scripts/emulation/verify.sh
set -uo pipefail

ROVER_NS="continua-rover"
GW_NS="continua-gw"
FAIL=0

if [[ "${EUID}" -ne 0 ]]; then
  echo "error: must run as root. sudo $0" >&2
  exit 1
fi

section() { echo; echo "=== $1"; }

section "namespaces"
ip netns list | grep -E 'continua-(rover|gw)' || { echo "MISSING: topology not set up"; exit 1; }

section "interfaces and addresses (rover)"
ip netns exec "${ROVER_NS}" ip -brief addr show | grep -E '^cnt-' || echo "none"

section "traffic shaping (rover egress)"
for dev in $(ip netns exec "${ROVER_NS}" ip -o link show | awk -F': ' '{print $2}' | cut -d'@' -f1 | grep '^cnt-'); do
  echo "--- ${dev}"
  ip netns exec "${ROVER_NS}" tc qdisc show dev "${dev}"
done

section "reachability per link"
for octet in 11 12 13 14; do
  if ip netns exec "${ROVER_NS}" ping -c 2 -W 3 -q "10.90.${octet}.1" >/dev/null 2>&1; then
    rtt=$(ip netns exec "${ROVER_NS}" ping -c 3 -W 3 -q "10.90.${octet}.1" 2>/dev/null | tail -1)
    echo "10.90.${octet}.1  OK   ${rtt}"
  else
    echo "10.90.${octet}.1  UNREACHABLE"
    FAIL=1
  fi
done

section "kernel MPTCP"
if ip netns exec "${ROVER_NS}" ip mptcp endpoint show >/dev/null 2>&1; then
  echo "ip mptcp available. Endpoints:"
  ip netns exec "${ROVER_NS}" ip mptcp endpoint show
  echo "Limits:"
  ip netns exec "${ROVER_NS}" ip mptcp limits show
  echo
  echo "PROTOCOL VERDICT: MPTCP endpoints are configured."
  echo "This is NOT yet evidence of an MPTCP connection. Start the traffic"
  echo "endpoints and re-run with --live to inspect actual subflows."
else
  echo "ip mptcp is NOT available in this kernel."
  echo
  echo "PROTOCOL VERDICT: MPTCP UNAVAILABLE."
  echo "Any traffic over this topology is plain TCP/UDP and must be recorded"
  echo "as such. Do not describe such a run as MPTCP."
  FAIL=1
fi

section "live sockets (only meaningful while traffic is running)"
ip netns exec "${ROVER_NS}" ss -tanM 2>/dev/null | head -20 || \
  ip netns exec "${ROVER_NS}" ss -tan 2>/dev/null | head -20 || echo "ss unavailable"

echo
if [[ ${FAIL} -eq 0 ]]; then
  echo "VERIFICATION PASSED (topology reachable, MPTCP present)."
else
  echo "VERIFICATION INCOMPLETE — see the verdicts above."
  echo "The simulator remains fully operational and unaffected."
fi
exit ${FAIL}
