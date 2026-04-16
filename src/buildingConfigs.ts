import { BuildingType, BuildingParams } from './types';

export interface BuildingConfig {
  type: BuildingType;
  name: string;
  description: string;
  cost: number;
  color: string;
  defaultParams: BuildingParams;
  unlockLevel: number;
}

export const BUILDING_CONFIGS: Record<BuildingType, BuildingConfig> = {
  oscillator: {
    type: 'oscillator',
    name: 'Oscillator',
    description: 'Basic sound source producing a continuous tone.',
    cost: 50,
    color: '#00f2ff',
    unlockLevel: 1,
    defaultParams: {
      waveType: 'sine',
      volume: -20,
      powerConsumption: 10,
    }
  },
  sequencer: {
    type: 'sequencer',
    name: 'Sequencer',
    description: 'Plays a rhythmic pattern of notes.',
    cost: 100,
    color: '#ff00ea',
    unlockLevel: 2,
    defaultParams: {
      waveType: 'square',
      volume: -20,
      pattern: [1, 0, 1, 0],
      powerConsumption: 15,
    }
  },
  sampler: {
    type: 'sampler',
    name: 'Sampler',
    description: 'Plays back recorded audio samples.',
    cost: 150,
    color: '#7000ff',
    unlockLevel: 4,
    defaultParams: {
      volume: -15,
      powerConsumption: 12,
    }
  },
  arpeggiator: {
    type: 'arpeggiator',
    name: 'Arpeggiator',
    description: 'Breaks chords into a sequence of notes.',
    cost: 200,
    color: '#ffcc00',
    unlockLevel: 5,
    defaultParams: {
      waveType: 'sawtooth',
      volume: -20,
      rate: '8n',
      powerConsumption: 20,
    }
  },
  fx: {
    type: 'fx',
    name: 'FX Unit',
    description: 'Applies audio effects to nearby buildings.',
    cost: 300,
    color: '#00ffcc',
    unlockLevel: 6,
    defaultParams: {
      radius: 250,
      reverb: 0.4,
      delay: 0.4,
    }
  },
  power_plant: {
    type: 'power_plant',
    name: 'Power Plant',
    description: 'Generates power for your musical infrastructure.',
    cost: 500,
    color: '#00ff66',
    unlockLevel: 99, // Put in the back burner
    defaultParams: {
      radius: 400,
      powerOutput: 100,
    }
  },
  master_clock: {
    type: 'master_clock',
    name: 'Master Clock',
    description: 'Synchronizes all sequencers within its radius.',
    cost: 1000,
    color: '#ff00ff',
    unlockLevel: 9,
    defaultParams: {
      radius: 600,
    }
  },
  global_fx: {
    type: 'global_fx',
    name: 'Global FX',
    description: 'Master effects processor for the entire city.',
    cost: 2500,
    color: '#ff3300',
    unlockLevel: 12,
    defaultParams: {
      reverb: 0.3,
      delay: 0.3,
    }
  },
  road: {
    type: 'road',
    name: 'Road',
    description: 'Connects buildings and boosts their efficiency.',
    cost: 10,
    color: '#555',
    unlockLevel: 1,
    defaultParams: {}
  }
};
