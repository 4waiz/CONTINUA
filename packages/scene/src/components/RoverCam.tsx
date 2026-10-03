'use client';

/**
 * The rover's forward camera, for the Mission view's camera tile.
 *
 * Renders the scene from the camera windows across the front of the sensor
 * crown into a small off-screen target, tone-maps it exactly as the main view
 * is (three's output pass: the same Neutral curve, exposure and sRGB encoding)
 * into a corner of the canvas's own drawing buffer - which the main view
 * overwrites later in the same frame - and hands that corner to whoever
 * registered a sink as an ImageBitmap. The picture never leaves the GPU: an
 * earlier version read it back to the CPU, and on Chromium / D3D11 each
 * readback stalled the main thread until the GPU drained - frames of 13 to
 * 38 ms, fifteen times a second, once the island's woods were planted.
 *
 * It is a picture of the simulated world, never transported video - the tile
 * says so - and it moves only while the video stream it stands for does: each
 * newly delivered frame the engine reports keeps it running for a moment
 * (`feedRoverCam`), and a stall the receiver measured freezes it at once
 * (`setRoverCamStalled`).
 *
 * Off-screen and cheap: 480 x 270, at most 15 pictures a second (3 on the low
 * tier), the main view's shadow map reused, no ambient occlusion, the link
 * beams hidden - a camera does not see radio - and nothing at all without a
 * sink.
 */

import type { QualityTier } from '@continua/contracts';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { HalfFloatType, Object3D, PerspectiveCamera, Vector3, Vector4, WebGLRenderTarget } from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { ROAD_SURFACE_OFFSET } from '../world/road';

export const ROVER_CAM_WIDTH = 480;
export const ROVER_CAM_HEIGHT = 270;
/** How long one report of a newly delivered frame keeps the picture moving. */
const LEASE_MS = 400;

/** Receives each new picture; it owns the bitmap (transfer or close it). */
type Sink = (picture: ImageBitmap) => void;

let sink: Sink | null = null;
let stalled = false;
let leaseUntil = 0;
let firstPicture = false;

/** The camera tile registers here; null stops the rendering altogether. */
export function setRoverCamSink(next: Sink | null): void {
  sink = next;
  // A tile that opens mid-stall still gets the frozen picture.
  firstPicture = next !== null;
}

/** The engine reported a newly delivered video frame: keep the picture moving. */
export function feedRoverCam(): void {
  leaseUntil = performance.now() + LEASE_MS;
}

/** While the receiver reports the video stream stalled, the picture freezes. */
export function setRoverCamStalled(value: boolean): void {
  stalled = value;
}

/** The camera windows at the front of the sensor crown, in the rover's frame (metres, +X forward). */
const LENS = new Vector3(0.47, 2.07, 0);
/** Down the road, four degrees below the horizon. */
const AIM = new Vector3(40, 2.07 - 40 * Math.tan((4 * Math.PI) / 180), 0);

export function RoverCam({ quality }: { quality: QualityTier }) {
  const { frame } = useSceneRuntime();
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const parts = useMemo(
    () => ({
      camera: new PerspectiveCamera(46, ROVER_CAM_WIDTH / ROVER_CAM_HEIGHT, 0.1, 2600),
      // Linear and multisampled, like the main view's composer target, then
      // tone-mapped and sRGB-encoded onto the canvas by the output pass.
      linear: new WebGLRenderTarget(ROVER_CAM_WIDTH, ROVER_CAM_HEIGHT, { type: HalfFloatType, samples: 4 }),
      pass: Object.assign(new OutputPass(), { renderToScreen: true }),
      mount: new Object3D(),
      aim: new Vector3(),
      viewport: new Vector4(),
      scissor: new Vector4(),
    }),
    [],
  );
  const links = useRef<Object3D | null>(null);
  const last = useRef(-Infinity);
  const reading = useRef(false);
  const intervalMs = quality === 'low' ? 1000 / 3 : 1000 / 15;

  useEffect(
    () => () => {
      parts.linear.dispose();
      parts.pass.dispose();
    },
    [parts],
  );

  useFrame(() => {
    if (!sink || reading.current) return;
    const now = performance.now();
    if (!firstPicture && (stalled || now > leaseUntil)) return;
    if (now - last.current < intervalMs) return;
    last.current = now;
    firstPicture = false;

    const { camera, linear, pass, mount, aim, viewport, scissor } = parts;
    const pose = frame.current.vehicle;
    mount.position.set(pose.position.x, pose.position.y + ROAD_SURFACE_OFFSET, pose.position.z);
    mount.rotation.set(pose.roll, pose.heading, pose.pitch, 'YXZ');
    mount.updateMatrix();
    camera.position.copy(LENS).applyMatrix4(mount.matrix);
    camera.lookAt(aim.copy(AIM).applyMatrix4(mount.matrix));
    camera.updateMatrixWorld();

    if (!links.current?.parent) links.current = scene.getObjectByName('CONTINUA_Links') ?? null;
    const beams = links.current;
    const beamsVisible = beams?.visible ?? false;
    if (beams) beams.visible = false;
    const previous = gl.getRenderTarget();
    const autoShadows = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;

    gl.setRenderTarget(linear);
    gl.render(scene, camera);

    // Tone-map into the drawing buffer's bottom-left corner, exactly
    // ROVER_CAM_WIDTH x ROVER_CAM_HEIGHT device pixels (the half pixel keeps
    // three's floor() from losing a row at fractional pixel ratios).
    const ratio = gl.getPixelRatio();
    const scissorTest = gl.getScissorTest();
    gl.getViewport(viewport);
    gl.getScissor(scissor);
    gl.setRenderTarget(null);
    gl.setViewport(0, 0, (ROVER_CAM_WIDTH + 0.5) / ratio, (ROVER_CAM_HEIGHT + 0.5) / ratio);
    gl.setScissor(0, 0, (ROVER_CAM_WIDTH + 0.5) / ratio, (ROVER_CAM_HEIGHT + 0.5) / ratio);
    gl.setScissorTest(true);
    // (renderToScreen: the write buffer argument is unused.)
    pass.render(gl, linear, linear, 0, false);
    gl.setScissorTest(scissorTest);
    gl.setScissor(scissor);
    gl.setViewport(viewport);

    gl.setRenderTarget(previous);
    gl.shadowMap.autoUpdate = autoShadows;
    if (beams) beams.visible = beamsVisible;

    // A snapshot of that corner, taken now and kept on the GPU.
    const canvas = gl.domElement;
    reading.current = true;
    createImageBitmap(canvas, 0, canvas.height - ROVER_CAM_HEIGHT, ROVER_CAM_WIDTH, ROVER_CAM_HEIGHT)
      .then((picture) => {
        if (sink) sink(picture);
        else picture.close();
      })
      .catch(() => undefined)
      .finally(() => {
        reading.current = false;
      });
  });

  return null;
}
