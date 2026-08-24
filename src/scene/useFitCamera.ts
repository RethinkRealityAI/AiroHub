/**
 * Fits the camera to the subject for the current viewport.
 *
 * A fixed camera distance only frames well at one aspect ratio. On a phone in
 * portrait the horizontal field of view is far narrower than on a desktop, so a
 * distance tuned for a wide window crops wide objects (the skate deck, the
 * subway panel, the van) off both edges.
 *
 * This derives the distance from the subject's bounding radius and *both* the
 * vertical and horizontal fields of view, taking whichever is more restrictive,
 * and re-runs whenever the viewport or the subject changes.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function useFitCamera(
  radius: number | null,
  orbitRef: React.MutableRefObject<any> | React.RefObject<any>,
  /** Extra breathing room around the subject. 1 = exactly touching the frame. */
  margin = 1.12
) {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!radius || radius <= 0) return;
    const perspective = camera as THREE.PerspectiveCamera;
    if (!perspective.isPerspectiveCamera) return;

    const aspect = size.width / Math.max(size.height, 1);
    const vFov = (perspective.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const distance = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2)) * margin;

    // Keep the current viewing angle, just change how far out we sit.
    const controls = orbitRef.current;
    const target = controls?.target ?? new THREE.Vector3(0, 0, 0);
    const direction = perspective.position.clone().sub(target);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize().multiplyScalar(distance);

    perspective.position.copy(target).add(direction);
    perspective.near = Math.max(distance / 200, 0.05);
    perspective.far = distance * 12;
    perspective.updateProjectionMatrix();

    if (controls) {
      // Let the player push in close, but never so far out that the subject
      // becomes a speck.
      controls.minDistance = distance * 0.35;
      controls.maxDistance = distance * 2.6;
      controls.update();
    }
  }, [radius, camera, size.width, size.height, orbitRef, margin]);
}
