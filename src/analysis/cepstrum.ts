// 倒谱：CPP（Cepstral Peak Prominence，嗓音松弛度/周期性的核心指标）
import { ifft } from './fft';

/**
 * 由 LTAS（dB 谱）计算倒谱，返回 [quefrency 轴(秒), 倒谱值(dB)]。
 * 做法：dB 谱镜像成对称双边谱后 IFFT，实部即为实倒谱。
 */
export function cepstrumFromLtassDb(
  ltasDb: Float32Array,
  sampleRate: number,
): { quefrency: Float32Array; cep: Float32Array } {
  const half = ltasDb.length;
  const n = half * 2;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < half; i++) re[i] = ltasDb[i];
  re[half] = ltasDb[half - 1]; // Nyquist
  for (let i = 1; i < half; i++) re[n - i] = ltasDb[i]; // 镜像，DC 不重复
  ifft(re, im);
  const cep = new Float32Array(half);
  const quefrency = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    cep[k] = re[k];
    quefrency[k] = k / sampleRate;
  }
  return { quefrency, cep };
}

/**
 * CPP：在 1/f0 ± 30% 的 quefrency 窗口内找倒谱峰，
 * 以 [1ms, 30ms] 区间的线性回归线为基线，返回峰突出度（dB）。
 * 谐波结构越规律（发声越松弛稳定），CPP 越高。
 */
export function cpp(
  ltasDb: Float32Array,
  sampleRate: number,
  meanF0: number,
): number {
  if (!Number.isFinite(meanF0) || meanF0 <= 0) return NaN;
  const { quefrency, cep } = cepstrumFromLtassDb(ltasDb, sampleRate);

  // 回归基线
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < quefrency.length; k++) {
    const q = quefrency[k];
    if (q < 0.001 || q > 0.03) continue;
    n++;
    sx += q;
    sy += cep[k];
    sxx += q * q;
    sxy += q * cep[k];
  }
  if (n < 8) return NaN;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;

  // 峰值搜索
  const q0 = 1 / meanF0;
  const lo = q0 * 0.7;
  const hi = Math.min(q0 * 1.3, 0.03);
  let peak = -Infinity;
  let peakQ = 0;
  for (let k = 0; k < quefrency.length; k++) {
    const q = quefrency[k];
    if (q >= lo && q <= hi && cep[k] > peak) {
      peak = cep[k];
      peakQ = q;
    }
  }
  if (peak === -Infinity) return NaN;
  const baseline = slope * peakQ + intercept;
  return peak - baseline;
}
