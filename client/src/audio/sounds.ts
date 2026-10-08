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
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
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

  /** A panner at `position` that disconnects itself shortly after use. */
  private at(position: THREE.Vector3): AudioNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.rolloffFactor = 1.5;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    panner.connect(this.listener.getInput());
    setTimeout(() => panner.disconnect(), 1500);
    return panner;
  }
}
