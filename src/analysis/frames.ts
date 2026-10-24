// 分帧、加窗、预加重、重采样（均为纯函数）

/** 预加重：y[n] = x[n] - coeff * x[n-1]，提升高频，利于共振峰估计 */
export function preEmphasis(samples: Float32Array, coeff = 0.97): Float32Array {
  const out = new Float32Array(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = samples[i] - coeff * samples[i - 1];
  }
  return out;
}

/** Hann 窗系数表 */
export function hannWindow(length: number): Float32Array {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return w;
}

/**
 * 分帧：返回 frameSize 长的帧数组，步长 hopSize。
 * 不足一帧的尾部丢弃。
 */
export function frameSignal(
  samples: Float32Array,
  frameSize: number,
  hopSize: number,
): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    frames.push(samples.subarray(start, start + frameSize));
  }
  return frames;
}

/** 应用窗函数（原地） */
export function applyWindow(frame: Float32Array, window: Float32Array): void {
  for (let i = 0; i < frame.length; i++) frame[i] *= window[i];
}

/**
 * 线性插值重采样到目标采样率。
 * 麦克风通常给 44.1/48k，分析用 22.05k 足够（人声 < 8kHz）。
 */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx];
    const b = idx + 1 < samples.length ? samples[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 均方根 */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}
