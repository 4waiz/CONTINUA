'use client';

/**
 * Soft daylight, a pale gradient sky and a shadow camera that follows the rover.
 *
 * A single directional light cannot cast crisp shadows across an 900 m world, so
 * the shadow frustum tracks the vehicle and stays small. Everything beyond it
 * reads through ambient occlusion and fog instead, which is also what keeps the
 * distance looking hazy rather than flat.
 */

import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  Object3D,
  ShaderMaterial,
} from 'three';
import { SCENE_COLOR } from '../theme';
import { useSceneRuntime } from '../runtime/SceneRuntime';

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
  varying vec3 vWorld;
  void main() {
    float h = clamp(normalize(vWorld).y * 1.35 + 0.12, 0.0, 1.0);
    gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.85)), 1.0);
    #include <colorspace_fragment>
  }
`;

function GradientSky() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTop: { value: new Color(SCENE_COLOR.sky) },
          uHorizon: { value: new Color(SCENE_COLOR.skyHorizon) },
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );

  return (
    <mesh material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[2200, 32, 16]} />
    </mesh>
  );
}

export function Lighting({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const { frame } = useSceneRuntime();
  const scene = useThree((state) => state.scene);
  const lightRef = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);

  useEffect(() => {
    scene.fog = new Fog(SCENE_COLOR.fog, 320, 1750);
    scene.add(target);
    return () => {
      scene.fog = null;
      scene.remove(target);
    };
  }, [scene, target]);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const { position } = frame.current.vehicle;
    // Keep the shadow frustum on the rover; the sun direction never changes.
    target.position.set(position.x, position.y, position.z);
    target.updateMatrixWorld();
    light.position.set(position.x + 62, position.y + 96, position.z + 48);
    light.target = target;
  });

  const shadows = quality !== 'low';
  const shadowSize = quality === 'high' ? 2048 : 1024;

  return (
    <>
      <GradientSky />
      <hemisphereLight args={[SCENE_COLOR.sky, SCENE_COLOR.groundFar, 0.30]} />
      <ambientLight intensity={0.05} color="#E6EEFF" />
      <directionalLight
        ref={lightRef}
        intensity={0.95}
        color="#FFF6EA"
        castShadow={shadows}
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
        shadow-camera-near={20}
        shadow-camera-far={260}
        shadow-camera-left={-46}
        shadow-camera-right={46}
        shadow-camera-top={46}
        shadow-camera-bottom={-46}
      />
      {/* A locally generated environment: no network fetch, no HDR download. */}
      <Environment resolution={quality === 'high' ? 128 : 64} frames={1}>
        <color attach="background" args={[SCENE_COLOR.sky]} />
        <Lightformer intensity={0.5} position={[0, 8, 0]} scale={[12, 12, 1]} rotation-x={Math.PI / 2} />
        <Lightformer intensity={0.2} position={[6, 2, 4]} scale={[8, 4, 1]} color="#DCE9FF" />
        <Lightformer intensity={0.16} position={[-6, 1, -4]} scale={[8, 4, 1]} color="#FFF3E4" />
      </Environment>
    </>
  );
}
