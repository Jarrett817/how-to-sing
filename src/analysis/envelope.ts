// 响度包络与稳定性（气息维度的核心）
import { rms } from './frames';

export interface Envelope {
  times: number[];
  rms: number[];
}

/** 逐帧 RMS 包络 */
export function rmsEnvelope(
  samples: Float32Array,
  sampleRate: number,
  frameSize = 1024,
  hopSize = 512,
): Envelope {
  const times: number[] = [];
  const values: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    times.push((start + frameSize / 2) / sampleRate);
    values.push(rms(samples.subarray(start, start + frameSize)));
  }
  return { times, rms: values };
}

/**
 * 包络变异系数 CV（%）：
 * 取包络中段（20%-80%）中高于峰值 30% 的部分，排除起音/收音。
 * 越小说明长音越稳。
 */
export function envelopeCV(env: Envelope): number {
  if (env.rms.length < 8) return NaN;
  const peak = Math.max(...env.rms);
  if (peak <= 0) return NaN;
  const from = Math.floor(env.rms.length * 0.2);
  const to = Math.ceil(env.rms.length * 0.8);
  const mid = env.rms.slice(from, to).filter((v) => v >= peak * 0.3);
  if (mid.length < 6) return NaN;
  const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
  if (mean <= 0) return NaN;
  const variance = mid.reduce((a, b) => a + (b - mean) ** 2, 0) / mid.length;
  return (Math.sqrt(variance) / mean) * 100;
}

/**
 * shimmer：相邻浊音帧 RMS 差的平均相对值（%）。
 * frameRms 与基频帧一一对应，voiced 标记哪些帧有效。
 */
export function shimmer(frameRms: number[], voiced: boolean[]): number {
  let sum = 0;
  let ampSum = 0;
  let count = 0;
  for (let i = 1; i < frameRms.length; i++) {
    if (!voiced[i] || !voiced[i - 1]) continue;
    sum += Math.abs(frameRms[i] - frameRms[i - 1]);
    ampSum += (frameRms[i] + frameRms[i - 1]) / 2;
    count++;
  }
  if (count < 10 || ampSum <= 0) return NaN;
  return (sum / (ampSum / count)) * 100;
}
