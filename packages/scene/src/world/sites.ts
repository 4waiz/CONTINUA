/**
 * Where things are in the world, and where each access network can be reached.
 *
 * Three concepts are kept deliberately separate here and everywhere downstream:
 *
 *   1. the ROUTE      — where the vehicle physically drives (`world/route.ts`)
 *   2. COVERAGE       — where a network is *available* (`coverageAt` below)
 *   3. the ACTIVE LINK — the one connection carrying the session right now
 *
 * The four access networks are alternative links to the same gateway. Nothing
 * in this file arranges them in series.
 */

import type { AccessNetworkId, MissionZone, MissionZoneId } from '@continua/contracts';
import { clamp, smoothstep } from '../math/noise';
import { route } from './route';
import { terrain } from './terrain';

export interface SiteMarker {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly prop: string;
  /** World XZ; Y comes from the terrain. */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale?: number;
  /** Which access network this structure serves, if any. */
  readonly network?: AccessNetworkId;
  /** Height above the marker base where a link beam should attach. */
  readonly linkHeight?: number;
  readonly selectable?: boolean;
}

export const SITES: readonly SiteMarker[] = [
  {
    id: 'dock',
    label: 'Docking station',
    detail: 'Wired gigabit uplink. Active only while the rover is docked or tethered.',
    prop: 'PROP_DockStation',
    // Sits at the route origin: the run must begin physically tethered.
    x: -24,
    z: 7.0,
    yaw: Math.PI,
    network: 'wired',
    linkHeight: 4.0,
    selectable: true,
  },
  {
    id: 'facility',
    label: 'Command facility',
    detail: 'Mission control and the session gateway all four links terminate at.',
    prop: 'PROP_Facility_Main',
    x: -46,
    z: 44,
    yaw: -Math.PI / 2,
    selectable: true,
  },
  {
    id: 'hangar',
    label: 'Service hangar',
    detail: 'Vehicle preparation and maintenance bay.',
    prop: 'PROP_Facility_Hangar',
    x: 40,
    z: 54,
    yaw: Math.PI / 2,
    selectable: true,
  },
  {
    id: 'wifi-yard',
    label: 'Wi-Fi access point A',
    detail: 'Yard cell covering the dock apron. First handoff target after undocking.',
    prop: 'PROP_WifiMast',
    x: 24,
    z: -28,
    yaw: -0.3,
    network: 'wifi',
    linkHeight: 6.6,
    selectable: true,
  },
  {
    id: 'wifi-north',
    label: 'Wi-Fi access point B',
    detail: 'Courtyard 5 GHz cell covering the middle of the yard.',
    prop: 'PROP_WifiMast',
    x: 104,
    z: -36,
    yaw: 0.4,
    network: 'wifi',
    linkHeight: 6.6,
    selectable: true,
  },
  {
    id: 'wifi-south',
    label: 'Wi-Fi access point C',
    detail: 'Perimeter cell covering the yard exit onto the corridor.',
    prop: 'PROP_WifiMast',
    x: 182,
    z: 34,
    yaw: -0.6,
    network: 'wifi',
    linkHeight: 6.6,
    selectable: true,
  },
  {
    id: 'cell-tower',
    label: '5G macro site',
    detail: 'Three-sector mast covering the industrial corridor.',
    prop: 'PROP_CellTower',
    x: 336,
    z: -46,
    yaw: 0.3,
    network: 'cellular',
    linkHeight: 25.5,
    selectable: true,
  },
  {
    id: 'sat-terminal',
    label: 'Satellite ground terminal',
    detail: 'Backhaul for the remote sector, where no terrestrial cell reaches.',
    prop: 'PROP_SatTerminal',
    x: 656,
    z: 118,
    yaw: -2.2,
    network: 'satellite',
    linkHeight: 4.4,
    selectable: true,
  },
];

/** Wi-Fi and cellular emitters, derived from the sites above. */
const WIFI_SITES = SITES.filter((site) => site.network === 'wifi');
const CELL_SITES = SITES.filter((site) => site.network === 'cellular');
const DOCK_SITE = SITES.find((site) => site.id === 'dock')!;

const WIFI_RANGE = 155;
const CELL_RANGE = 330;
// Long enough that the docked phase reads as a real stage of the run.
const TETHER_RANGE = 20;

/**
 * Geometric coverage 0..1 for one network at a world position.
 *
 * This is modelled from distance to infrastructure. It is **not** a measured
 * signal level, and the UI must never present it as one.
 */
export function coverageAt(network: AccessNetworkId, x: number, z: number): number {
  switch (network) {
    case 'wired': {
      const distance = Math.hypot(x - DOCK_SITE.x, z - DOCK_SITE.z);
      // Binary by nature: you are plugged in, or you are not.
      return 1 - smoothstep(TETHER_RANGE - 6, TETHER_RANGE, distance);
    }
    case 'wifi': {
      let best = 0;
      for (const site of WIFI_SITES) {
        const distance = Math.hypot(x - site.x, z - site.z);
        best = Math.max(best, 1 - smoothstep(WIFI_RANGE * 0.42, WIFI_RANGE, distance));
      }
      return best;
    }
    case 'cellular': {
      let best = 0;
      for (const site of CELL_SITES) {
        const distance = Math.hypot(x - site.x, z - site.z);
        best = Math.max(best, 1 - smoothstep(CELL_RANGE * 0.45, CELL_RANGE, distance));
      }
      return best;
    }
    case 'satellite': {
      // Open sky everywhere; the clear horizon out in the hills is better than
      // the built-up facility, so it improves as the rover heads out.
      return clamp(0.42 + smoothstep(340, 620, x) * 0.45, 0, 1);
    }
    default:
      return 0;
  }
}

/** Preference order when several links are usable. Lower is better. */
export const NETWORK_PRIORITY: Readonly<Record<AccessNetworkId, number>> = {
  wired: 0,
  wifi: 1,
  cellular: 2,
  satellite: 3,
};

/** Minimum coverage at which a link is considered usable at all. */
export const USABLE_COVERAGE = 0.18;

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

function distanceAtX(targetX: number): number {
  for (const sample of route.samples) {
    if (sample.x >= targetX) return sample.distance;
  }
  return route.length;
}

const ZONE_EDGES = [0, distanceAtX(94), distanceAtX(236), distanceAtX(452), route.length];

export const MISSION_ZONES: readonly MissionZone[] = [
  { id: 'facility', label: 'Command facility', fromDistance: ZONE_EDGES[0]!, toDistance: ZONE_EDGES[1]! },
  { id: 'courtyard', label: 'Facility courtyard', fromDistance: ZONE_EDGES[1]!, toDistance: ZONE_EDGES[2]! },
  { id: 'corridor', label: 'Industrial corridor', fromDistance: ZONE_EDGES[2]!, toDistance: ZONE_EDGES[3]! },
  { id: 'remote', label: 'Remote sector', fromDistance: ZONE_EDGES[3]!, toDistance: ZONE_EDGES[4]! },
];

export function zoneAtDistance(distance: number): MissionZoneId {
  for (const zone of MISSION_ZONES) {
    if (distance < zone.toDistance) return zone.id;
  }
  return 'remote';
}

/** Camera framing for the overview shot of each zone. */
export const ZONE_OVERVIEWS: Readonly<Record<MissionZoneId, { x: number; z: number; radius: number }>> = {
  facility: { x: 40, z: 6, radius: 132 },
  courtyard: { x: 168, z: -4, radius: 150 },
  corridor: { x: 356, z: -12, radius: 210 },
  remote: { x: 640, z: 62, radius: 260 },
};

/** Convenience: world Y for a site, sitting on the terrain. */
export function siteElevation(site: SiteMarker): number {
  return terrain.height(site.x, site.z);
}
