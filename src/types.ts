import * as THREE from 'three';

export type TargetObjectType =
  | 'easel'
  | 'skateboard'
  | 'subway'
  | 'boombox'
  | 'wall'
  | 'custom3d'
  | 'helmet'
  | 'sneaker'
  | 'vinyltoy'
  | 'sculpture';

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
  worldPos: [number, number, number];
  surfacePoint?: [number, number, number];
  surfaceNormal?: [number, number, number];
  pressure: number;
  lastActive: number;
  mode: 'motion' | 'projection';
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

export interface ProjectionDrawData {
  roomId: string;
  playerId?: string;
  playerSlot?: number;
  playerName?: string;
  type: 'start' | 'move' | 'end';
  tool: 'spray' | 'brush';
  x: number; // 0 to 1 normalized
  y: number; // 0 to 1 normalized
  color: string;
  size: number;
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
