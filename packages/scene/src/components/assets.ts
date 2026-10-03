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

export const DRACO_DECODER_PATH = '/draco/';

useGLTF.setDecoderPath(DRACO_DECODER_PATH);

export const ROVER_MODEL_URL = '/models/continua_rover.glb';
export const ROVER_MODEL_LOD1_URL = '/models/continua_rover_lod1.glb';
export const PROPS_MODEL_URL = '/models/continua_props.glb';
