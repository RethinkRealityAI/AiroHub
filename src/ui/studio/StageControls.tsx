/**
 * Stage card instruments that read the live camera.
 *
 *   `OrbitReadout` — azimuth and elevation, refreshed every frame through a
 *                    ref so the card never re-renders while the model spins.
 *   `ZoomSlider`   — dolly in and out on a linear scale between the fit
 *                    camera's near and far limits, and follows wheel zoom.
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface OrbitLike {
  getAzimuthalAngle(): number;
  getPolarAngle(): number;
  minDistance: number;
  maxDistance: number;
  target: THREE.Vector3;
  object: THREE.Camera;
  update(): void;
}

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

export const OrbitReadout: React.FC<{ orbitRef: React.RefObject<OrbitLike | null> }> = ({ orbitRef }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const controls = orbitRef.current;
      if (!controls || !ref.current) return;
      const az = ((deg(-controls.getAzimuthalAngle()) % 360) + 360) % 360;
      const el = 90 - deg(controls.getPolarAngle());
      const text = `AZ ${az}° · EL ${el}°`;
      if (text !== last) {
        last = text;
        ref.current.textContent = text;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [orbitRef]);
  return (
    <span ref={ref} className="rail-badge tabular-nums" aria-live="off">
      AZ 0° · EL 0°
    </span>
  );
};

export const ZoomSlider: React.FC<{
  orbitRef: React.RefObject<OrbitLike | null>;
  onUserZoom?: () => void;
}> = ({ orbitRef, onUserZoom }) => {
  const input = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);

  const closeness = (controls: OrbitLike) => {
    const dist = controls.object.position.distanceTo(controls.target);
    const span = Math.max(1e-3, controls.maxDistance - controls.minDistance);
    return Math.min(1, Math.max(0, (controls.maxDistance - dist) / span));
  };

  // Mirror wheel / pinch zoom into the slider.
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const controls = orbitRef.current;
      if (!controls || dragging.current || !input.current) return;
      const v = Math.round(closeness(controls) * 100);
      if (v === last) return;
      last = v;
      input.current.value = String(v);
      if (readout.current) readout.current.textContent = `${v}%`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [orbitRef]);

  const apply = (value: number) => {
    const controls = orbitRef.current;
    if (!controls) return;
    const dist = controls.maxDistance - (value / 100) * (controls.maxDistance - controls.minDistance);
    const cam = controls.object;
    const dir = cam.position.clone().sub(controls.target).normalize().multiplyScalar(dist);
    cam.position.copy(controls.target).add(dir);
    controls.update();
    if (readout.current) readout.current.textContent = `${Math.round(value)}%`;
  };

  return (
    <div className="flex items-center gap-2">
      <span className="mono-caps text-[8.5px] text-white/45 w-9 shrink-0">Zoom</span>
      <input
        ref={input}
        type="range"
        min={0}
        max={100}
        step={1}
        defaultValue={50}
        aria-label="Camera zoom"
        className="airo-slider flex-1 min-w-0"
        onPointerDown={() => {
          dragging.current = true;
          onUserZoom?.();
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onChange={(e) => apply(Number(e.target.value))}
      />
      <span ref={readout} className="mono-caps text-[8.5px] text-white/60 w-8 text-right tabular-nums">
        50%
      </span>
    </div>
  );
};
