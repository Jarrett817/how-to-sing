// 用合成信号验证分析引擎核心指标（不依赖真实录音）
import { describe, expect, it } from 'vitest';
import { fft, ifft, magnitudeSpectrum, nextPow2 } from '../fft';
import { trackPitch, jitter } from '../pitch';
import { envelopeCV, rmsEnvelope } from '../envelope';
import { bandEnergies, ltas, harmonicAmplitudes } from '../spectrum';
import { analyzeTask, ANALYSIS_RATE } from '../analyze';

const RATE = ANALYSIS_RATE;

/** 合成谐波叠加信号：f0 基频，harmonics 为各次谐波幅度（从 H1 起） */
function synth(f0: number, harmonics: number[], durationSec: number): Float32Array {
  const n = Math.floor(durationSec * RATE);
  const out = new Float32Array(n);
  for (let h = 0; h < harmonics.length; h++) {
    const amp = harmonics[h];
    if (amp === 0) continue;
    const f = f0 * (h + 1);
    for (let i = 0; i < n; i++) {
      out[i] += amp * Math.sin((2 * Math.PI * f * i) / RATE);
    }
  }
  // 归一化到 0.8 峰值
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.8;
  return out;
}

describe('fft', () => {
  it('冲击脉冲的频谱是平坦的', () => {
    const n = 256;
    const frame = new Float32Array(n);
    frame[0] = 1;
    const mag = magnitudeSpectrum(frame, n);
    for (let i = 0; i < mag.length; i++) {
      expect(Math.abs(mag[i] - 1)).toBeLessThan(1e-4);
    }
  });

  it('ifft 是 fft 的逆变换', () => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.3) * 0.5;
    const original = Float32Array.from(re);
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(re[i] - original[i])).toBeLessThan(1e-4);
      expect(Math.abs(im[i])).toBeLessThan(1e-4);
    }
  });

  it('nextPow2', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(1000)).toBe(1024);
    expect(nextPow2(2048)).toBe(2048);
  });
});

describe('pitch', () => {
  it('220Hz 谐波信号应检测到 ≈220Hz 基频', () => {
    const signal = synth(220, [1, 0.6, 0.4, 0.2], 2);
    const frames = trackPitch(signal, RATE);
    const voiced = frames.filter((f) => f.f0 != null);
    expect(voiced.length).toBeGreaterThan(frames.length * 0.7);
    const median = voiced.map((f) => f.f0 as number).sort((a, b) => a - b)[
      Math.floor(voiced.length / 2)
    ];
    expect(Math.abs(median - 220)).toBeLessThan(3);
  });

  it('恒定基频的 jitter 应接近 0', () => {
    const signal = synth(200, [1, 0.5, 0.3], 2);
    const frames = trackPitch(signal, RATE);
    const j = jitter(frames);
    expect(Number.isFinite(j)).toBe(true);
    expect(j).toBeLessThan(0.5);
  });
});

describe('envelope', () => {
  it('恒定幅度正弦的包络 CV 应接近 0', () => {
    const signal = synth(220, [1], 3);
    const env = rmsEnvelope(signal, RATE);
    const cv = envelopeCV(env);
    expect(Number.isFinite(cv)).toBe(true);
    expect(cv).toBeLessThan(1.5);
  });
});

describe('spectrum', () => {
  it('频段能量占比总和为 1', () => {
    const signal = synth(200, [1, 0.7, 0.5, 0.3, 0.2, 0.1], 1.5);
    const frames: Float32Array[] = [];
    for (let start = 0; start + 2048 <= signal.length; start += 512) {
      frames.push(signal.subarray(start, start + 2048));
    }
    const spec = ltas(frames, 4096, RATE);
    const bands = bandEnergies(spec.ltasDb, spec.freqs);
    expect(bands.low + bands.mid + bands.high).toBeCloseTo(1, 5);
  });

  it('H1=1.0 / H2=0.5 时 H1-H2 ≈ +6dB', () => {
    const signal = synth(200, [1, 0.5, 0.25, 0.12], 2);
    const frames: Float32Array[] = [];
    for (let start = 0; start + 2048 <= signal.length; start += 512) {
      frames.push(signal.subarray(start, start + 2048));
    }
    const spec = ltas(frames, 4096, RATE);
    const harmonics = harmonicAmplitudes(spec.ltasDb, spec.freqs, 200);
    expect(Number.isFinite(harmonics[0])).toBe(true);
    expect(Number.isFinite(harmonics[1])).toBe(true);
    const h1h2 = harmonics[0] - harmonics[1];
    expect(Math.abs(h1h2 - 6.02)).toBeLessThan(2);
  });
});

describe('analyzeTask 端到端（合成信号）', () => {
  it('稳定长音：气息指标应为高分区间', () => {
    const signal = synth(220, [1, 0.6, 0.4, 0.3, 0.2, 0.15], 4);
    const result = analyzeTask({ samples: signal, sampleRate: RATE }, 'sustain');
    expect(result.voicedRatio).toBeGreaterThan(0.7);
    expect(Math.abs(result.medianF0 - 220)).toBeLessThan(3);
    expect(result.envelopeCV).toBeLessThan(3);
    expect(result.jitter).toBeLessThan(0.5);
    expect(Number.isFinite(result.cpp)).toBe(true);
    expect(result.bands.low + result.bands.mid + result.bands.high).toBeCloseTo(1, 2);
  });
});
