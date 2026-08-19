export type TargetObjectType = 'easel' | 'skateboard' | 'subway' | 'boombox' | 'wall';

export interface MotionData {
  roomId: string;
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
  action: 'spray' | 'brush';
  state: 'start' | 'stop' | 'move';
  color?: string;
  size?: number;
  pressure?: number;
}

export interface ProjectionDrawData {
  roomId: string;
  type: 'start' | 'move' | 'end';
  tool: 'spray' | 'brush';
  x: number; // 0 to 1 normalized
  y: number; // 0 to 1 normalized
  color: string;
  size: number;
}

export interface SettingsData {
  roomId: string;
  color?: string;
  size?: number;
  tool?: 'spray' | 'brush';
  targetObject?: TargetObjectType;
}

export interface CalibrateData {
  roomId: string;
}

export interface ShakeData {
  roomId: string;
  intensity?: number;
}
