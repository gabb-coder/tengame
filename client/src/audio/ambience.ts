import * as THREE from 'three';
import type { ZoneId } from '../../../shared/world.ts';
import { JUNGLE } from '../../../shared/zones/jungle.ts';

/** What the soundscape needs to know each frame. */
export interface Surroundings {
  /** How much each zone is "here" (they fade into each other at the borders). */
  weights: Map<ZoneId, number>;
  /** 0 by day, 1 at night. */
  night: number;
  /** How hard it's raining, 0..1. */
  rain: number;
  submerged: boolean;
  /** Indoors: the outside is muffled. */
  sheltered: boolean;
  camera: THREE.Vector3;
  /** Distance to the nearest lit fire (Infinity if none). */
  fire: number;
  /** The volcano is erupting. */
  erupting: boolean;
  /** The player's jetpack is firing. */
  jetting: boolean;
}

/** A looping sound: a source through a filter, with its own volume. */
interface Bed {
  gain: GainNode;
  filter: BiquadFilterNode;
}

/**
 * The background sound of each place, made from filtered noise and little synthesized
 * calls: wind on the tundra, rain and the hum of the city, waves at the bay, birds by day
 * and crickets at night, insects in the jungle, the rumbling volcano, a waterfall.
 */
export class AmbientSound {
  private ctx: AudioContext;
  private out: GainNode;
  private muffle: BiquadFilterNode;
  private noise: AudioBuffer;
  private beds: Record<'wind' | 'rain' | 'waves' | 'deep' | 'city' | 'insects' | 'rumble' | 'hum' | 'jet' | 'crickets', Bed>;
  private falls: GainNode;
  private fallsPanner: PannerNode;
  private nextCall: Record<'bird' | 'siren' | 'beep' | 'crackle' | 'bubble' | 'gull' | 'jungleBird' | 'roar', number> = { bird: 0, siren: 0, beep: 0, crackle: 0, bubble: 0, gull: 0, jungleBird: 0, roar: 0 };
  private time = 0;

  constructor(listener: THREE.AudioListener) {
    this.ctx = listener.context;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.8;
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.out.connect(this.muffle).connect(listener.getInput());
    // Pink-ish noise: white noise smoothed a little, so it's less hissy.
    const n = this.ctx.sampleRate * 4;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + w * 0.15;
      b1 = 0.6 * b1 + w * 0.4;
      data[i] = (b0 + b1) * 0.6;
    }
    // Waves swell and break; insects shimmer; crickets chirp in pulses.
    this.beds = {
      wind: this.bed('bandpass', 380, 0.7),
      rain: this.bed('highpass', 1400, 0.4),
      waves: this.bed('lowpass', 520, 0.7, 0.11),
      deep: this.bed('lowpass', 260, 0.8),
      city: this.bed('lowpass', 180, 0.8),
      insects: this.bed('bandpass', 5200, 7, 17),
      rumble: this.bed('lowpass', 70, 0.9),
      hum: this.bed('bandpass', 140, 3),
      jet: this.bed('lowpass', 900, 0.8),
      crickets: this.tone(4300, 28),
    };
    // The wind gusts: its pitch wanders slowly.
    const gust = this.ctx.createOscillator();
    gust.frequency.value = 0.13;
    const depth = this.ctx.createGain();
    depth.gain.value = 160;
    gust.connect(depth).connect(this.beds.wind.filter.frequency);
    gust.start();
    // The city: a low drone under the noise.
    for (const f of [55, 82.5]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = 0.05;
      osc.connect(g).connect(this.beds.city.filter);
      osc.start();
    }
    // The waterfall roars from where it is.
    this.fallsPanner = this.ctx.createPanner();
    this.fallsPanner.panningModel = 'equalpower';
    this.fallsPanner.distanceModel = 'inverse';
    this.fallsPanner.refDistance = 14;
    this.fallsPanner.rolloffFactor = 1.3;
    this.fallsPanner.positionX.value = JUNGLE.falls.x;
    this.fallsPanner.positionY.value = 4;
    this.fallsPanner.positionZ.value = JUNGLE.falls.z;
    this.fallsPanner.connect(this.out);
    const fallsFilter = this.ctx.createBiquadFilter();
    fallsFilter.type = 'lowpass';
    fallsFilter.frequency.value = 1400;
    this.falls = this.ctx.createGain();
    this.falls.gain.value = 0;
    this.loop().connect(fallsFilter).connect(this.falls).connect(this.fallsPanner);
  }

  /** Overall ambience volume (on top of the master volume). */
  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  update(dt: number, s: Surroundings): void {
    this.time += dt;
    const w = (id: ZoneId) => s.weights.get(id) ?? 0;
    const day = 1 - s.night;
    const air = s.submerged ? 0 : s.sheltered ? 0.35 : 1;
    const high = THREE.MathUtils.clamp((s.camera.y - 20) / 60, 0, 1);
    const shore = s.camera.y < 12 ? 1 : 0.4;
    this.set('wind', air * (0.06 + w('arctic') * 0.5 + w('ancient') * 0.2 + w('space') * 0.12 + w('prehistoric') * 0.08 + high * 0.3));
    this.set('rain', (s.submerged ? 0 : s.sheltered ? 0.12 : 0.32) * s.rain);
    this.set('waves', air * w('ocean') * 0.45 * shore);
    this.set('deep', s.submerged ? 0.5 : 0);
    this.set('city', air * w('cyberpunk') * 0.5);
    this.set('insects', air * w('jungle') * (0.05 + s.night * 0.06));
    this.set('rumble', air * w('prehistoric') * (s.erupting ? 0.9 : 0.25));
    this.set('hum', w('space') * 0.18);
    this.set('jet', s.jetting ? 0.35 : 0);
    this.set('crickets', air * s.night * (w('town') + w('medieval') + w('jungle') * 0.5 + w('prehistoric') + w('ancient')) * 0.012);
    this.falls.gain.setTargetAtTime(s.submerged ? 0 : 0.9, this.ctx.currentTime, 0.3);
    this.muffle.frequency.setTargetAtTime(s.submerged ? 500 : s.sheltered ? 2500 : 20000, this.ctx.currentTime, 0.2);

    // Calls now and then: birds by day, a siren in the city, beeps at the outpost, gulls
    // over the bay, the crackle of a fire, bubbles under water, a distant roar.
    const birds = air * day * (w('town') + w('medieval') + w('prehistoric') * 0.5);
    if (birds > 0.1 && this.due('bird', 1.2 + Math.random() * 3 / birds)) this.bird(birds);
    if (air * day * w('jungle') > 0.2 && this.due('jungleBird', 1.5 + Math.random() * 3)) this.jungleBird(w('jungle'));
    if (air * w('ocean') * shore > 0.2 && this.due('gull', 3 + Math.random() * 6)) this.gull(w('ocean'));
    if (air * w('cyberpunk') > 0.3 && this.due('siren', 14 + Math.random() * 20)) this.siren(w('cyberpunk'));
    if (w('space') > 0.3 && this.due('beep', 2 + Math.random() * 5)) this.beep(w('space'));
    if (s.fire < 14 && this.due('crackle', 0.05 + Math.random() * 0.25)) this.crackle(1 - s.fire / 14);
    if (s.submerged && this.due('bubble', 0.4 + Math.random() * 1.5)) this.bubble();
    if (air * w('prehistoric') > 0.4 && this.due('roar', 20 + Math.random() * 30)) this.distantRoar(w('prehistoric'));
  }

  private due(call: keyof AmbientSound['nextCall'], wait: number): boolean {
    if (this.time < this.nextCall[call]) return false;
    // The first time just schedules; after that, fire and reschedule.
    const first = this.nextCall[call] === 0;
    this.nextCall[call] = this.time + wait;
    return !first;
  }

  private set(bed: keyof AmbientSound['beds'], level: number): void {
    this.beds[bed].gain.gain.setTargetAtTime(Math.max(0, level), this.ctx.currentTime, 0.4);
  }

  private loop(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 3);
    return src;
  }

  /** A looping noise bed through a filter, pulsing `tremolo` times a second if given. */
  private bed(type: BiquadFilterType, freq: number, q: number, tremolo = 0): Bed {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.loop().connect(filter).connect(this.pulse(tremolo)).connect(gain).connect(this.out);
    return { gain, filter };
  }

  /** A steady high tone, pulsing (for crickets). */
  private tone(freq: number, tremolo: number): Bed {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = freq;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(this.pulse(tremolo)).connect(gain).connect(this.out);
    osc.start();
    return { gain, filter };
  }

  /** A volume that swings between 0 and 1 `rate` times a second (or stays at 1). */
  private pulse(rate: number): GainNode {
    const g = this.ctx.createGain();
    if (!rate) return g;
    g.gain.value = 0.5;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = rate;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.5;
    osc.connect(depth).connect(g.gain);
    osc.start();
    return g;
  }

  /** A short call: notes (Hz) each `step` seconds apart, at `level`. */
  private call(notes: number[], step: number, level: number, type: OscillatorType = 'sine', glide = 0.6): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    notes.forEach((f, i) => {
      const at = t + i * step;
      osc.frequency.setValueAtTime(f, at);
      osc.frequency.linearRampToValueAtTime(f * (1 + (Math.random() - 0.5) * 0.2), at + step * glide);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + 0.01);
      g.gain.linearRampToValueAtTime(0, at + step * 0.85);
    });
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    osc.connect(g).connect(pan).connect(this.out);
    osc.start(t);
    osc.stop(t + notes.length * step + 0.1);
  }

  private bird(level: number): void {
    const base = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 5);
    this.call(Array.from({ length: n }, (_, i) => base * (1 + (i % 2 ? 0.18 : 0) + Math.random() * 0.06)), 0.09 + Math.random() * 0.05, 0.035 * Math.min(1, level));
  }

  private jungleBird(level: number): void {
    // Whoops and trills of exotic birds.
    const base = 900 + Math.random() * 900;
    this.call([base, base * 1.5, base * 0.8, base * 1.7], 0.14, 0.05 * level, 'triangle', 0.9);
  }

  private gull(level: number): void {
    const base = 1300 + Math.random() * 300;
    this.call([base, base * 1.25, base * 0.9, base * 1.2, base * 0.85], 0.16, 0.035 * level, 'sawtooth', 0.8);
  }

  private siren(level: number): void {
    this.call([620, 920, 620, 920, 620, 920], 0.55, 0.018 * level, 'triangle', 1);
  }

  private beep(level: number): void {
    this.call([1200 + Math.random() * 800, 0, 1600], 0.08, 0.02 * level, 'square', 0);
  }

  private bubble(): void {
    const f = 300 + Math.random() * 500;
    this.call([f, f * 1.8], 0.05, 0.05, 'sine', 1);
  }

  private crackle(level: number): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2000 + Math.random() * 3000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + Math.random() * 0.04);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 3, 0.1);
  }

  private distantRoar(level: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.linearRampToValueAtTime(60, t + 1.8);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * level, t + 0.3);
    g.gain.linearRampToValueAtTime(0, t + 2);
    osc.connect(f).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 2.1);
  }
}
