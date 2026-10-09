'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-0BEDD29AA40A */

/**
 * Which rover is which, when two share the road: a small tag over each -
 * CONTINUA's in its blue, the normal rover's in grey - and, while a rover's
 * link is down, what that means for it: "link lost" while it rolls on,
 * "stopped, no link" once it stands. Words for what the scene already shows
 * (the hold, the hazard lamps), decided by the receiver's own outage flag.
 *
 * Small on purpose - a label, not a sign - and hidden when the camera is far
 * from the rover it names. When the two would sit on each other on screen -
 * the camera off to one side of two rovers abreast - the lower one moves down
 * a line. Its text changes only when its state does, never per frame.
 */

import type { SceneState } from '@continua/contracts';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Vector3, type Camera, type Group } from 'three';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { COLOR } from '../theme';

/** Over the roof, clear of the sensor mast. */
const LIFT_M = 3.1;
/** Past this the tag is more clutter than help. */
const FAR_M = 150;
/** Held this far, the rover is standing. */
const STANDING = 0.85;
/** A tag's line, CSS pixels: how far apart two tags' centres must be not to overlap. */
const LINE_PX = 26;

type TagState = 'ok' | 'lost' | 'stopped' | 'hidden';

interface Tag {
  group: { current: Group | null };
  pill: { current: HTMLDivElement | null };
  dot: { current: HTMLSpanElement | null };
  label: { current: HTMLSpanElement | null };
  shown: TagState | null;
  /** Its downward shift, CSS pixels, to clear the other tag. */
  shift: number;
  /** Where its anchor lands on screen this frame, CSS pixels; null when hidden. */
  screen: { x: number; y: number } | null;
}

function useTag(): Tag {
  const group = useRef<Group>(null);
  const pill = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  return useMemo<Tag>(() => ({ group, pill, dot, label, shown: null, shift: 0, screen: null }), []);
}

const _at = new Vector3();

/** Place a tag over its rover, word it for the rover's state, and note where it lands on screen. */
function place(
  tag: Tag,
  state: SceneState | null,
  name: string,
  colour: string,
  camera: Camera,
  size: { width: number; height: number },
): void {
  const anchor = tag.group.current;
  const element = tag.pill.current;
  if (!anchor || !element || !tag.label.current || !tag.dot.current) return;
  let next: TagState = 'hidden';
  tag.screen = null;
  if (state) {
    const at = state.vehicle.position;
    anchor.position.set(at.x, at.y + LIFT_M, at.z);
    if (camera.position.distanceTo(anchor.position) <= FAR_M) {
      next = (state.held ?? 0) > STANDING ? 'stopped' : state.sessionDown ? 'lost' : 'ok';
      anchor.getWorldPosition(_at).project(camera);
      if (_at.z < 1) tag.screen = { x: ((_at.x + 1) / 2) * size.width, y: ((1 - _at.y) / 2) * size.height };
    }
  }
  if (next === tag.shown) return;
  tag.shown = next;
  const alert = next === 'lost' || next === 'stopped';
  element.style.opacity = next === 'hidden' ? '0' : '1';
  element.style.color = alert ? COLOR.red : COLOR.text;
  element.style.borderColor = alert ? 'rgb(229 72 77 / 0.45)' : 'rgb(90 110 160 / 0.22)';
  tag.dot.current.style.background = alert ? COLOR.red : colour;
  tag.label.current.textContent = next === 'stopped' ? `${name} · stopped, no link` : next === 'lost' ? `${name} · link lost` : name;
}

function shiftTo(tag: Tag, shift: number): void {
  if (Math.abs(tag.shift - shift) < 0.5 || !tag.pill.current) return;
  tag.shift = shift;
  tag.pill.current.style.translate = `0 ${shift}px`;
}

function TagView({ tag, name, colour }: { tag: Tag; name: string; colour: string }) {
  return (
    <group ref={tag.group}>
      <Html center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={tag.pill}
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
          <span ref={tag.dot} style={{ width: 7, height: 7, borderRadius: 999, background: colour, flex: 'none' }} />
          <span ref={tag.label}>{name}</span>
        </div>
      </Html>
    </group>
  );
}

/** The two tags; mounted only while the normal rover drives beside the run. */
export function RoverTags({ mainName = 'CONTINUA' }: { mainName?: string }) {
  const { frame, companionFrame } = useSceneRuntime();
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const main = useTag();
  const normal = useTag();

  useFrame(() => {
    place(main, frame.current, mainName, COLOR.blue, camera, size);
    place(normal, companionFrame.current, 'Normal rover', COLOR.muted, camera, size);
    // Two tags on one spot: the lower moves down until their centres are a
    // line apart - only where their pills would overlap side to side too.
    const a = main.screen;
    const b = normal.screen;
    const halfWidths = ((main.pill.current?.offsetWidth ?? 0) + (normal.pill.current?.offsetWidth ?? 0)) / 2;
    if (a && b && Math.abs(a.x - b.x) < halfWidths + 6 && Math.abs(a.y - b.y) < LINE_PX) {
      const lower = b.y >= a.y ? normal : main;
      shiftTo(lower, LINE_PX - Math.abs(a.y - b.y));
      shiftTo(lower === normal ? main : normal, 0);
    } else {
      shiftTo(main, 0);
      shiftTo(normal, 0);
    }
  });

  return (
    <>
      <TagView tag={main} name={mainName} colour={COLOR.blue} />
      <TagView tag={normal} name="Normal rover" colour={COLOR.muted} />
    </>
  );
}
