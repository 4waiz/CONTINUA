'use client';

/**
 * Midday desert light: a pale sky with a soft sun glow, a warm key light whose
 * shadow frustum follows the rover, a sky/sand hemisphere fill, and an
 * environment built from the same sky so paint and glass reflect what is
 * actually around them.
 *
 * The sun never moves and nothing reads the wall clock, so lighting is a pure
 * function of where the rover is - a frame captured twice is the same frame.
 */

import { Environment } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, Color, DirectionalLight, Fog, Object3D, ShaderMaterial, Vector3 } from 'three';
import { SCENE_COLOR } from '../theme';
import { useSceneRuntime } from '../runtime/SceneRuntime';

/** Direction toward the sun: behind-left of a camera following the rover east,
 *  53 degrees up - building fronts facing the route and the rover's tail are lit,
 *  and shadows fall forward-right where the follow camera sees them. */
export const SUN_DIRECTION = new Vector3(-70, 120, -55).normalize();
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
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float h = clamp(dir.y * 1.25 + 0.06, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uTop, pow(h, 0.75));
    // A soft glow toward the sun, strongest near the horizon.
    float sunDot = max(dot(dir, uSunDir), 0.0);
    sky += uSun * (pow(sunDot, 8.0) * 0.18 + pow(sunDot, 600.0) * 0.6);
    // Faint high cloud: long streaks, only well above the horizon.
    vec2 q = dir.xz / max(dir.y, 0.08) * 0.9;
    float cloud = n2(q * 1.3 + vec2(0.0, q.x * 0.2)) * 0.6 + n2(q * 3.1) * 0.4;
    cloud = smoothstep(0.58, 0.9, cloud) * smoothstep(0.08, 0.35, dir.y);
    sky = mix(sky, vec3(1.0), cloud * 0.35);
    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
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

function GradientSky() {
  const material = useMemo(() => skyMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[2300, 48, 24]} />
    </mesh>
  );
}

/** The same sky, plus warm sand below, rendered once into the environment map. */
function SkyEnvironment({ resolution }: { resolution: number }) {
  const material = useMemo(() => skyMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <Environment resolution={resolution} frames={1}>
      <mesh material={material} scale={100}>
        <sphereGeometry args={[1, 32, 16]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -2, 0]}>
        <circleGeometry args={[90, 32]} />
        <meshBasicMaterial color={SCENE_COLOR.sand} />
      </mesh>
    </Environment>
  );
}

export function Lighting({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const { frame } = useSceneRuntime();
  const scene = useThree((state) => state.scene);
  const lightRef = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);

  useEffect(() => {
    scene.fog = new Fog(SCENE_COLOR.fog, 260, 1900);
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
      <GradientSky />
      <hemisphereLight args={[SCENE_COLOR.sky, SCENE_COLOR.sand, 0.5]} />
      <directionalLight
        ref={lightRef}
        intensity={2.75}
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
