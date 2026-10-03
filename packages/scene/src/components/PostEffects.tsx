'use client';

/**
 * Ground-truth ambient occlusion (three's own `GTAOPass`), on the high tier.
 *
 * Baked AO darkens each object's own creases and the footprint decals darken
 * the ground under each prop, but nothing darkened one object where another
 * meets it: a rover's tyres on the road, a tank against its bund, a palm's
 * trunk in the sand. GTAO does exactly that, from the depth and normals of the
 * frame, at a world-space radius matched to this scene's scale.
 *
 * Rendering goes through a multisampled half-float target, the AO pass and
 * three's output pass, which applies the same Neutral tone mapping and sRGB
 * conversion the canvas would. Lines (the link beams, the power lines) are
 * hidden from the AO's normal pass by `GTAOPass` itself, so they cast none.
 * Everything here is a function of the frame alone - the noise is fixed - so a
 * captured frame is still a pure function of the clock.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { HalfFloatType, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

export function PostEffects() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const composer = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    const effects = new EffectComposer(gl, target);
    effects.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({
      radius: 2.0,
      distanceExponent: 1.6,
      thickness: 2.0,
      scale: 1.0,
      samples: 12,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 0.8;
    effects.addPass(gtao);
    effects.addPass(new OutputPass());
    return effects;
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
  }, [composer, size.width, size.height, dpr]);

  useEffect(() => () => composer.dispose(), [composer]);

  // Priority 1 takes the frame over from R3F's own render.
  useFrame(() => {
    composer.render();
  }, 1);

  return null;
}
