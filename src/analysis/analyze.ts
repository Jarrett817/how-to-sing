// 单任务特征提取：PCM → TaskResult
import type { PcmData, TaskKind, TaskResult } from './types';
import { downsample, frameSignal, preEmphasis, rms } from './frames';
import { trackPitch, jitter as calcJitter, voicedF0 } from './pitch';
import { envelopeCV, rmsEnvelope, shimmer as calcShimmer } from './envelope';
import {
  ltas,
  bandEnergies,
  spectralCentroid,
  singerFormantRatio,
  harmonicAmplitudes,
} from './spectrum';
import { cpp as calcCpp } from './cepstrum';
import { autocorrelate, levinson, lpcSpectrum, pickFormants } from './lpc';
import { freqAxis } from './fft';

/** 分析内部统一采样率：人声有效信息 < 8kHz，22.05k 足够且 FFT 更快 */
export const ANALYSIS_RATE = 22050;
const FRAME_SIZE = 2048;
const HOP_SIZE = 512;
const FFT_SIZE = 4096;
const LPC_ORDER = 24;

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function analyzeTask(pcm: PcmData, kind: TaskKind): TaskResult {
  const samples =
    pcm.sampleRate === ANALYSIS_RATE
      ? pcm.samples
      : downsample(pcm.samples, pcm.sampleRate, ANALYSIS_RATE);
  const rate = pcm.sampleRate === ANALYSIS_RATE ? pcm.sampleRate : ANALYSIS_RATE;
  const duration = samples.length / rate;

  // 基频跟踪 + 逐帧 RMS（与基频帧对齐）
  const pitchFrames = trackPitch(samples, rate, FRAME_SIZE, HOP_SIZE);
  const voiced = pitchFrames.map((f) => f.f0 != null);
  const frameRms: number[] = [];
  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    frameRms.push(rms(samples.subarray(start, start + FRAME_SIZE)));
  }
  const f0s = voicedF0(pitchFrames);
  const medianF0 = median(f0s);
  const voicedRatio = pitchFrames.length > 0 ? f0s.length / pitchFrames.length : 0;

  // 浊音帧收集（原始 & 预加重）
  const rawVoiced: Float32Array[] = [];
  const preVoiced: Float32Array[] = [];
  const allFrames = frameSignal(samples, FRAME_SIZE, HOP_SIZE);
  for (let i = 0; i < Math.min(allFrames.length, voiced.length); i++) {
    if (voiced[i]) {
      rawVoiced.push(allFrames[i]);
      preVoiced.push(preEmphasis(allFrames[i]));
    }
  }

  // 频谱特征
  const plainSpec = rawVoiced.length > 0 ? ltas(rawVoiced, FFT_SIZE, rate) : null;
  const preSpec = preVoiced.length > 0 ? ltas(preVoiced, FFT_SIZE, rate) : null;

  const harmonics = plainSpec ? harmonicAmplitudes(plainSpec.ltasDb, plainSpec.freqs, medianF0) : [];
  const h1h2 =
    harmonics.length >= 2 && Number.isFinite(harmonics[0]) && Number.isFinite(harmonics[1])
      ? harmonics[0] - harmonics[1]
      : NaN;

  const bands = preSpec
    ? bandEnergies(preSpec.ltasDb, preSpec.freqs)
    : { low: NaN, mid: NaN, high: NaN };
  const centroid = preSpec ? spectralCentroid(preSpec.ltasDb, preSpec.freqs) : NaN;
  const sfRatio = preSpec ? singerFormantRatio(preSpec.ltasDb, preSpec.freqs) : NaN;
  const cpp = preSpec ? calcCpp(preSpec.ltasDb, rate, medianF0) : NaN;

  // LPC 共振峰：平均自相关 → Levinson → 频响 → 峰值拾取
  let formants = { f1: NaN, f2: NaN, f1Prom: NaN, f2Prom: NaN };
  if (preVoiced.length > 0) {
    const acc = new Float32Array(LPC_ORDER + 1);
    for (const frame of preVoiced) {
      const r = autocorrelate(frame, LPC_ORDER);
      for (let k = 0; k <= LPC_ORDER; k++) acc[k] += r[k];
    }
    for (let k = 0; k <= LPC_ORDER; k++) acc[k] /= preVoiced.length;
    const { a, error } = levinson(acc, LPC_ORDER);
    const spec = lpcSpectrum(a, error, FFT_SIZE);
    formants = pickFormants(spec, freqAxis(FFT_SIZE, rate));
  }

  // 包络
  const env = rmsEnvelope(samples, rate, 1024, 512);

  return {
    kind,
    duration,
    voicedRatio,
    medianF0,
    f0Range: f0s.length > 0 ? [Math.min(...f0s), Math.max(...f0s)] : [NaN, NaN],
    meanRms: frameRms.length > 0 ? frameRms.reduce((a, b) => a + b, 0) / frameRms.length : 0,
    envelope: { times: env.times, rms: env.rms },
    envelopeCV: envelopeCV(env),
    cpp,
    h1h2,
    jitter: calcJitter(pitchFrames),
    shimmer: calcShimmer(frameRms, voiced),
    centroid,
    singerFormantRatio: sfRatio,
    bands,
    formants,
  };
}
