// 频谱特征：LTAS、频段能量、频谱质心、歌手共振峰、谐波幅度
import { applyWindow, hannWindow, preEmphasis } from './frames';
import { freqAxis, magnitudeSpectrum, toDb } from './fft';

/** 频段边界（Hz） */
export const BAND_LOW: [number, number] = [80, 500];
export const BAND_MID: [number, number] = [500, 2000];
export const BAND_HIGH: [number, number] = [2000, 8000];
/** 歌手共振峰区间（Hz） */
export const SINGER_FORMANT: [number, number] = [2500, 3500];

export interface SpectrumResult {
  /** LTAS 平均功率谱（dB，单侧） */
  ltasDb: Float32Array;
  freqs: Float32Array;
}

/**
 * 长时平均谱：对所有浊音帧做加窗 FFT 后按功率平均。
 * frames 应已预加重（共振峰/质心用）；谐波分析请用未预加重的帧。
 */
export function ltas(
  frames: Float32Array[],
  fftSize: number,
  sampleRate: number,
): SpectrumResult {
  const half = fftSize >> 1;
  const acc = new Float32Array(half);
  const win = hannWindow(Math.min(frames[0]?.length ?? fftSize, fftSize));
  let used = 0;
  for (const frame of frames) {
    const len = Math.min(frame.length, fftSize);
    const buf = new Float32Array(len);
    buf.set(frame.subarray(0, len));
    applyWindow(buf, win);
    const mag = magnitudeSpectrum(buf, fftSize);
    for (let i = 0; i < half; i++) acc[i] += mag[i] * mag[i];
    used++;
  }
  if (used === 0) {
    return { ltasDb: new Float32Array(half), freqs: freqAxis(fftSize, sampleRate) };
  }
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(acc[i] / used);
  return { ltasDb: toDb(mag), freqs: freqAxis(fftSize, sampleRate) };
}

/** 某频段内的线性功率和（dB 谱转回线性再累加） */
function bandPower(ltasDb: Float32Array, freqs: Float32Array, [lo, hi]: [number, number]): number {
  let sum = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= lo && freqs[i] < hi) sum += 10 ** (ltasDb[i] / 10);
  }
  return sum;
}

/** 低/中/高频段相对占比（0-1，和为 1）。用比值规避麦克风频响差异。 */
export function bandEnergies(
  ltasDb: Float32Array,
  freqs: Float32Array,
): { low: number; mid: number; high: number } {
  const low = bandPower(ltasDb, freqs, BAND_LOW);
  const mid = bandPower(ltasDb, freqs, BAND_MID);
  const high = bandPower(ltasDb, freqs, BAND_HIGH);
  const total = low + mid + high;
  if (total <= 0) return { low: 0, mid: 0, high: 0 };
  return { low: low / total, mid: mid / total, high: high / total };
}

/** 频谱质心（Hz）：能量重心，越靠前越"暗"，越靠后越"亮/集中" */
export function spectralCentroid(ltasDb: Float32Array, freqs: Float32Array): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < freqs.length; i++) {
    const p = 10 ** (ltasDb[i] / 10);
    weighted += freqs[i] * p;
    total += p;
  }
  return total > 0 ? weighted / total : 0;
}

/** 歌手共振峰能量占全频段的比例（0-1）：2.5-3.5kHz 是"位置靠前"的标志性能量 */
export function singerFormantRatio(ltasDb: Float32Array, freqs: Float32Array): number {
  const sf = bandPower(ltasDb, freqs, SINGER_FORMANT);
  let total = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= 80) total += 10 ** (ltasDb[i] / 10);
  }
  return total > 0 ? sf / total : 0;
}

/**
 * 前 maxHarmonics 个谐波的幅度（dB）。
 * 在 k*f0 附近 ±tolerance% 范围内找局部峰值。返回数组 [H1, H2, ...]，找不到为 NaN。
 * 注意：应使用未预加重的谱，否则 H1-H2 会被系统性抬高。
 */
export function harmonicAmplitudes(
  ltasDb: Float32Array,
  freqs: Float32Array,
  f0: number,
  maxHarmonics = 4,
  tolerance = 0.06,
): number[] {
  const out: number[] = [];
  for (let k = 1; k <= maxHarmonics; k++) {
    const target = f0 * k;
    let best = -Infinity;
    for (let i = 1; i < freqs.length - 1; i++) {
      if (Math.abs(freqs[i] - target) <= target * tolerance) {
        if (ltasDb[i] > best && ltasDb[i] >= ltasDb[i - 1] && ltasDb[i] >= ltasDb[i + 1]) {
          best = ltasDb[i];
        }
      }
    }
    out.push(best === -Infinity ? NaN : best);
  }
  return out;
}

export { preEmphasis };
