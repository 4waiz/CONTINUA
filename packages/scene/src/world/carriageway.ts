/**
 * The road's dimensions, on their own: `layout.ts` and `dock.ts` need them,
 * and `road.ts`, which builds the ribbons, depends on the terrain - which
 * depends on the layout. Constants here, so nothing imports in a circle.
 */

/** The road deck sits this far above the flattened terrain. Shared with the rover. */
export const ROAD_SURFACE_OFFSET = 0.06;
/**
 * The dock bay's floor (scripts/blender/world_industry.py, prop_dock_station)
 * is centred on the start of the route, 8.6 m long and flush with the road
 * deck. The yard round it and the carriageway beyond are `dock.ts`.
 */
export const DOCK_BAY_HALF_LENGTH = 4.3;
export const ROAD_HALF_WIDTH = 3.9;
/** The carriageway and its gravel verges. */
export const SHOULDER_HALF_WIDTH = ROAD_HALF_WIDTH + 1.6;
