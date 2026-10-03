'use client';

/**
 * Network visualisation.
 *
 * Three separate ideas, drawn three separate ways so they can never be confused:
 *
 *   COVERAGE    - translucent ground footprints, only when toggled on.
 *   ACTIVE LINK - one bright beam from the rover's roof to the serving site.
 *   WARMING LINK - the same beam, faint, for a link being pre-established.
 *
 * There is never a chain from wired to Wi-Fi to cellular to satellite: they are
 * alternative links to one gateway, and at most one carries the session.
 * Wired is drawn only while the rover is actually tethered at the dock.
 */

import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, type ComponentRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
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

/** A filled disc whose vertices follow the terrain - or the sea over it - so it never clips through. */
function buildFootprint(cx: number, cz: number, radius: number): BufferGeometry {
  const rings = 6;
  const segments = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  const lift = 0.22;

  positions.push(cx, terrain.surfaceHeight(cx, cz) + lift, cz);
  for (let ring = 1; ring <= rings; ring += 1) {
    const r = (radius * ring) / rings;
    for (let s = 0; s < segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      positions.push(x, terrain.surfaceHeight(x, z) + lift, z);
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
 * An arc between the rover and a site, written into `target`.
 *
 * The wired tether sags downward like a real cable; radio links bow upward,
 * which keeps the two visually distinct at a glance.
 */
function arcPoint(from: Vector3, to: Vector3, sag: number, t: number, out: Vector3): Vector3 {
  const bow = Math.sin(t * Math.PI) * sag;
  return out.set(
    from.x + (to.x - from.x) * t,
    from.y + (to.y - from.y) * t + bow,
    from.z + (to.z - from.z) * t,
  );
}

/** Data packets travelling site -> rover along the carrying link, in m/s. */
const PACKET_SPEED = 38;
const PACKETS = 7;
/**
 * Packets, pings and the antenna tip are markers, not objects in the world:
 * they keep a constant size on screen (CSS pixels, radius). A world-sized
 * sphere either vanishes on a beam 300 m long or balloons when the beam passes
 * the camera.
 */
const PACKET_PX = 3.2;
const TIP_PX = 4.2;
const HEAD_PX = 7;

/**
 * A handoff, choreographed - every value a pure function of the clock and the
 * source's record of when the carrying link changed, so a scrubbed or captured
 * frame is exact. The new link reaches out from its site to the rover; the
 * link it replaced lingers as a fading ghost; both ends ping.
 */
const DRAW_S = 0.7;
const GHOST_S = 0.9;
const BURST_S = 1.1;
/** A gentle ping at the serving site, so the eye finds it from anywhere. */
const PING_PERIOD_S = 2.4;

/**
 * Per-point colours for the carrying beam: full strength at the rover, easing
 * to a pale tint at the site, so a beam to a far tower reads as a link rather
 * than a line slashed across the frame.
 */
function beamColours(network: AccessNetworkId): [number, number, number][] {
  const base = new Color(NETWORK_COLOR[network]);
  const pale = base.clone().lerp(new Color('#ffffff'), 0.72);
  return Array.from({ length: BEAM_SEGMENTS + 1 }, (_, i) => {
    const t = i / BEAM_SEGMENTS;
    const mixed = base.clone().lerp(pale, Math.pow(t, 0.8));
    return [mixed.r, mixed.g, mixed.b];
  });
}

function easeOutCubic(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 1 - Math.pow(1 - c, 3);
}

/** Writes the arc between `t0` and `t1` (0 = rover, 1 = site) into `target`. */
function writeArcRange(
  target: Float32Array,
  from: Vector3,
  to: Vector3,
  sag: number,
  t0: number,
  t1: number,
  scratch: Vector3,
): void {
  for (let i = 0; i <= BEAM_SEGMENTS; i += 1) {
    arcPoint(from, to, sag, t0 + ((t1 - t0) * i) / BEAM_SEGMENTS, scratch);
    target[i * 3] = scratch.x;
    target[i * 3 + 1] = scratch.y;
    target[i * 3 + 2] = scratch.z;
  }
}

/** A ring that always faces the camera, sized in CSS pixels. */
function placePing(
  mesh: Mesh | null,
  at: Vector3,
  camera: { position: Vector3; quaternion: Quaternion },
  perPixel: number,
  radiusPx: number,
  opacity: number,
): void {
  if (!mesh) return;
  if (opacity <= 0.004 || radiusPx <= 0) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(at);
  mesh.quaternion.copy(camera.quaternion);
  mesh.scale.setScalar(radiusPx * perPixel * at.distanceTo(camera.position));
  (mesh.material as MeshBasicMaterial).opacity = opacity;
}

function Beam({
  network,
  role,
}: {
  network: AccessNetworkId;
  role: 'active' | 'warming';
}) {
  const { frame, clock } = useSceneRuntime();
  const camera = useThree((state) => state.camera);
  const viewport = useThree((state) => state.size);
  const ref = useRef<ComponentRef<typeof Line>>(null);
  const haloRef = useRef<ComponentRef<typeof Line>>(null);
  const packetsRef = useRef<InstancedMesh>(null);
  const tipRef = useRef<Mesh>(null);
  const headRef = useRef<Mesh>(null);
  const sitePingRef = useRef<Mesh>(null);
  const roverPingRef = useRef<Mesh>(null);
  const points = useMemo(() => new Float32Array((BEAM_SEGMENTS + 1) * 3), []);
  const from = useMemo(() => new Vector3(), []);
  const to = useMemo(() => new Vector3(), []);
  const scratch = useMemo(() => new Vector3(), []);
  const matrix = useMemo(() => new Matrix4(), []);
  const initial = useMemo(
    () => Array.from({ length: BEAM_SEGMENTS + 1 }, () => [0, 0, 0] as [number, number, number]),
    [],
  );
  const colours = useMemo(() => (role === 'active' ? beamColours(network) : undefined), [network, role]);
  const showPackets = role === 'active' && network !== 'wired';
  const packetColour = useMemo(() => new Color(NETWORK_COLOR[network]).lerp(new Color('#ffffff'), 0.35), [network]);

  useFrame(() => {
    const line = ref.current;
    if (!line) return;
    const state = frame.current;
    const status = state.links[network];
    const now = clock.time;
    const handoff = state.handoff ?? null;
    const packets = packetsRef.current;
    const halo = haloRef.current;
    const hide = () => {
      line.visible = false;
      if (halo) halo.visible = false;
      if (packets) packets.visible = false;
      if (tipRef.current) tipRef.current.visible = false;
      if (headRef.current) headRef.current.visible = false;
      if (sitePingRef.current) sitePingRef.current.visible = false;
      if (roverPingRef.current) roverPingRef.current.visible = false;
    };

    let carrying = false;
    let ghost = false;
    let ghostAge = 0;
    if (role === 'active') {
      carrying = state.active === network && status.state !== 'unavailable';
      if (!carrying && handoff && handoff.from === network && handoff.to !== network) {
        ghostAge = now - handoff.at;
        ghost = ghostAge >= 0 && ghostAge < GHOST_S;
      }
    } else {
      carrying = state.warming.includes(network) && status.state !== 'unavailable';
    }
    // Wired only exists while physically tethered - its ghost included.
    if (network === 'wired' && !status.tethered) return hide();
    if (!carrying && !ghost) return hide();
    const site = siteForNetwork(network, state.vehicle.position.x, state.vehicle.position.z);
    if (!site) return hide();
    line.visible = true;

    const heading = state.vehicle.heading;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    from.set(
      state.vehicle.position.x + ROVER_ANTENNA.x * cos - ROVER_ANTENNA.z * sin,
      state.vehicle.position.y + ROVER_ANTENNA.y,
      state.vehicle.position.z - ROVER_ANTENNA.x * sin - ROVER_ANTENNA.z * cos,
    );
    const ax = site.x + (site.linkOffset?.[0] ?? 0);
    const az = site.z + (site.linkOffset?.[1] ?? 0);
    to.set(ax, terrain.height(ax, az) + (site.linkHeight ?? 3), az);

    const span = from.distanceTo(to);
    const sag = network === 'wired' ? -Math.min(0.6, span * 0.12) : Math.min(14, span * 0.11);

    // How much of the carrying beam has reached the rover since it took over.
    const age = role === 'active' && carrying && handoff && handoff.to === network ? now - handoff.at : Infinity;
    const reach = role === 'active' && carrying ? easeOutCubic(age / DRAW_S) : 1;
    const t0 = 1 - reach;
    writeArcRange(points, from, to, sag, t0, 1, scratch);
    line.geometry.setPositions(points);
    line.computeLineDistances();

    const material = line.material as { opacity: number };
    const fade = ghost ? Math.pow(1 - ghostAge / GHOST_S, 1.6) : 1;
    if (role === 'warming') {
      material.opacity = 0.32 + 0.14 * Math.sin(now * 3.1);
    } else {
      material.opacity = 0.95 * fade;
    }
    // A wide, faint halo under the carrying beam, so a link to a tower 300 m
    // away still reads as a link and not as a hairline.
    if (halo) {
      halo.visible = true;
      halo.geometry.setPositions(points);
      (halo.material as { opacity: number }).opacity = 0.17 * fade;
    }

    // World metres per CSS pixel at a given distance from the camera.
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
    const perPixel = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, viewport.height);

    // The antenna end glows in the link's colour while it carries.
    const tip = tipRef.current;
    if (tip) {
      tip.visible = role === 'active' && carrying && reach >= 1;
      tip.position.copy(from);
      tip.scale.setScalar(TIP_PX * perPixel * from.distanceTo(camera.position));
    }

    // The leading edge of a link reaching out to the rover.
    const head = headRef.current;
    if (head) {
      const drawing = role === 'active' && carrying && reach < 1;
      head.visible = drawing;
      if (drawing) {
        arcPoint(from, to, sag, t0, scratch);
        head.position.copy(scratch);
        head.scale.setScalar(HEAD_PX * perPixel * scratch.distanceTo(camera.position));
      }
    }

    if (role === 'active') {
      // Site: a burst when it takes the session, then a slow ping while it carries.
      const sinceTake = Number.isFinite(age) ? age : Infinity;
      if (ghost) {
        placePing(sitePingRef.current, to, camera, perPixel, 0, 0);
      } else if (sinceTake < BURST_S) {
        const p = sinceTake / BURST_S;
        placePing(sitePingRef.current, to, camera, perPixel, 8 + 46 * easeOutCubic(p), 0.85 * Math.pow(1 - p, 1.4));
      } else {
        const anchor = handoff && handoff.to === network ? handoff.at : 0;
        const p = (((now - anchor) / PING_PERIOD_S) % 1 + 1) % 1;
        placePing(sitePingRef.current, to, camera, perPixel, 6 + 24 * easeOutCubic(p), 0.5 * Math.pow(1 - p, 2));
      }
      // Rover: one burst the moment the link arrives.
      const sinceArrival = sinceTake - DRAW_S;
      if (!ghost && sinceArrival >= 0 && sinceArrival < BURST_S) {
        const p = sinceArrival / BURST_S;
        placePing(roverPingRef.current, from, camera, perPixel, 8 + 40 * easeOutCubic(p), 0.9 * Math.pow(1 - p, 1.4));
      } else {
        placePing(roverPingRef.current, from, camera, perPixel, 0, 0);
      }
    }

    // Packets: a pure function of the clock, so a scrubbed frame is exact. Only
    // on the part of the beam that has reached the rover, and not on a ghost.
    if (packets && showPackets) {
      packets.visible = carrying && !ghost;
      if (packets.visible) {
        const phase = (now * PACKET_SPEED) / Math.max(span, 1);
        for (let k = 0; k < PACKETS; k += 1) {
          const t = 1 - ((((phase + k / PACKETS) % 1) + 1) % 1);
          // A little smaller toward the site, so the stream reads as arriving
          // at the rover; otherwise a constant size on screen.
          arcPoint(from, to, sag, t, scratch);
          const size = t < t0 ? 0 : PACKET_PX * (0.6 + 0.4 * (1 - t)) * perPixel * scratch.distanceTo(camera.position);
          matrix.makeScale(size, size, size).setPosition(scratch);
          packets.setMatrixAt(k, matrix);
        }
        packets.instanceMatrix.needsUpdate = true;
      }
    }
  });

  const colour = NETWORK_COLOR[network];
  return (
    <group>
      <Line
        ref={ref}
        points={initial}
        vertexColors={colours}
        color={colours ? '#ffffff' : colour}
        lineWidth={role === 'active' ? 3 : 1.5}
        transparent
        opacity={role === 'active' ? 0.95 : 0.45}
        dashed={role === 'warming'}
        dashSize={2.4}
        gapSize={2.0}
        depthWrite={false}
        renderOrder={6}
      />
      {role === 'active' && (
        <>
          {/* No `visible` prop here: drei spreads extra props onto the material
              too, and a hidden *material* never draws. The frame loop shows
              and hides the object instead. */}
          <Line
            ref={haloRef}
            points={initial}
            color={colour}
            lineWidth={11}
            transparent
            opacity={0.17}
            depthWrite={false}
            renderOrder={5}
          />
          <mesh ref={tipRef} visible={false} renderOrder={7}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshBasicMaterial color={colour} toneMapped={false} />
          </mesh>
          <mesh ref={headRef} visible={false} renderOrder={8}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          <mesh ref={sitePingRef} visible={false} renderOrder={8} frustumCulled={false}>
            <ringGeometry args={[0.82, 1, 48]} />
            <meshBasicMaterial color={colour} toneMapped={false} transparent depthWrite={false} depthTest={false} />
          </mesh>
          <mesh ref={roverPingRef} visible={false} renderOrder={8} frustumCulled={false}>
            <ringGeometry args={[0.8, 1, 48]} />
            <meshBasicMaterial color={colour} toneMapped={false} transparent depthWrite={false} depthTest={false} />
          </mesh>
        </>
      )}
      {showPackets && (
        <instancedMesh ref={packetsRef} args={[undefined, undefined, PACKETS]} visible={false} frustumCulled={false} renderOrder={7}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color={packetColour} toneMapped={false} transparent opacity={0.95} depthWrite={false} />
        </instancedMesh>
      )}
    </group>
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
