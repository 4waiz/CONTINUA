'use client';

/**
 * Which rover is which, when two share the road: a small tag over each -
 * CONTINUA's in its blue, the normal rover's in grey - and, while a rover's
 * link is down, what that means for it: "link lost" while it rolls on,
 * "stopped, no link" once it stands. Words for what the scene already shows
 * (the hold, the hazard lamps), decided by the receiver's own outage flag.
 *
 * Small on purpose - a label, not a sign - and hidden when the camera is far
 * from the rover it names. Its text changes only when its state does, never
 * per frame.
 */

import type { SceneState } from '@continua/contracts';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { COLOR } from '../theme';

/** Over the roof, clear of the sensor mast. */
const LIFT_M = 3.1;
/** Past this the tag is more clutter than help: two tags far off stack on each other. */
const FAR_M = 90;
/** Held this far, the rover is standing. */
const STANDING = 0.85;

type TagState = 'ok' | 'lost' | 'stopped' | 'hidden';

function Tag({ frame, name, colour }: { frame: { current: SceneState | null }; name: string; colour: string }) {
  const group = useRef<Group>(null);
  const pill = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const shown = useRef<TagState | null>(null);
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const anchor = group.current;
    const element = pill.current;
    if (!anchor || !element || !label.current || !dot.current) return;
    const state = frame.current;
    let next: TagState = 'hidden';
    if (state) {
      const at = state.vehicle.position;
      anchor.position.set(at.x, at.y + LIFT_M, at.z);
      if (camera.position.distanceTo(anchor.position) <= FAR_M) {
        next = (state.held ?? 0) > STANDING ? 'stopped' : state.sessionDown ? 'lost' : 'ok';
      }
    }
    if (next === shown.current) return;
    shown.current = next;
    const alert = next === 'lost' || next === 'stopped';
    element.style.opacity = next === 'hidden' ? '0' : '1';
    element.style.color = alert ? COLOR.red : COLOR.text;
    element.style.borderColor = alert ? 'rgb(229 72 77 / 0.45)' : 'rgb(90 110 160 / 0.22)';
    dot.current.style.background = alert ? COLOR.red : colour;
    label.current.textContent = next === 'stopped' ? `${name} · stopped, no link` : next === 'lost' ? `${name} · link lost` : name;
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={pill}
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 9px 3px 7px',
            borderRadius: 999,
            border: '1px solid rgb(90 110 160 / 0.22)',
            background: 'rgb(255 255 255 / 0.92)',
            boxShadow: '0 2px 8px rgb(20 33 61 / 0.12)',
            color: COLOR.text,
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: '16px',
            whiteSpace: 'nowrap',
            opacity: 0,
            transition: 'opacity 200ms ease, color 200ms ease, border-color 200ms ease',
            userSelect: 'none',
          }}
        >
          <span ref={dot} style={{ width: 7, height: 7, borderRadius: 999, background: colour, flex: 'none' }} />
          <span ref={label}>{name}</span>
        </div>
      </Html>
    </group>
  );
}

/** The two tags; mounted only while the normal rover drives beside the run. */
export function RoverTags({ mainName = 'CONTINUA' }: { mainName?: string }) {
  const { frame, companionFrame } = useSceneRuntime();
  return (
    <>
      <Tag frame={frame} name={mainName} colour={COLOR.blue} />
      <Tag frame={companionFrame} name="Normal rover" colour={COLOR.muted} />
    </>
  );
}
