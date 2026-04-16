export type BuildingType = 
  | 'note'
  | 'oscillator' 
  | 'sequencer' 
  | 'sampler' 
  | 'fx' 
  | 'arpeggiator' 
  | 'global_fx' 
  | 'road'
  | 'power_plant'
  | 'master_clock';

export type WaveType = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type ChordType = 'major' | 'minor' | 'diminished' | 'augmented' | 'maj7' | 'min7';
export type LoopMode = 'none' | 'loop' | 'pingpong';

export interface BuildingParams {
  note?: string;
  chordType?: ChordType;
  waveType?: WaveType;
  volume?: number;
  detune?: number;
  sample?: string;
  pattern?: number[];
  patternNotes?: string[];
  active?: boolean;
  reverb?: number;
  delay?: number;
  rate?: string; // For arpeggiator
  loopMode?: LoopMode;
  radius?: number; // Effect radius in pixels
  powerOutput?: number;
  powerConsumption?: number;
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
