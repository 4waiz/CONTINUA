'use client';

/**
 * A clear coastal day: a deep blue sky with fair-weather cumulus, a warm key
 * light whose shadow frustum follows the rover, a sky/meadow hemisphere fill,
 * and an environment built from the same sky so paint, glass and the sea
 * reflect what is actually around them.
 *
 * The sun never moves and nothing reads the wall clock, so lighting is a pure
 * function of where the rover is - a frame captured twice is the same frame.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { SCENE_COLOR } from '../theme';
import { useSceneRuntime } from '../runtime/SceneRuntime';

/** Direction toward the sun: behind-left of a camera following the rover east,
 *  41 degrees up - mid-morning. High enough that the light stays clean and the
 *  palette pale; low enough that every building, tank and palm throws a shadow
 *  long enough to give the ground form. Fronts facing the route and the rover's
 *  tail are lit, and shadows fall forward-right where the follow camera sees
 *  them. */
export const SUN_DIRECTION = new Vector3(-70, 78, -55).normalize();
const SUN_DISTANCE = 160;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  #ifdef CT_LITE
    #define CLOUD_OCTAVES 3
  #else
    #define CLOUD_OCTAVES 5
  #endif
  float fbm(vec2 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < CLOUD_OCTAVES; i++) { sum += amp * n2(p); p = p * 2.02 + vec2(13.1, 7.7); amp *= 0.5; }
    return sum;
  }
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float h = clamp(dir.y, 0.0, 1.0);
    // Deep blue overhead, paling to a bright haze at the horizon.
    vec3 sky = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.6));
    float sunDot = max(dot(dir, uSunDir), 0.0);
    sky += uSun * (pow(sunDot, 6.0) * 0.14 + pow(sunDot, 64.0) * 0.22 + pow(sunDot, 900.0) * 1.2);
    // Fair-weather cumulus on a high deck: white where the sun reaches them,
    // softly blue-grey underneath, thinning out toward the horizon haze.
    // The low tier draws the sky without clouds: every pixel of it is shaded
    // on a software rasteriser, and the cloud noise was a third of a frame.
    #ifndef CT_LITE
    if (dir.y > 0.0) {
      vec2 q = dir.xz / (dir.y + 0.06) * 2.2;
      vec2 drift = vec2(3.0, 1.0);
      // Heaped, not smeared: the shape is domain-warped, and a billow layer
      // gives the thin edges their rounded, cauliflower outline.
      vec2 warp = vec2(n2(q * 0.32 + 5.1), n2(q * 0.32 + 9.7)) - 0.5;
      vec2 p = q * 0.9 + drift + warp * 0.85;
      float d = fbm(p);
      float billow = 1.0 - abs(2.0 * n2(q * 3.4 + drift * 1.7) - 1.0);
      d += (billow - 0.5) * 0.085;
      float cover = smoothstep(0.47, 0.59, d) * smoothstep(0.02, 0.16, dir.y);
      // Lit on the sun's side, shadowed on the far side and under thick cores.
      float toward = fbm(p + uSunDir.xz * 0.08);
      float shade = clamp((d - toward) * 5.0 + 0.42, 0.0, 1.0);
      float core = smoothstep(0.58, 0.78, d);
      vec3 cloud = mix(vec3(1.0, 0.995, 0.985), vec3(0.72, 0.78, 0.88), clamp(shade * 0.7 + core * 0.38, 0.0, 1.0));
      // A silver lining where a thin edge stands near the sun.
      cloud += uSun * pow(sunDot, 10.0) * (1.0 - core) * 0.35;
      sky = mix(sky, cloud, cover * 0.95);
    }
    #endif
    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

function skyMaterial(lite: boolean): ShaderMaterial {
  return new ShaderMaterial({
    defines: lite ? { CT_LITE: '' } : {},
    uniforms: {
      uTop: { value: new Color(SCENE_COLOR.sky) },
      uHorizon: { value: new Color(SCENE_COLOR.skyHorizon) },
      uSun: { value: new Color(SCENE_COLOR.sun) },
      uSunDir: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
}

function GradientSky({ lite }: { lite: boolean }) {
  const material = useMemo(() => skyMaterial(lite), [lite]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[2300, 48, 24]} />
    </mesh>
  );
}

/**
 * The same sky, plus the meadow below, filtered once into the environment map
 * - synchronously, as the scene mounts. drei's <Environment> captured it on the
 * first frame instead, so when the scene's programs were compiled ahead of
 * time no material had an environment yet, and the first frame compiled every
 * lit material a second time, with one, on the main thread: about 1.7 s.
 */
function SkyEnvironment({ resolution }: { resolution: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useLayoutEffect(() => {
    const material = skyMaterial(false);
    const sphere = new SphereGeometry(1, 32, 16);
    const disc = new CircleGeometry(90, 32);
    const groundMaterial = new MeshBasicMaterial({ color: SCENE_COLOR.groundBounce });
    const sky = new Mesh(sphere, material);
    sky.scale.setScalar(100);
    const ground = new Mesh(disc, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    const capture = new Scene();
    capture.add(sky, ground);

    const generator = new PMREMGenerator(gl);
    const target = generator.fromScene(capture, 0, 0.1, 1000, { size: resolution });
    generator.dispose();
    material.dispose();
    sphere.dispose();
    disc.dispose();
    groundMaterial.dispose();

    scene.environment = target.texture;
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, resolution]);
  return null;
}

export function Lighting({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const { frame } = useSceneRuntime();
  const scene = useThree((state) => state.scene);
  const lightRef = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);

  // A layout effect, so the fog exists before the scene's programs are
  // compiled ahead of the first frame (Precompile): fog is part of every
  // program, and compiled without it they were all compiled again, on the
  // main thread, the first time the scene drew.
  useLayoutEffect(() => {
    // Clear coastal air: the haze starts later and ends where the camera's far
    // plane does, so the sea meets the sky without a seam.
    scene.fog = new Fog(SCENE_COLOR.fog, 320, 2400);
    // The sky environment is bright everywhere; at full strength it floods
    // every shadow and the scene reads flat. A third of it keeps reflections
    // and fill while the sun does the modelling.
    scene.environmentIntensity = 0.38;
    scene.add(target);
    return () => {
      scene.fog = null;
      scene.environmentIntensity = 1;
      scene.remove(target);
    };
  }, [scene, target]);

  // The shadow camera's own axes: it looks down -SUN_DIRECTION with world up.
  const axes = useMemo(() => {
    const forward = SUN_DIRECTION.clone().negate();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    return { right, up };
  }, []);
  const snapped = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const { position } = frame.current.vehicle;
    // Keep the shadow frustum centred on the rover; the sun direction is fixed.
    // Snap the centre to whole shadow-map texels *in the light's own frame*, so
    // the shadow edges do not crawl as the frustum follows the rover.
    const texel = (2 * SHADOW_EXTENT[quality]) / SHADOW_SIZE[quality];
    snapped.set(position.x, position.y, position.z);
    const r = snapped.dot(axes.right);
    const u = snapped.dot(axes.up);
    snapped
      .addScaledVector(axes.right, Math.round(r / texel) * texel - r)
      .addScaledVector(axes.up, Math.round(u / texel) * texel - u);
    target.position.copy(snapped);
    target.updateMatrixWorld();
    light.position.copy(snapped).addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
    light.target = target;
  });

  const shadows = quality !== 'low';
  const extent = SHADOW_EXTENT[quality];

  return (
    <>
      <GradientSky lite={quality === 'low'} />
      <hemisphereLight args={['#A9CDF0', SCENE_COLOR.groundBounce, 0.5]} />
      <directionalLight
        ref={lightRef}
        intensity={3.0}
        color={SCENE_COLOR.sun}
        castShadow={shadows}
        shadow-mapSize-width={SHADOW_SIZE[quality]}
        shadow-mapSize-height={SHADOW_SIZE[quality]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.06}
        shadow-radius={2}
        shadow-camera-near={10}
        shadow-camera-far={420}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
      />
      <SkyEnvironment resolution={quality === 'high' ? 256 : 128} />
    </>
  );
}

const SHADOW_SIZE = { high: 4096, balanced: 2048, low: 1024 } as const;
const SHADOW_EXTENT = { high: 85, balanced: 70, low: 50 } as const;
