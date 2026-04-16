export type BuildingType = 'oscillator' | 'sequencer' | 'sampler' | 'fx' | 'arpeggiator' | 'global_fx' | 'road';
export type WaveType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface BuildingParams {
  note?: string;
  waveType?: WaveType;
  volume?: number;
  detune?: number;
  sample?: string;
  pattern?: number[];
  active?: boolean;
  reverb?: number;
  delay?: number;
  rate?: string; // For arpeggiator
}

export interface BuildingData {
  id: string;
  ownerId: string;
  ownerName?: string;
  type: BuildingType;
  x: number;
  y: number;
  color?: string;
  params: BuildingParams;
  level: number;
  createdAt?: string;
}

export interface RoadData {
  id: string;
  ownerId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
  harmonyPoints: number;
  xp: number;
  level: number;
  lastActive?: string;
}
