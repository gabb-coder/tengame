import * as THREE from 'three';
import { CAR } from './carPhysics.ts';

const CYLINDERS = 4;

/**
 * Synthesized four-cylinder engine: harmonics of the firing frequency through a
 * load-dependent low-pass filter, plus a little intake noise. No audio files needed.
 * Connect `output` to a destination (or a PannerNode for other players' cars).
 */
export class EngineSound {
  readonly output: GainNode;
  private oscillators: { osc: OscillatorNode; multiple: number }[] = [];
  private filter: BiquadFilterNode;
  private noiseGain: GainNode;
  private noise: AudioBufferSourceNode;

  constructor(private ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;

    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(6);
    shaper.oversample = '2x';
    shaper.connect(this.filter);
    this.filter.connect(this.output);

    // Firing frequency with half-order (uneven firing) and higher harmonics.
    for (const [multiple, type, level] of [
      [0.5, 'sine', 0.35],
      [1, 'sawtooth', 0.5],
      [2, 'square', 0.12],
      [3, 'sawtooth', 0.08],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(shaper);
      osc.start();
      this.oscillators.push({ osc, multiple });
    }

    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer(ctx);
    this.noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(band).connect(this.noiseGain).connect(this.output);
    this.noise.start();
  }

  /** `rpm` engine speed, `load` 0..1 throttle, `volume` 0..1 overall level. */
  update(rpm: number, load: number, volume = 1): void {
    const t = this.ctx.currentTime;
    const firing = (rpm / 60) * (CYLINDERS / 2);
    for (const { osc, multiple } of this.oscillators) {
      osc.frequency.setTargetAtTime(firing * multiple, t, 0.02);
    }
    const rev = Math.min(rpm / CAR.redlineRpm, 1);
    this.filter.frequency.setTargetAtTime(300 + rev * 1500 + load * 1800, t, 0.05);
    this.noiseGain.gain.setTargetAtTime((0.02 + load * 0.08) * rev, t, 0.05);
    this.output.gain.setTargetAtTime((0.1 + load * 0.12 + rev * 0.08) * volume, t, 0.05);
  }

  dispose(): void {
    for (const { osc } of this.oscillators) osc.stop();
    this.noise.stop();
    this.output.disconnect();
  }
}

/** Slip angles (radians) where tires start to squeal, and where they're fully sliding. */
const SQUEAL_START = THREE.MathUtils.degToRad(7);
const SQUEAL_FULL = THREE.MathUtils.degToRad(25);

/** Tire squeal from band-passed noise, driven by the car's slip angle. */
export class TireSound {
  readonly output: GainNode;
  private filter: BiquadFilterNode;
  private source: AudioBufferSourceNode;

  constructor(private ctx: AudioContext) {
    this.source = ctx.createBufferSource();
    this.source.buffer = noiseBuffer(ctx);
    this.source.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 1600;
    this.filter.Q.value = 8;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.source.connect(this.filter).connect(this.output);
    this.source.start();
  }

  /** `forceSkid` for locked wheels (handbrake) that squeal without sliding sideways. */
  update(slipAngle: number, forceSkid = false): void {
    const t = this.ctx.currentTime;
    let amount = THREE.MathUtils.clamp((slipAngle - SQUEAL_START) / (SQUEAL_FULL - SQUEAL_START), 0, 1);
    if (forceSkid) amount = Math.max(amount, 0.7);
    this.output.gain.setTargetAtTime(amount * 0.5, t, 0.06);
    this.filter.frequency.setTargetAtTime(1400 + amount * 500, t, 0.06);
  }

  dispose(): void {
    this.source.stop();
    this.output.disconnect();
  }
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
