// 自实现 radix-2 FFT / IFFT（纯函数，便于单测，不依赖 Web API）

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** 就地 FFT，re/im 长度必须为 2 的幂且相等 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const xr = re[i + j + half];
        const xi = im[i + j + half];
        const vr = xr * curR - xi * curI;
        const vi = xr * curI + xi * curR;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nxtR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nxtR;
      }
    }
  }
}

/** 就地 IFFT（共轭法） */
export function ifft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

const EPS = 1e-12;

/**
 * 实数帧的幅度谱（线性，单侧，长度 fftSize/2）。
 * 帧会被复制并零填充到 fftSize，不会改动入参。
 */
export function magnitudeSpectrum(frame: Float32Array, fftSize: number): Float32Array {
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  re.set(frame.subarray(0, Math.min(frame.length, fftSize)));
  fft(re, im);
  const half = fftSize >> 1;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mag;
}

/** 幅度谱转 dB（功率谱 10*log10(mag^2)） */
export function toDb(mag: Float32Array): Float32Array {
  const out = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    out[i] = 10 * Math.log10(mag[i] * mag[i] + EPS);
  }
  return out;
}

/** 单侧谱频率轴 */
export function freqAxis(fftSize: number, sampleRate: number): Float32Array {
  const half = fftSize >> 1;
  const freqs = new Float32Array(half);
  for (let i = 0; i < half; i++) freqs[i] = (i * sampleRate) / fftSize;
  return freqs;
}
