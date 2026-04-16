import * as Tone from 'tone';
import { BuildingData } from '../types';

class AudioEngine {
  private synths: Map<string, { synth: any, reverbSend: any, delaySend: any }> = new Map();
  private synthParams: Map<string, any> = new Map();
  private droneLastTrigger: Map<string, number> = new Map();
  private sequencerSteps: Map<string, number> = new Map();
  private failedSamples: Set<string> = new Set();
  private initialized = false;
  private meter = new Tone.Meter();
  private analyser = new Tone.Analyser('fft', 256);
  private limiter = new Tone.Limiter(-1).toDestination();
  private reverb = new Tone.Reverb({ decay: 3, wet: 1 }).connect(this.limiter);
  private delay = new Tone.FeedbackDelay("8n", 0.4).connect(this.reverb);

  async init() {
    if (this.initialized) return;
    await Tone.start();
    await this.reverb.generate();
    this.limiter.connect(this.meter);
    this.limiter.connect(this.analyser);
    
    // Cleanup loop for drones
    Tone.Transport.scheduleRepeat((time) => {
      const now = Tone.now();
      this.droneLastTrigger.forEach((lastTime, id) => {
        const entry = this.synths.get(id);
        if (entry && now - lastTime > 0.4) { // If not triggered for 400ms
          if (entry.synth instanceof Tone.Oscillator && entry.synth.state === 'started') {
            entry.synth.stop(time);
          }
        }
      });
    }, "8n");

    this.initialized = true;
    console.log('Audio Engine Initialized');
  }

  getMeterValue() {
    return this.meter.getValue();
  }

  getAnalyser() {
    return this.analyser;
  }

  getTransport() {
    return Tone.Transport;
  }

  updateBuildings(buildings: BuildingData[]) {
    if (!this.initialized) return;

    const fxUnits = buildings.filter(b => b.type === 'fx');
    const globalFX = buildings.find(b => b.type === 'global_fx');
    if (globalFX) this.updateGlobalFX(globalFX);

    // Use a more efficient way to update synths
    for (const b of buildings) {
      if (b.type === 'global_fx' || b.type === 'road' || b.type === 'fx') continue;

      let entry = this.synths.get(b.id);
      if (!entry) {
        this.createSynth(b);
        entry = this.synths.get(b.id);
      } else {
        this.updateSynth(b);
      }

      if (entry) {
        let reverbWet = 0;
        let delayWet = 0;
        
        // Only check FX units that could possibly be in range
        for (const fx of fxUnits) {
          const radius = fx.params.radius || 500;
          const dx = fx.x - b.x;
          const dy = fx.y - b.y;
          // Quick bounding box check before expensive sqrt
          if (Math.abs(dx) < radius && Math.abs(dy) < radius) {
            const distSq = dx * dx + dy * dy;
            if (distSq < radius * radius) {
              reverbWet = Math.max(reverbWet, fx.params.reverb || 0);
              delayWet = Math.max(delayWet, fx.params.delay || 0);
            }
          }
        }

        entry.reverbSend.gain.rampTo(reverbWet, 0.2);
        entry.delaySend.gain.rampTo(delayWet, 0.2);
      }
    }

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

    this.synthParams.set(b.id, { note, wave, vol, type: b.type });

    const reverbSend = new Tone.Gain(0).connect(this.reverb);
    const delaySend = new Tone.Gain(0).connect(this.delay);

    switch (b.type) {
      case 'note':
      case 'sequencer':
        synth = new Tone.PolySynth(Tone.Synth).connect(this.limiter);
        synth.set({ 
          oscillator: { type: wave },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.5 }
        });
        synth.volume.value = vol;
        break;
      case 'sampler':
        const sampleUrl = b.params.sample || 'https://tonejs.github.io/audio/drum-samples/4OP-FM/kick.mp3';
        synth = new Tone.Player({
          url: sampleUrl,
          onerror: (e) => {
            console.error(`Failed to load sample: ${sampleUrl}`, e);
            this.failedSamples.add(b.id);
          },
          onload: () => {
            this.failedSamples.delete(b.id);
          }
        }).connect(this.limiter);
        synth.volume.value = vol;
        break;
      case 'arpeggiator':
        synth = new Tone.PolySynth(Tone.Synth).connect(this.limiter);
        synth.set({ 
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.05, decay: 0.2, sustain: 0.2, release: 0.8 }
        });
        synth.volume.value = vol;
        break;
      case 'oscillator':
        synth = new Tone.Oscillator(note, wave).connect(this.limiter);
        synth.volume.value = vol;
        break;
      default:
        reverbSend.dispose();
        delaySend.dispose();
        return;
    }
    
    synth.connect(reverbSend);
    synth.connect(delaySend);
    this.synths.set(b.id, { synth, reverbSend, delaySend });
  }

  private getChordNotes(root: string, type: string): string[] {
    const f = Tone.Frequency(root);
    switch (type) {
      case 'minor': return [f.toNote(), f.transpose(3).toNote(), f.transpose(7).toNote()];
      case 'diminished': return [f.toNote(), f.transpose(3).toNote(), f.transpose(6).toNote()];
      case 'augmented': return [f.toNote(), f.transpose(4).toNote(), f.transpose(8).toNote()];
      case 'maj7': return [f.toNote(), f.transpose(4).toNote(), f.transpose(7).toNote(), f.transpose(11).toNote()];
      case 'min7': return [f.toNote(), f.transpose(3).toNote(), f.transpose(7).toNote(), f.transpose(10).toNote()];
      default: return [f.toNote(), f.transpose(4).toNote(), f.transpose(7).toNote()]; // major
    }
  }

  triggerBuilding(id: string, time: number = Tone.now()) {
    const entry = this.synths.get(id);
    const params = this.synthParams.get(id);
    if (!entry || !params) return;

    const { synth } = entry;

    switch (params.type) {
      case 'note':
        if (synth instanceof Tone.PolySynth) {
          synth.triggerAttackRelease(params.note, '16n', time);
        }
        break;
      case 'oscillator':
        if (synth instanceof Tone.Oscillator) {
          if (synth.state !== 'started') synth.start(time);
          this.droneLastTrigger.set(id, time);
        }
        break;
      case 'sampler':
        const samplerPattern = params.pattern || [1];
        const samplerStep = this.sequencerSteps.get(id) || 0;
        if (samplerPattern[samplerStep % samplerPattern.length]) {
          if (synth instanceof Tone.Player) {
            if (synth.loaded && !this.failedSamples.has(id)) {
              synth.start(time);
            } else if (this.failedSamples.has(id)) {
              // Fallback: trigger a short beep if sample failed
              const fallbackSynth = new Tone.Synth().toDestination();
              fallbackSynth.volume.value = -30;
              fallbackSynth.triggerAttackRelease("C2", "32n", time);
              setTimeout(() => fallbackSynth.dispose(), 100);
            }
          }
        }
        this.sequencerSteps.set(id, samplerStep + 1);
        break;
      case 'sequencer':
        const seqPattern = params.pattern || [1];
        const seqNotes = params.patternNotes || [];
        const seqStep = this.sequencerSteps.get(id) || 0;
        const currentStepIdx = seqStep % seqPattern.length;
        
        if (seqPattern[currentStepIdx]) {
          if (synth instanceof Tone.PolySynth) {
            const stepNote = seqNotes[currentStepIdx] || params.note || 'C3';
            synth.triggerAttackRelease(stepNote, '16n', time);
          }
        }
        this.sequencerSteps.set(id, seqStep + 1);
        break;
      case 'arpeggiator':
        if (synth instanceof Tone.PolySynth) {
          const rootNote = params.note || 'C3';
          const notes = this.getChordNotes(rootNote, params.chordType || 'major');
          const arpStep = this.sequencerSteps.get(id) || 0;
          
          // Arp Rate logic: 4n = trigger every 4 pulses, 8n = every 2, 16n = every 1
          const rate = params.rate || '16n';
          const divisor = rate === '4n' ? 4 : rate === '8n' ? 2 : 1;
          
          if (arpStep % divisor === 0) {
            const noteIndex = Math.floor(arpStep / divisor) % notes.length;
            const currentNote = notes[noteIndex];
            
            try {
              synth.triggerAttackRelease(currentNote, '16n', time);
            } catch (e) {
              console.warn(`Arpeggiator failed to trigger note: ${currentNote}`, e);
            }
          }
          
          this.sequencerSteps.set(id, arpStep + 1);
        }
        break;
    }
  }

  private updateSynth(b: BuildingData) {
    const entry = this.synths.get(b.id);
    if (!entry) return;

    const { synth } = entry;
    const wave = b.params.waveType || 'sine';
    const vol = b.params.volume || -20;
    const note = b.params.note || 'C4';
    const sample = b.params.sample || '';
    const pattern = b.params.pattern || [1, 0, 1, 0];
    const patternNotes = b.params.patternNotes || [];
    const chordType = b.params.chordType || 'major';
    const loopMode = b.params.loopMode || 'none';
    const rate = b.params.rate || '16n';

    const lastParams = this.synthParams.get(b.id);
    this.synthParams.set(b.id, { note, wave, vol, sample, type: b.type, pattern, patternNotes, chordType, loopMode, rate });

    if (synth instanceof Tone.PolySynth) {
      synth.set({ oscillator: { type: wave } });
      synth.volume.value = vol;
    } else if (synth instanceof Tone.Oscillator) {
      synth.frequency.value = Tone.Frequency(note).toFrequency();
      synth.type = wave;
      synth.volume.value = vol;
    } else if (synth instanceof Tone.Player) {
      synth.volume.value = vol;
      synth.loop = loopMode === 'loop';
      const currentUrl = b.params.sample || 'https://tonejs.github.io/audio/drum-samples/4OP-FM/kick.mp3';
      if (lastParams && lastParams.sample !== currentUrl) {
        synth.load(currentUrl).then(() => {
          this.failedSamples.delete(b.id);
        }).catch((e) => {
          console.error(`Failed to load sample update: ${currentUrl}`, e);
          this.failedSamples.add(b.id);
        });
      }
    }
  }

  private removeSynth(id: string) {
    const entry = this.synths.get(id);
    this.synthParams.delete(id);
    this.sequencerSteps.delete(id);
    this.droneLastTrigger.delete(id);
    if (entry) {
      entry.synth.dispose();
      entry.reverbSend.dispose();
      entry.delaySend.dispose();
      this.synths.delete(id);
    }
  }

  startTransport() {
    Tone.Transport.start();
  }

  stopTransport() {
    Tone.Transport.stop();
  }
  
  isSampleFailed(id: string) {
    return this.failedSamples.has(id);
  }
}

export const audioEngine = new AudioEngine();
