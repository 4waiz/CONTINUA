'use client';

/**
 * Network visualisation.
 *
 * Three separate ideas, drawn three separate ways so they can never be confused:
 *
 *   COVERAGE     — translucent ground footprints, only when toggled on.
 *   ACTIVE LINK  — one bright beam from the rover's roof to the serving site.
 *   WARMING LINK — the same beam, faint, for a link being pre-established.
 *
 * There is never a chain from wired to Wi-Fi to 5G to satellite: they are
 * alternative links to one gateway, and at most one carries the session.
 * Wired is drawn only while the rover is actually tethered at the dock.
 */

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ComponentRef } from 'react';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { AccessNetworkId } from '@continua/contracts';
import { NETWORK_COLOR } from '../theme';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { coverageAt, SITES } from '../world/sites';
import { terrain } from '../world/terrain';

const BEAM_SEGMENTS = 32;
/** Where the beam attaches on the rover: the roof sensor mast. */
const ROVER_ANTENNA = new Vector3(-0.6, 2.25, 0);

// ---------------------------------------------------------------------------
// Coverage footprints
// ---------------------------------------------------------------------------

/** A filled disc whose vertices follow the terrain, so it never clips through. */
function buildFootprint(cx: number, cz: number, radius: number): BufferGeometry {
  const rings = 6;
  const segments = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  const lift = 0.22;

  positions.push(cx, terrain.height(cx, cz) + lift, cz);
  for (let ring = 1; ring <= rings; ring += 1) {
    const r = (radius * ring) / rings;
    for (let s = 0; s < segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      positions.push(x, terrain.height(x, z) + lift, z);
    }
  }
  for (let s = 0; s < segments; s += 1) {
    indices.push(0, 1 + s, 1 + ((s + 1) % segments));
  }
  for (let ring = 0; ring < rings - 1; ring += 1) {
    const inner = 1 + ring * segments;
    const outer = inner + segments;
    for (let s = 0; s < segments; s += 1) {
      const next = (s + 1) % segments;
      indices.push(inner + s, outer + s, inner + next);
      indices.push(inner + next, outer + s, outer + next);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const FOOTPRINT_RADIUS: Partial<Record<AccessNetworkId, number>> = {
  wired: 9,
  wifi: 155,
  cellular: 330,
};

export function CoverageOverlay({ visible }: { visible: boolean }) {
  const footprints = useMemo(
    () =>
      SITES.filter((site) => site.network && FOOTPRINT_RADIUS[site.network]).map((site) => ({
        id: site.id,
        network: site.network!,
        geometry: buildFootprint(site.x, site.z, FOOTPRINT_RADIUS[site.network!]!),
      })),
    [],
  );

  if (!visible) return null;
  return (
    <group name="CONTINUA_Coverage">
      {footprints.map((footprint) => (
        <mesh key={footprint.id} geometry={footprint.geometry} renderOrder={4}>
          <meshBasicMaterial
            color={NETWORK_COLOR[footprint.network]}
            transparent
            opacity={0.09}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Link beams
// ---------------------------------------------------------------------------

function siteForNetwork(network: AccessNetworkId, x: number, z: number) {
  const candidates = SITES.filter((site) => site.network === network);
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestDistance = Infinity;
  for (const site of candidates) {
    const distance = Math.hypot(site.x - x, site.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = site;
    }
  }
  return best;
}

/**
 * A sagging arc between the rover and a site.
 *
 * The wired tether sags downward like a real cable; radio links bow upward,
 * which keeps the two visually distinct at a glance.
 */
function writeArc(
  target: Float32Array,
  from: Vector3,
  to: Vector3,
  sag: number,
): void {
  for (let i = 0; i <= BEAM_SEGMENTS; i += 1) {
    const t = i / BEAM_SEGMENTS;
    const bow = Math.sin(t * Math.PI) * sag;
    target[i * 3] = from.x + (to.x - from.x) * t;
    target[i * 3 + 1] = from.y + (to.y - from.y) * t + bow;
    target[i * 3 + 2] = from.z + (to.z - from.z) * t;
  }
}

function Beam({
  network,
  role,
}: {
  network: AccessNetworkId;
  role: 'active' | 'warming';
}) {
  const { frame } = useSceneRuntime();
  const ref = useRef<ComponentRef<typeof Line>>(null);
  const points = useMemo(() => new Float32Array((BEAM_SEGMENTS + 1) * 3), []);
  const from = useMemo(() => new Vector3(), []);
  const to = useMemo(() => new Vector3(), []);
  const initial = useMemo(
    () => Array.from({ length: BEAM_SEGMENTS + 1 }, () => [0, 0, 0] as [number, number, number]),
    [],
  );

  useFrame(() => {
    const line = ref.current;
    if (!line) return;
    const state = frame.current;
    const status = state.links[network];
    const isActive = role === 'active' ? state.active === network : state.warming.includes(network);
    const usable = isActive && status.state !== 'unavailable';

    // Wired only exists while physically tethered.
    if (network === 'wired' && !status.tethered) {
      line.visible = false;
      return;
    }
    const site = siteForNetwork(network, state.vehicle.position.x, state.vehicle.position.z);
    if (!usable || !site) {
      line.visible = false;
      return;
    }
    line.visible = true;

    const heading = state.vehicle.heading;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    from.set(
      state.vehicle.position.x + ROVER_ANTENNA.x * cos - ROVER_ANTENNA.z * sin,
      state.vehicle.position.y + ROVER_ANTENNA.y,
      state.vehicle.position.z - ROVER_ANTENNA.x * sin - ROVER_ANTENNA.z * cos,
    );
    to.set(site.x, terrain.height(site.x, site.z) + (site.linkHeight ?? 3), site.z);

    const span = from.distanceTo(to);
    const sag = network === 'wired' ? -Math.min(0.6, span * 0.12) : Math.min(14, span * 0.11);
    writeArc(points, from, to, sag);
    line.geometry.setPositions(Array.from(points));
    line.computeLineDistances();
  });

  return (
    <Line
      ref={ref}
      points={initial}
      color={NETWORK_COLOR[network]}
      lineWidth={role === 'active' ? 2.6 : 1.4}
      transparent
      opacity={role === 'active' ? 0.92 : 0.4}
      dashed={role === 'warming'}
      dashSize={2.4}
      gapSize={2.0}
      depthWrite={false}
      renderOrder={6}
    />
  );
}

export function LinkBeams() {
  return (
    <group name="CONTINUA_Links">
      {(['wired', 'wifi', 'cellular', 'satellite'] as const).map((network) => (
        <Beam key={`active-${network}`} network={network} role="active" />
      ))}
      {(['wifi', 'cellular', 'satellite'] as const).map((network) => (
        <Beam key={`warm-${network}`} network={network} role="warming" />
      ))}
    </group>
  );
}

/** Exposed so tests can assert the coverage model without a renderer. */
export const coverageProbe = coverageAt;
