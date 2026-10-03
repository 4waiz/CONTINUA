# Draco decoder

`draco_wasm_wrapper.js` and `draco_decoder.wasm` are Google's Draco mesh
decoder (the glTF-targeted build), copied unchanged from
`node_modules/three/examples/jsm/libs/draco/gltf/` (three 0.185.1).

They are served from the site itself so the compressed CONTINUA models
(`/models/*.glb`, `KHR_draco_mesh_compression`) decode with no network fetch -
drei's default decoder path is a Google CDN, which would break the offline
build. The scene points the loader here in `packages/scene/src/components/assets.ts`.

Licence: Apache License 2.0 (Draco, https://github.com/google/draco).
