import type * as THREE from 'three';

/**
 * Short one-shot sounds synthesized with Web Audio and played at a position in the
 * world (the AudioListener on the camera handles panning and distance).
 */
export class Sounds {
  private ctx: AudioContext;
  private noise: AudioBuffer;

  constructor(private listener: THREE.AudioListener) {
    this.ctx = listener.context;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Latch click plus a soft wooden thud; closing is louder and lower. */
  door(position: THREE.Vector3, opening: boolean): void {
    const out = this.at(position);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'bandpass', 3200, 0.03, 0.25); // latch
    this.burst(out, t + (opening ? 0.02 : 0.25), 'lowpass', opening ? 500 : 260, opening ? 0.12 : 0.18, opening ? 0.35 : 0.8); // thud
  }

  /** Car door: a solid thunk. */
  carDoor(position: THREE.Vector3): void {
    const out = this.at(position);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 220, 0.15, 0.9);
    this.burst(out, t, 'bandpass', 1800, 0.03, 0.15);
  }

  /** A crash: a low thump plus a metallic crunch, louder for harder hits (`strength` 0..1). */
  crash(position: THREE.Vector3, strength: number): void {
    const out = this.at(position);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 140, 0.35, 1.4 * strength);
    this.burst(out, t, 'bandpass', 900, 0.18, 0.6 * strength);
    this.burst(out, t + 0.03, 'bandpass', 2600, 0.12, 0.3 * strength);
  }

  /** A switch clicking (TV, lamp, stove). */
  click(position: THREE.Vector3Like): void {
    const out = this.at(position);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'bandpass', 4200, 0.02, 0.35);
    this.burst(out, t + 0.05, 'bandpass', 2600, 0.02, 0.2);
  }

  /** Sitting down: a soft cushion thump. */
  sit(position: THREE.Vector3Like): void {
    this.burst(this.at(position), this.ctx.currentTime, 'lowpass', 300, 0.25, 0.35);
  }

  /** A big bronze bell: one strike, ringing on for seconds. Heard across the village. */
  bell(position: THREE.Vector3Like, delay = 0): void {
    const out = this.at(position, 40, 6);
    const t = this.ctx.currentTime + delay;
    // Church-bell partials: hum, prime, minor third, fifth, octave and up.
    const f = 196;
    [[0.5, 0.5, 5], [1, 0.6, 4], [1.19, 0.35, 3], [1.5, 0.25, 2.5], [2, 0.3, 2.2], [2.52, 0.15, 1.6], [3, 0.12, 1.2], [4.2, 0.08, 0.8]].forEach(([r, level, decay]) =>
      this.tone(out, t, f * r, 'sine', 0.004, decay, level * 0.5),
    );
    this.burst(out, t, 'bandpass', 2400, 0.05, 0.25);
  }

  /** A temple gong: a shimmering swell that dies away slowly. */
  gong(position: THREE.Vector3Like): void {
    const out = this.at(position, 30, 6);
    const t = this.ctx.currentTime;
    [[82, 0.5, 6], [139, 0.35, 5], [187, 0.3, 4.5], [233, 0.22, 4], [311, 0.16, 3.4], [421, 0.1, 2.6], [587, 0.06, 2]].forEach(([freq, level, decay], i) =>
      this.tone(out, t, freq, 'sine', 0.02 + i * 0.03, decay, level * 0.55, 4),
    );
    this.burst(out, t, 'lowpass', 500, 0.3, 0.6);
  }

  /** A lighthouse foghorn: a long, deep blast. */
  horn(position: THREE.Vector3Like): void {
    const out = this.at(position, 50, 8);
    const t = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.35);
    gain.gain.setValueAtTime(0.5, t + 2.6);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 3.6);
    filter.connect(gain).connect(out);
    for (const [freq, type] of [[98, 'sawtooth'], [98.7, 'sawtooth'], [49, 'square']] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * 0.94, t);
      osc.frequency.linearRampToValueAtTime(freq, t + 0.3);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 3.7);
    }
  }

  /** A cannon shot: a deep boom and a crack. */
  cannon(position: THREE.Vector3Like): void {
    const out = this.at(position, 30, 6);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 160, 1.6, 2.2);
    this.burst(out, t, 'bandpass', 900, 0.25, 0.9);
    const thump = this.ctx.createOscillator();
    thump.frequency.setValueAtTime(90, t);
    thump.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    thump.connect(g).connect(out);
    thump.start(t);
    thump.stop(t + 0.8);
  }

  /** The creak and swoosh of a trebuchet's arm swinging. */
  whoosh(position: THREE.Vector3Like, length = 0.9): void {
    const out = this.at(position, 10, 4);
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + length * 0.7);
    filter.frequency.exponentialRampToValueAtTime(500, t + length);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.7, t + length * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + length + 0.05);
  }

  /** A firework rocket whistling up. */
  whistle(position: THREE.Vector3Like, length: number): void {
    const out = this.at(position, 25, 3);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(700 + Math.random() * 200, t);
    osc.frequency.exponentialRampToValueAtTime(2400 + Math.random() * 600, t + length);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.1);
    g.gain.setValueAtTime(0.07, t + length - 0.1);
    g.gain.linearRampToValueAtTime(0, t + length);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  /** A firework bursting: a bang, then crackle. */
  burstBang(position: THREE.Vector3Like, size = 1): void {
    const out = this.at(position, 60, 2);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 220, 1.2, 1.4 * size);
    this.burst(out, t, 'bandpass', 1400, 0.3, 0.5 * size);
    for (let i = 0; i < 14; i++) this.burst(out, t + 0.3 + Math.random() * 1.3, 'bandpass', 3000 + Math.random() * 3000, 0.03, 0.12 * size);
  }

  /** Something falling into water. */
  splash(position: THREE.Vector3Like, size = 1): void {
    const out = this.at(position, 6, 3);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 1400, 0.5 * size, 0.6 * size);
    this.burst(out, t + 0.05, 'bandpass', 600, 0.4 * size, 0.4 * size);
  }

  /** A huge reptile's roar: a growling, falling bellow. */
  roar(position: THREE.Vector3Like): void {
    const out = this.at(position, 30, 4);
    const t = this.ctx.currentTime;
    const formant = this.ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 1.2;
    formant.frequency.setValueAtTime(500, t);
    formant.frequency.linearRampToValueAtTime(320, t + 2.2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1.1, t + 0.25);
    gain.gain.setValueAtTime(1, t + 1.4);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    formant.connect(gain).connect(out);
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.linearRampToValueAtTime(70, t + 2.4);
    // A wobble for the growl.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = this.ctx.createGain();
    depth.gain.value = 18;
    lfo.connect(depth).connect(osc.frequency);
    osc.connect(formant);
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const ng = this.ctx.createGain();
    ng.gain.value = 0.5;
    noise.connect(ng).connect(formant);
    for (const n of [osc, lfo, noise]) {
      n.start(t);
      n.stop(t + 2.7);
    }
  }

  /** A bright arpeggio, not placed anywhere: you found a treasure. */
  chime(grand = false): void {
    const t = this.ctx.currentTime;
    const notes = grand ? [523, 659, 784, 1047, 1319, 1568] : [880, 1109, 1319, 1760];
    notes.forEach((f, i) => this.tone(this.listener.getInput(), t + i * 0.09, f, 'triangle', 0.005, 0.9, 0.12));
  }

  /** A two-note ding: an elevator arriving, a train's doors. */
  ding(position: THREE.Vector3Like): void {
    const out = this.at(position, 6, 2);
    const t = this.ctx.currentTime;
    this.tone(out, t, 1319, 'sine', 0.005, 1.1, 0.25);
    this.tone(out, t + 0.25, 1047, 'sine', 0.005, 1.4, 0.25);
  }

  /** A plop: a fishing float hitting the water, or a fish taking the bait. */
  plop(position: THREE.Vector3Like, level = 0.5): void {
    const out = this.at(position, 4, 2);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
    this.burst(out, t, 'lowpass', 1800, 0.25, level * 0.5);
  }

  /** A signal flare launching and fizzing. */
  flare(position: THREE.Vector3Like): void {
    const out = this.at(position, 20, 3);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'bandpass', 700, 0.4, 1.0);
    this.burst(out, t + 0.1, 'highpass', 3000, 2.5, 0.25);
  }

  /** Someone (or something soft) hit by a car: a dull body thump. `strength` 0..1. */
  thud(position: THREE.Vector3Like, strength: number): void {
    const out = this.at(position, 4);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 110, 0.3, 1.5 * strength);
    this.burst(out, t, 'bandpass', 420, 0.12, 0.6 * strength);
  }

  /** A metal post struck: a clang with a ringing tail. */
  clang(position: THREE.Vector3Like): void {
    const out = this.at(position, 8, 3);
    const t = this.ctx.currentTime;
    [[310, 1.6, 0.35], [847, 1.1, 0.2], [1520, 0.7, 0.12], [2310, 0.4, 0.08]].forEach(([f, decay, level]) => this.tone(out, t, f, 'triangle', 0.002, decay, level, 8));
    this.burst(out, t, 'bandpass', 3200, 0.08, 0.5);
    this.burst(out, t, 'lowpass', 160, 0.25, 0.8);
  }

  /** Plastic or wood knocked flying: a crack and a clatter. */
  crunch(position: THREE.Vector3Like): void {
    const out = this.at(position, 4);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'bandpass', 900, 0.1, 0.9);
    this.burst(out, t + 0.02, 'bandpass', 2400, 0.06, 0.4);
    for (let i = 0; i < 4; i++) this.burst(out, t + 0.12 + i * (0.08 + Math.random() * 0.08), 'bandpass', 1300 + Math.random() * 1500, 0.05, 0.25);
  }

  /** A fire hydrant knocked off: a pop, then the hiss of water gushing out. */
  gush(position: THREE.Vector3Like): void {
    const out = this.at(position, 8, 3.2);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 300, 0.2, 0.8);
    this.burst(out, t + 0.05, 'highpass', 2500, 2.9, 0.35);
    this.burst(out, t + 0.05, 'bandpass', 900, 2.9, 0.3);
  }

  /** A car wrecked: a deep bang and the crackle of flames catching. */
  wreck(position: THREE.Vector3Like): void {
    const out = this.at(position, 12, 3.2);
    const t = this.ctx.currentTime;
    this.burst(out, t, 'lowpass', 90, 1.2, 1.8);
    this.burst(out, t, 'bandpass', 600, 0.4, 0.8);
    for (let i = 0; i < 10; i++) this.burst(out, t + 0.3 + i * 0.22 + Math.random() * 0.1, 'bandpass', 2000 + Math.random() * 2500, 0.04, 0.2);
  }

  /** A sine (or other wave) note with a quick attack and exponential decay. */
  private tone(out: AudioNode, start: number, freq: number, type: OscillatorType, attack: number, decay: number, level: number, wobble = 0): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (wobble) {
      // A slow beat, as metal plates have.
      osc.detune.setValueAtTime(-wobble, start);
      osc.detune.linearRampToValueAtTime(wobble, start + decay);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(level, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, start + attack + decay);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + attack + decay + 0.05);
  }

  /** Filtered noise with a fast attack and exponential decay. */
  private burst(out: AudioNode, start: number, type: BiquadFilterType, freq: number, length: number, level: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = type === 'bandpass' ? 4 : 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length);
    src.connect(filter).connect(gain).connect(out);
    src.start(start, Math.random() * 0.3, length + 0.05);
  }

  /**
   * A panner at `position` that disconnects itself after `seconds`. Loud things get a
   * bigger `refDistance` (the distance at which they're at full volume).
   */
  private at(position: THREE.Vector3Like, refDistance = 2, seconds = 1.5): AudioNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.rolloffFactor = refDistance > 2 ? 1 : 1.5;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    panner.connect(this.listener.getInput());
    setTimeout(() => panner.disconnect(), seconds * 1000);
    return panner;
  }
}
