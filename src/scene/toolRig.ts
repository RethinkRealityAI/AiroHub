/**
 * Tool rig — wraps a spray-can / brush model so that:
 *
 *   - its long axis (barrel/handle) runs along -Z, the direction it points
 *   - its emitting tip sits exactly at the wrapper origin
 *
 * Meshy has no notion of "this end is the nozzle", so the longest bounding-box
 * axis is treated as the barrel and `flip` selects which end leads. Both the
 * studio's floating tools and the phone's handheld tool build from this, so
 * the two views always agree about where the paint comes from.
 */
import * as THREE from 'three';
import { loadModel } from '../paint/modelRegistry';
import { createSprayCan } from './sprayCan';

export interface ToolRig {
  root: THREE.Group;
  /** Barrel length in world units after scaling. */
  length: number;
  /** Paint-colours the tool, where it has paintable parts (the can does). */
  setColor?: (color: THREE.ColorRepresentation) => void;
  /** Presses the tool's trigger, 0..1 (the can's actuator sinks). */
  setPressed?: (amount: number) => void;
  /** The tool's own materials, for effects that restyle them (the landing rim). */
  ownMaterials?: THREE.MeshStandardMaterial[];
  /** Frees what this rig owns; shared geometry and textures are untouched. */
  dispose?: () => void;
}

export interface ToolRigSpec {
  asset: string;
  /** World length of the barrel. */
  length: number;
  /** Swap which end of the barrel is treated as the tip. */
  flip: boolean;
}

export const TOOL_RIGS: Record<'spray' | 'brush', ToolRigSpec> = {
  // The can is procedural (see sprayCan.ts); the asset name is kept only so
  // the spec shape stays uniform.
  spray: { asset: 'tool-spraycan', length: 1.55, flip: true },
  brush: { asset: 'tool-brush', length: 2.0, flip: false },
};

export function buildToolRig(source: THREE.Object3D, spec: ToolRigSpec): ToolRig {
  const model = source.clone(true);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
  const rawLength = size[axis] || 1;
  const scale = spec.length / rawLength;

  const aligner = new THREE.Group();
  model.position.set(-center.x, -center.y, -center.z);
  aligner.add(model);

  // Rotate the barrel axis onto Z.
  if (axis === 'y') aligner.rotation.x = spec.flip ? -Math.PI / 2 : Math.PI / 2;
  else if (axis === 'x') aligner.rotation.y = spec.flip ? -Math.PI / 2 : Math.PI / 2;
  else if (spec.flip) aligner.rotation.y = Math.PI;

  const scaler = new THREE.Group();
  scaler.scale.setScalar(scale);
  scaler.add(aligner);
  // The model is centred on the origin, so its leading (-Z) end sits at
  // -length/2. Shifting +length/2 plants that tip exactly on the wrapper
  // origin with the body extending back along +Z — away from the surface.
  scaler.position.z = spec.length / 2;

  const root = new THREE.Group();
  root.add(scaler);
  return { root, length: spec.length };
}

/**
 * The procedural can in rig convention. Modelled upright (top at y = height,
 * orifice facing -Z), so it is dropped until its top sits on the origin and
 * turned -90 degrees about X: the body then runs along +Z and the orifice
 * faces -Y.
 */
export function createSprayCanRig(color?: THREE.ColorRepresentation): ToolRig {
  const spec = TOOL_RIGS.spray;
  const can = createSprayCan(color);
  can.group.position.y = -can.height;
  const turn = new THREE.Group();
  turn.rotation.x = -Math.PI / 2;
  turn.scale.setScalar(spec.length / can.height);
  turn.add(can.group);
  const root = new THREE.Group();
  root.add(turn);
  return {
    root,
    length: spec.length,
    setColor: can.setColor,
    setPressed: can.setPressed,
    ownMaterials: can.ownMaterials,
    dispose: can.dispose,
  };
}

/**
 * A rig that can be built without waiting on the network, or null. Only the
 * can qualifies; components seed their state from this so the first frame
 * already shows the real tool instead of a placeholder.
 */
export function createToolRigSync(tool: 'spray' | 'brush', color?: THREE.ColorRepresentation): ToolRig | null {
  return tool === 'spray' ? createSprayCanRig(color) : null;
}

/** Loads and rigs a tool model. Each call returns an independent clone. */
export async function loadToolRig(tool: 'spray' | 'brush'): Promise<ToolRig> {
  if (tool === 'spray') return createSprayCanRig();
  const spec = TOOL_RIGS[tool];
  const loaded = await loadModel(spec.asset, null, spec.length);
  return buildToolRig(loaded.root, spec);
}
