// LPC 共振峰估计：自相关 + Levinson-Durbin + 频响峰值拾取
import { fft } from './fft';

/** 归一化自相关 r[0..order] */
export function autocorrelate(frame: Float32Array, order: number): Float32Array {
  const r = new Float32Array(order + 1);
  const n = frame.length;
  for (let k = 0; k <= order; k++) {
    let sum = 0;
    for (let i = 0; i + k < n; i++) sum += frame[i] * frame[i + k];
    r[k] = sum / n;
  }
  return r;
}

/** Levinson-Durbin 递推，返回预测系数 a[0..order]（a[0]=1）与预测误差 */
export function levinson(r: Float32Array, order: number): { a: Float32Array; error: number } {
  const a = new Float32Array(order + 1);
  const prev = new Float32Array(order + 1);
  a[0] = 1;
  prev[0] = 1;
  let e = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += prev[j] * r[i - j];
    const k = e > 0 ? -acc / e : 0;
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    e *= 1 - k * k;
    prev.set(a);
    if (e <= 0) break;
  }
  return { a, error: Math.max(e, 1e-12) };
}

/**
 * LPC 平滑谱（dB，单侧）。
 * fftSize 必须 ≥ a.length 且为 2 的幂（由调用方保证）。
 */
export function lpcSpectrum(a: Float32Array, error: number, fftSize: number): Float32Array {
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  re.set(a);
  fft(re, im);
  const gain = Math.sqrt(error);
  const half = fftSize >> 1;
  const out = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    out[i] = 20 * Math.log10(gain / Math.max(mag, 1e-9));
  }
  return out;
}

export interface Formants {
  f1: number;
  f2: number;
  /** 峰相对两侧谷底的突出度 dB（共振峰是否"成腔"的标志） */
  f1Prom: number;
  f2Prom: number;
}

/**
 * 在 LPC 平滑谱上拾取 F1/F2。
 * F1 搜索 [250, 1000] Hz，F2 搜索 [max(900, f1+300), 3000] Hz，
 * 各取该区间内最强局部峰。找不到则对应字段为 NaN。
 */
export function pickFormants(specDb: Float32Array, freqs: Float32Array): Formants {
  const pick = (lo: number, hi: number): { f: number; prom: number } => {
    let bestDb = -Infinity;
    let bestI = -1;
    for (let i = 2; i < freqs.length - 2; i++) {
      if (freqs[i] < lo || freqs[i] > hi) continue;
      if (
        specDb[i] > bestDb &&
        specDb[i] >= specDb[i - 1] &&
        specDb[i] >= specDb[i + 1] &&
        specDb[i] >= specDb[i - 2] &&
        specDb[i] >= specDb[i + 2]
      ) {
        bestDb = specDb[i];
        bestI = i;
      }
    }
    if (bestI < 0) return { f: NaN, prom: NaN };
    // 突出度：峰值 - 峰两侧 [±150Hz, ±300Hz] 区间的均值
    const f = freqs[bestI];
    let sideSum = 0;
    let sideN = 0;
    for (let i = 0; i < freqs.length; i++) {
      const d = Math.abs(freqs[i] - f);
      if (d >= 150 && d <= 300) {
        sideSum += specDb[i];
        sideN++;
      }
    }
    const prom = sideN > 0 ? bestDb - sideSum / sideN : NaN;
    return { f, prom };
  };

  const f1 = pick(250, 1000);
  const f2 = pick(Math.max(900, (f1.f || 0) + 300), 3000);
  return { f1: f1.f, f2: f2.f, f1Prom: f1.prom, f2Prom: f2.prom };
}
