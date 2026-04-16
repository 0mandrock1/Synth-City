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
  note: {
    type: 'note',
    name: 'Note',
    description: 'Triggers a single note when a pulse passes.',
    cost: 50,
    color: '#00f2ff',
    unlockLevel: 1,
    defaultParams: {
      waveType: 'sine',
      volume: -20,
      powerConsumption: 10,
      radius: 300,
      note: 'C4',
    }
  },
  oscillator: {
    type: 'oscillator',
    name: 'Oscillator',
    description: 'Generates a continuous drone as long as it receives pulses.',
    cost: 150,
    color: '#00ff66',
    unlockLevel: 3,
    defaultParams: {
      waveType: 'sawtooth',
      volume: -25,
      powerConsumption: 20,
      radius: 400,
      note: 'C2',
    }
  },
  sequencer: {
    type: 'sequencer',
    name: 'Sequencer',
    description: 'Melodic 16-step patterns using internal synthesis.',
    cost: 100,
    color: '#ff00ea',
    unlockLevel: 2,
    defaultParams: {
      waveType: 'square',
      volume: -20,
      pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      patternNotes: ['C3', 'C3', 'C3', 'C3', 'G3', 'G3', 'G3', 'G3', 'A3', 'A3', 'A3', 'A3', 'G3', 'G3', 'G3', 'G3'],
      powerConsumption: 15,
      radius: 350,
      note: 'C3',
    }
  },
  sampler: {
    type: 'sampler',
    name: 'Sampler',
    description: 'Rhythmic 16-step patterns using audio samples.',
    cost: 150,
    color: '#7000ff',
    unlockLevel: 4,
    defaultParams: {
      volume: -15,
      powerConsumption: 12,
      radius: 400,
      sample: 'https://tonejs.github.io/audio/drum-samples/4OP-FM/kick.mp3',
      loopMode: 'none',
      pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    }
  },
  arpeggiator: {
    type: 'arpeggiator',
    name: 'Arpeggiator',
    description: 'Plays chords as a sequence of notes.',
    cost: 200,
    color: '#ffcc00',
    unlockLevel: 5,
    defaultParams: {
      waveType: 'sawtooth',
      volume: -20,
      rate: '16n',
      chordType: 'major',
      powerConsumption: 20,
      radius: 450,
      note: 'C3',
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
      radius: 800,
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
      radius: 1200,
      powerOutput: 100,
    }
  },
  master_clock: {
    type: 'master_clock',
    name: 'Clock',
    description: 'Generates signal pulses that travel along roads to trigger sounds.',
    cost: 100,
    color: '#ff4400',
    unlockLevel: 1,
    defaultParams: {
      radius: 1500,
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
