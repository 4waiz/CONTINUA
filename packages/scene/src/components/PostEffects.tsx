'use client';

/**
 * The high tier's finishing passes: ground-truth ambient occlusion (three's own
 * `GTAOPass`), then a light grade.
 *
 * Baked AO darkens each object's own creases and the footprint decals darken
 * the ground under each prop, but nothing darkened one object where another
 * meets it: a rover's tyres on the road, a tank against its bund, a palm's
 * trunk in the sand. GTAO does exactly that, from the depth and normals of the
 * frame, at a world-space radius matched to this scene's scale.
 *
 * The grade is the last pass, on the display-referred image: a gentle S-curve
 * for depth, a little more colour in the mid-tones, sun-warm highlights over
 * sky-cool shade - the split a clear morning has - and a soft vignette that
 * keeps the eye in the frame. Restrained on purpose: no bloom, no glow, nothing
 * that would make a link's colour read differently from the interface's.
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
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** The grade: on the image after tone mapping, in sRGB. */
export const GradeShader = {
  name: 'ContinuaGrade',
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.075 },
    uSaturation: { value: 1.1 },
    uVignette: { value: 0.2 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 colour = texel.rgb;
      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      // Depth: a soft S-curve about the mid-grey, steepest in the mid-tones,
      // so whites stay white and shade does not crush.
      vec3 curved = colour + (colour - 0.5) * (uContrast - 1.0) * (1.0 - abs(2.0 * colour - 1.0));
      // Colour: more in the mid-tones than at either end.
      float midtone = 1.0 - abs(2.0 * luma - 1.0);
      curved = mix(vec3(luma), curved, mix(1.0, uSaturation, midtone));
      // A clear morning: warm where the sun lands, cool in the shade.
      curved += vec3(0.010, 0.004, -0.008) * smoothstep(0.55, 0.95, luma);
      curved += vec3(-0.006, 0.0, 0.010) * (1.0 - smoothstep(0.08, 0.42, luma));
      // A soft vignette, round on screen whatever the aspect.
      vec2 centred = (vUv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
      curved *= 1.0 - uVignette * smoothstep(0.38, 0.82, length(centred) * 1.25);
      gl_FragColor = vec4(clamp(curved, 0.0, 1.0), texel.a);
    }
  `,
};

export function PostEffects() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const { composer, grade } = useMemo(() => {
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
    const gradePass = new ShaderPass(GradeShader);
    effects.addPass(gradePass);
    return { composer: effects, grade: gradePass };
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
    grade.uniforms.uAspect!.value = size.width / Math.max(1, size.height);
  }, [composer, grade, size.width, size.height, dpr]);

  useEffect(() => () => composer.dispose(), [composer]);

  // Priority 1 takes the frame over from R3F's own render.
  useFrame(() => {
    composer.render();
  }, 1);

  return null;
}
