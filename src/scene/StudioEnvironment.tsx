/**
 * Procedural studio lighting environment.
 *
 * The generated models are PBR, so they need an environment map to read as
 * real materials — flat directional lights alone leave metal and gloss looking
 * dead. drei's `<Environment preset="…">` would do this, but it downloads an
 * HDR from an external CDN at runtime: that adds megabytes to first paint and,
 * worse, suspends the entire scene indefinitely if the fetch fails, leaving a
 * blank stage.
 *
 * This builds the same kind of lighting from Lightformers rendered into an
 * offscreen cube target instead — no network, no suspense, and the softbox
 * layout can be tuned to suit the objects.
 */
import React from 'react';
import { Environment, Lightformer } from '@react-three/drei';

export const StudioEnvironment: React.FC<{ intensity?: number }> = ({ intensity = 0.6 }) => (
  <Environment resolution={256} environmentIntensity={intensity} frames={1}>
    {/* Warm key softbox, camera-left and high. */}
    <Lightformer
      form="rect"
      intensity={5}
      color="#fff4e8"
      position={[-6, 6, 8]}
      rotation={[0, Math.PI / 5, 0]}
      scale={[10, 10, 1]}
    />
    {/* Cool fill from the opposite side keeps shadows from going muddy. */}
    <Lightformer
      form="rect"
      intensity={2.4}
      color="#cfe6ff"
      position={[8, 3, 6]}
      rotation={[0, -Math.PI / 4, 0]}
      scale={[8, 8, 1]}
    />
    {/* Overhead strip: gives cylinders and helmets a clean vertical highlight. */}
    <Lightformer
      form="rect"
      intensity={3.2}
      color="#ffffff"
      position={[0, 10, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      scale={[14, 5, 1]}
    />
    {/* Low bounce, standing in for a floor. */}
    <Lightformer
      form="rect"
      intensity={1.1}
      color="#3a3a48"
      position={[0, -7, 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[16, 12, 1]}
    />
    {/* Rim accents in the app's own palette, so objects pick up brand colour. */}
    <Lightformer form="circle" intensity={2.2} color="#ff7a4a" position={[-9, -1, -7]} scale={4} />
    <Lightformer form="circle" intensity={1.8} color="#4ac8ff" position={[9, 1, -8]} scale={4} />
  </Environment>
);
