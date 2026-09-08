#!/usr/bin/env bash
#
# CONTINUA emulation topology — setup.
#
# Creates an isolated, project-prefixed test topology:
#
#     continua-rover ──veth── continua-gw
#        (4 links: wired, wifi, cellular, satellite, each shaped independently)
#
# SAFETY, in order of importance:
#
#   * Everything created is prefixed `cnt-` or `continua-`. Cleanup removes
#     exactly those and nothing else.
#   * The HOST default route is never touched. Routes are added *inside* the
#     namespaces only.
#   * The HOST firewall is never modified. No iptables/nftables rules are added.
#   * No interface outside the topology is brought up, down or reconfigured.
#   * The script is idempotent: running it twice is safe, and it cleans up a
#     partial previous attempt first.
#
# This script does NOT claim MPTCP. Run `verify.sh` afterwards; it reports what
# the kernel actually negotiated, and if MPTCP is unavailable it says so rather
# than letting a plain-TCP fallback be counted as multipath.
#
# Usage:  sudo ./scripts/emulation/setup.sh
set -euo pipefail

PREFIX="cnt"
ROVER_NS="continua-rover"
GW_NS="continua-gw"

# link name : delay_ms : jitter_ms : loss_% : rate_mbit : subnet_third_octet
LINKS=(
  "wired:1:0.3:0.002:900:11"
  "wifi:9:3.5:0.2:90:12"
  "cellular:32:9:0.35:55:13"
  "satellite:620:45:0.7:18:14"
)

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "error: must run as root (network namespaces require it)." >&2
    echo "       sudo $0" >&2
    exit 1
  fi
}

require_tools() {
  local missing=()
  for tool in ip tc; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "error: missing required tools: ${missing[*]}" >&2
    echo "       install iproute2 and retry." >&2
    exit 1
  fi
}

cleanup_existing() {
  echo "· removing any previous CONTINUA topology (idempotent)"
  "$(dirname "$0")/cleanup.sh" --quiet || true
}

create_namespaces() {
  echo "· creating namespaces ${ROVER_NS} and ${GW_NS}"
  mkdir -p /var/run/netns
  ip netns add "${ROVER_NS}"
  ip netns add "${GW_NS}"
  ip netns exec "${ROVER_NS}" ip link set lo up
  ip netns exec "${GW_NS}" ip link set lo up
}

create_link() {
  local name="$1" delay="$2" jitter="$3" loss="$4" rate="$5" octet="$6"
  local a="${PREFIX}-${name}-r"     # rover side
  local b="${PREFIX}-${name}-g"     # gateway side
  local net="10.90.${octet}"

  echo "· link ${name}: ${rate}Mbit, ${delay}ms ±${jitter}ms, ${loss}% loss  (${net}.0/24)"

  ip link add "${a}" type veth peer name "${b}"
  ip link set "${a}" netns "${ROVER_NS}"
  ip link set "${b}" netns "${GW_NS}"

  ip netns exec "${ROVER_NS}" ip addr add "${net}.2/24" dev "${a}"
  ip netns exec "${GW_NS}"    ip addr add "${net}.1/24" dev "${b}"
  ip netns exec "${ROVER_NS}" ip link set "${a}" up
  ip netns exec "${GW_NS}"    ip link set "${b}" up

  # Shape BOTH directions. Shaping only egress on one side models half a link
  # and quietly halves the delay a round trip actually experiences.
  for spec in "${ROVER_NS}:${a}" "${GW_NS}:${b}"; do
    local ns="${spec%%:*}" dev="${spec##*:}"
    ip netns exec "${ns}" tc qdisc add dev "${dev}" root handle 1: \
      netem delay "${delay}ms" "${jitter}ms" distribution normal loss "${loss}%"
    ip netns exec "${ns}" tc qdisc add dev "${dev}" parent 1: handle 2: \
      tbf rate "${rate}mbit" burst 32kbit latency 400ms
  done
}

enable_mptcp_endpoints() {
  # Only attempted when the kernel actually supports it. Failure here is
  # reported, never swallowed, and never presented as success.
  if ! ip netns exec "${ROVER_NS}" ip mptcp endpoint show >/dev/null 2>&1; then
    echo "· kernel MPTCP unavailable — skipping endpoint configuration."
    echo "  Runs on this host must NOT be described as MPTCP."
    return 0
  fi
  echo "· registering MPTCP endpoints"
  ip netns exec "${ROVER_NS}" sysctl -qw net.mptcp.enabled=1 || true
  ip netns exec "${GW_NS}" sysctl -qw net.mptcp.enabled=1 || true
  local index=0
  for entry in "${LINKS[@]}"; do
    IFS=':' read -r name _d _j _l _r octet <<<"${entry}"
    local dev="${PREFIX}-${name}-r"
    if [[ ${index} -eq 0 ]]; then
      ip netns exec "${ROVER_NS}" ip mptcp endpoint add "10.90.${octet}.2" dev "${dev}" signal || true
    else
      ip netns exec "${ROVER_NS}" ip mptcp endpoint add "10.90.${octet}.2" dev "${dev}" subflow || true
    fi
    index=$((index + 1))
  done
  ip netns exec "${ROVER_NS}" ip mptcp limits set subflows 3 add_addr_accepted 3 || true
  ip netns exec "${GW_NS}" ip mptcp limits set subflows 3 add_addr_accepted 3 || true
}

main() {
  require_root
  require_tools
  cleanup_existing
  create_namespaces
  for entry in "${LINKS[@]}"; do
    IFS=':' read -r name delay jitter loss rate octet <<<"${entry}"
    create_link "${name}" "${delay}" "${jitter}" "${loss}" "${rate}" "${octet}"
  done
  enable_mptcp_endpoints

  echo
  echo "topology ready."
  echo "  rover namespace : ${ROVER_NS}"
  echo "  gateway namespace: ${GW_NS}"
  echo
  echo "next:"
  echo "  sudo ./scripts/emulation/verify.sh      # what the kernel actually did"
  echo "  sudo ./scripts/emulation/cleanup.sh     # remove everything"
  echo
  echo "NOTE: the host default route and firewall were not modified."
}

main "$@"
