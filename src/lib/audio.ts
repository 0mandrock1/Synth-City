import * as Tone from 'tone';
import { BuildingData } from '../types';

class AudioEngine {
  private synths: Map<string, any> = new Map();
  private synthParams: Map<string, any> = new Map();
  private initialized = false;
  private meter = new Tone.Meter();
  private analyser = new Tone.Analyser('fft', 256);
  private reverb = new Tone.Reverb({ decay: 2, wet: 0.3 }).toDestination();
  private delay = new Tone.FeedbackDelay("8n", 0.3).connect(this.reverb);

  async init() {
    if (this.initialized) return;
    await Tone.start();
    Tone.Destination.connect(this.meter);
    Tone.Destination.connect(this.analyser);
    this.initialized = true;
    console.log('Audio Engine Initialized');
  }

  getMeterValue() {
    return this.meter.getValue();
  }

  getAnalyser() {
    return this.analyser;
  }

  updateBuildings(buildings: BuildingData[]) {
    if (!this.initialized) return;

    buildings.forEach(b => {
      if (b.type === 'global_fx') {
        this.updateGlobalFX(b);
        return;
      }
      if (b.type === 'road') return;

      if (!this.synths.has(b.id)) {
        this.createSynth(b);
      } else {
        this.updateSynth(b);
      }
    });

    // Remove synths for buildings that no longer exist
    const currentIds = new Set(buildings.map(b => b.id));
    this.synths.forEach((_, id) => {
      if (!id.includes('_') && !currentIds.has(id)) {
        this.removeSynth(id);
      }
    });
  }

  private updateGlobalFX(b: BuildingData) {
    if (b.params.reverb !== undefined) this.reverb.wet.value = b.params.reverb;
    if (b.params.delay !== undefined) this.delay.wet.value = b.params.delay;
  }

  private createSynth(b: BuildingData) {
    let synth: any;
    const note = b.params.note || 'C4';
    const wave = b.params.waveType || 'sine';
    const vol = b.params.volume || -20;
    const sample = b.params.sample || '';

    this.synthParams.set(b.id, { note, wave, vol, sample });

    switch (b.type) {
      case 'oscillator':
        synth = new Tone.PolySynth(Tone.Synth).connect(this.delay);
        synth.set({ oscillator: { type: wave } });
        synth.volume.value = vol;
        const loop = new Tone.Loop(time => {
          const params = this.synthParams.get(b.id);
          if (params) synth.triggerAttackRelease(params.note, '8n', time);
        }, '4n').start(0);
        this.synths.set(`${b.id}_loop`, loop);
        break;
      case 'sequencer':
        synth = new Tone.PolySynth(Tone.Synth).connect(this.delay);
        synth.set({ oscillator: { type: wave } });
        synth.volume.value = vol;
        const seq = new Tone.Sequence((time, val) => {
          const params = this.synthParams.get(b.id);
          if (val && params) synth.triggerAttackRelease(params.note, '16n', time);
        }, b.params.pattern || [1, 0, 1, 0], '8n').start(0);
        this.synths.set(`${b.id}_seq`, seq);
        break;
      case 'arpeggiator':
        synth = new Tone.PolySynth(Tone.Synth).connect(this.delay);
        synth.set({ oscillator: { type: wave } });
        synth.volume.value = vol;
        const arpNotes = [note, Tone.Frequency(note).transpose(4).toNote(), Tone.Frequency(note).transpose(7).toNote()];
        const arp = new Tone.Sequence((time, n) => {
          synth.triggerAttackRelease(n, '16n', time);
        }, arpNotes, b.params.rate || '8n').start(0);
        this.synths.set(`${b.id}_arp`, arp);
        break;
      case 'sampler':
        const sampleUrl = b.params.sample || 'https://tonejs.github.io/audio/drum-samples/kick.mp3';
        synth = new Tone.Player(sampleUrl).connect(this.delay);
        synth.volume.value = vol;
        const samplerLoop = new Tone.Loop(time => {
          if (synth.loaded) synth.start(time);
        }, '2n').start(0);
        this.synths.set(`${b.id}_loop`, samplerLoop);
        break;
      default:
        return;
    }
    
    this.synths.set(b.id, synth);
  }

  private updateSynth(b: BuildingData) {
    const synth = this.synths.get(b.id);
    if (!synth) return;

    const wave = b.params.waveType || 'sine';
    const vol = b.params.volume || -20;
    const note = b.params.note || 'C4';
    const sample = b.params.sample || '';

    this.synthParams.set(b.id, { note, wave, vol, sample });

    if (synth instanceof Tone.PolySynth) {
      synth.set({ oscillator: { type: wave } });
      synth.volume.value = vol;
      
      const seq = this.synths.get(`${b.id}_seq`);
      if (seq) {
        seq.events = b.params.pattern || [1, 0, 1, 0];
      }

      const arp = this.synths.get(`${b.id}_arp`);
      if (arp) {
        const arpNotes = [note, Tone.Frequency(note).transpose(4).toNote(), Tone.Frequency(note).transpose(7).toNote()];
        arp.events = arpNotes;
        arp.interval.value = b.params.rate || '8n';
      }
    } else if (synth instanceof Tone.Player) {
      synth.volume.value = vol;
      const currentUrl = b.params.sample || 'https://tonejs.github.io/audio/drum-samples/kick.mp3';
      const lastParams = this.synthParams.get(b.id);
      if (lastParams && lastParams.sample !== currentUrl) {
        synth.load(currentUrl);
      }
    } else if (synth instanceof Tone.NoiseSynth) {
      synth.volume.value = vol;
    }
  }

  private removeSynth(id: string) {
    const synth = this.synths.get(id);
    this.synthParams.delete(id);
    if (synth) {
      if ('dispose' in synth) synth.dispose();
      this.synths.delete(id);
    }
    
    ['seq', 'loop', 'arp'].forEach(suffix => {
      const sub = this.synths.get(`${id}_${suffix}`);
      if (sub) {
        sub.dispose();
        this.synths.delete(`${id}_${suffix}`);
      }
    });
  }

  startTransport() {
    Tone.Transport.start();
  }

  stopTransport() {
    Tone.Transport.stop();
  }
}

export const audioEngine = new AudioEngine();
