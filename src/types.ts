import * as THREE from 'three';

export type TargetObjectType =
  | `up-${string}`
  | 'easel'
  | 'skateboard'
  | 'subway'
  | 'boombox'
  | 'wall'
  | 'custom3d'
  | 'helmet'
  | 'sneaker'
  | 'vinyltoy'
  | 'sculpture'
  | 'hoodie'
  | 'guitar'
  | 'hydrant'
  | 'van'
  | 'cap';

export interface PlayerInfo {
  id: string;
  slot: number; // 1, 2, 3, 4
  name: string;
  color: string;
  tool: 'spray' | 'brush';
  mode: 'motion' | 'projection';
  isPainting?: boolean;
}

export interface PlayerState {
  id: string;
  slot: number; // 1 to 4
  name: string;
  color: string;
  tool: 'spray' | 'brush';
  isPainting: boolean;
  cursorPx: { x: number; y: number };
  /**
   * Arrival-stamped aim samples (normalised 0..1, `at` = local
   * performance.now() when the packet landed), drained each frame by the
   * studio's jitter-buffer interpolation. Motion-mode players only.
   */
  cursorSamples?: { x: number; y: number; at: number }[];
  worldPos: [number, number, number];
  surfacePoint?: [number, number, number];
  surfaceNormal?: [number, number, number];
  pressure: number;
  /** Tool size multiplier, 0.4 - 2.0. */
  sizeMultiplier?: number;
  lastActive: number;
  mode: 'motion' | 'projection';
  /** The local studio operator, who aims with the mouse rather than a phone. */
  isHost?: boolean;
}

/**
 * One image placed on the shared paint layer.
 *
 * Anchored in UV rather than screen or world space, so every peer draws it in
 * exactly the same place on the model no matter where its camera is pointing.
 * `stampId` doubles as the stroke id, which is what makes a stamp a single
 * undoable unit across the room.
 */
export interface ImageStampData {
  playerId: string;
  stampId: string;
  /** The image itself, as a data URL kept inside the broadcast budget. */
  img: string;
  /** Texture-space centre, 0..1. */
  u: number;
  v: number;
  /** Half the stamp's longest edge, in texture pixels. */
  radiusPx: number;
  /** Radians. */
  rotation: number;
  /** Recolours a white-on-alpha stencil; absent for full-colour uploads. */
  tint?: string | null;
}

export interface MotionData {
  roomId: string;
  playerId?: string;
  playerSlot?: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  accel?: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
}

export interface ActionData {
  roomId: string;
  playerId?: string;
  playerSlot?: number;
  action: 'spray' | 'brush';
  state: 'start' | 'stop' | 'move';
  color?: string;
  size?: number;
  pressure?: number;
}

export interface SettingsData {
  roomId: string;
  playerId?: string;
  color?: string;
  size?: number;
  tool?: 'spray' | 'brush';
  targetObject?: TargetObjectType;
  playerName?: string;
}

export interface CalibrateData {
  roomId: string;
  playerId?: string;
}

export interface ShakeData {
  roomId: string;
  playerId?: string;
  intensity?: number;
}

export interface ModelMaterialInfo {
  name: string;
  type: string;
  color: string;
  roughness?: number;
  metalness?: number;
  hasTexture: boolean;
}

export interface Uploaded3DModelInfo {
  id: string;
  name: string;
  fileName: string;
  meshCount: number;
  vertexCount: number;
  materials: ModelMaterialInfo[];
  url?: string;
}
