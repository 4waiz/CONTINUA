/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-CB6F4B8A19F8 */
/**
 * Model URLs and the glTF loader's decoder path, in one place.
 *
 * The models are Draco-compressed (`KHR_draco_mesh_compression`), which cuts
 * the download by roughly three quarters. drei's loader would fetch the Draco
 * decoder from a Google CDN by default; pointing it at the copy served from
 * `/draco/` keeps the app working offline, which it has always had to.
 * This module must be imported before any `useGLTF.preload` call runs.
 */

import { useGLTF } from '@react-three/drei';
import { MODEL_VERSIONS } from './modelVersions';

export const DRACO_DECODER_PATH = '/draco/';

useGLTF.setDecoderPath(DRACO_DECODER_PATH);

// Content-addressed: `/models` is served with a one-year immutable cache, so a
// regenerated model must arrive under a new URL or browsers keep the old one.
export const ROVER_MODEL_URL = `/models/continua_rover.glb?v=${MODEL_VERSIONS.rover}`;
export const ROVER_MODEL_LOD1_URL = `/models/continua_rover_lod1.glb?v=${MODEL_VERSIONS.roverLod1}`;
export const PROPS_MODEL_URL = `/models/continua_props.glb?v=${MODEL_VERSIONS.props}`;
export const DOCK_TWO_MODEL_URL = `/models/continua_dock02.glb?v=${MODEL_VERSIONS.dockTwo}`;
export const TUNNEL_MODEL_URL = `/models/continua_tunnel.glb?v=${MODEL_VERSIONS.tunnel}`;
