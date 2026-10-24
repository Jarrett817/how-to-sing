// 基频跟踪：封装 pitchy（YIN），输出逐帧 f0 + 置信度
import { PitchDetector } from 'pitchy';

export interface PitchFrame {
  /** 帧中心时间（秒） */
  time: number;
  /** 基频 Hz；判定为无声时 null */
  f0: number | null;
  /** pitchy clarity 0-1 */
  clarity: number;
}

export const MIN_F0 = 50;
export const MAX_F0 = 1000;
export const CLARITY_THRESHOLD = 0.85;

/**
 * 逐帧基频跟踪。
 * 注意：pitchy 的 findPitch 需要对应 bufferSize 的 Float32Array。
 * clarityThreshold：唱歌场景（有伴奏）可适当放宽，由调用方决定。
 */
export function trackPitch(
  samples: Float32Array,
  sampleRate: number,
  frameSize = 2048,
  hopSize = 512,
  clarityThreshold = CLARITY_THRESHOLD,
): PitchFrame[] {
  const detector = PitchDetector.forFloat32Array(frameSize);
  const frames: PitchFrame[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const frame = samples.subarray(start, start + frameSize);
    const [f0, clarity] = detector.findPitch(frame, sampleRate);
    const voiced = clarity >= clarityThreshold && f0 >= MIN_F0 && f0 <= MAX_F0;
    frames.push({
      time: (start + frameSize / 2) / sampleRate,
      f0: voiced ? f0 : null,
      clarity,
    });
  }
  return frames;
}

/**
 * jitter：相邻浊音帧基频差的平均相对值（%）。
 * 只统计 |Δf0| < 10% 的连续对（排除八度跳变等跟踪错误）。
 * 数据不足（< 10 对）返回 NaN。
 */
export function jitter(frames: PitchFrame[]): number {
  let sum = 0;
  let count = 0;
  let f0Sum = 0;
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].f0;
    const cur = frames[i].f0;
    if (prev == null || cur == null) continue;
    const diff = Math.abs(cur - prev);
    if (diff / prev > 0.1) continue; // 跟踪错误，跳过
    sum += diff;
    f0Sum += (prev + cur) / 2;
    count++;
  }
  if (count < 10) return NaN;
  return (sum / (f0Sum / count)) * 100;
}

/** 浊音帧的 f0 数组 */
export function voicedF0(frames: PitchFrame[]): number[] {
  return frames.filter((f) => f.f0 != null).map((f) => f.f0 as number);
}
