/**
 * Player name tag.
 *
 * drei's `<Text>` (troika) renders beautiful SDF text, but it resolves fonts
 * over the network — a Google Fonts woff plus a unicode index from jsdelivr.
 * That made the label a third-party runtime dependency, threw an unhandled
 * "Failed to fetch" when either CDN was unreachable, and suspended the scene
 * while it resolved.
 *
 * A name tag is a handful of characters on a billboard, so it is drawn to a 2D
 * canvas with the browser's own fonts and used as a sprite texture instead.
 * No network, no suspense, and it stays crisp because the canvas is rendered at
 * device scale.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';

const PADDING = 26;
const FONT_PX = 52;
const HEIGHT = 96;

/** Renders `text` into a canvas texture sized to fit, and returns its aspect. */
function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): number {
  const ctx = canvas.getContext('2d')!;
  const font = `700 ${FONT_PX}px "SF Pro Display", Inter, system-ui, -apple-system, sans-serif`;

  // Measure first so the canvas is only as wide as the text needs.
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + PADDING * 2;
  canvas.width = width;
  canvas.height = HEIGHT;

  // Resizing the canvas resets the context, so restate everything after.
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const radius = HEIGHT / 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, HEIGHT, radius);
  ctx.fillStyle = 'rgba(6, 6, 12, 0.74)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width / 2, HEIGHT / 2 + 2);

  return width / HEIGHT;
}

export const NameTag: React.FC<{
  text: string;
  color: string;
  position?: [number, number, number];
  /** World height of the tag. */
  size?: number;
}> = ({ text, color, position = [0, 1.25, 0.4], size = 0.42 }) => {
  const canvas = useMemo(() => document.createElement('canvas'), []);
  const texture = useMemo(() => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }, [canvas]);
  const aspect = useRef(3);

  useEffect(() => {
    aspect.current = paintLabel(canvas, text, color);
    texture.needsUpdate = true;
  }, [canvas, texture, text, color]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <Billboard position={position}>
      <mesh>
        <planeGeometry args={[size * aspect.current, size]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
};
