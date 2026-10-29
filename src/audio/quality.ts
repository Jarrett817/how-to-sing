// 录音质量前置检查：先判断"这次数据能不能用"，再谈分数。
// 检查三类问题：削波（爆音）、整体电平过低、背景噪声过大。
import type { PcmData } from '@/analysis/types';

export interface RecordingQuality {
  /** 满幅采样占比（|s| ≥ 0.98） */
  clippedRatio: number;
  /** 整体平均电平（线性 RMS） */
  meanRms: number;
  /** 估计信噪比 dB：较响帧（75 分位）对最安静帧（10 分位） */
  snr: number;
  /** 需要告诉用户的问题列表，空数组 = 质量可接受 */
  issues: string[];
}

export function assessRecording(pcm: PcmData): RecordingQuality {
  const { samples, sampleRate } = pcm;
  const issues: string[] = [];
  if (samples.length === 0) {
    return { clippedRatio: 0, meanRms: 0, snr: NaN, issues: ['录音为空，请重新录制'] };
  }

  let sumSq = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSq += s * s;
    if (Math.abs(s) >= 0.98) clipped++;
  }
  const meanRms = Math.sqrt(sumSq / samples.length);
  const clippedRatio = clipped / samples.length;

  // 分帧电平 → 用最安静的一成帧估计噪声底
  const frameSize = Math.round(sampleRate * 0.05);
  const hop = frameSize;
  const frameRms: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + frameSize; i++) sum += samples[i] * samples[i];
    frameRms.push(Math.sqrt(sum / frameSize));
  }
  let snr = NaN;
  if (frameRms.length >= 10) {
    const sorted = [...frameRms].sort((a, b) => a - b);
    const noise = sorted[Math.floor(sorted.length * 0.1)];
    const signal = sorted[Math.floor(sorted.length * 0.75)];
    if (noise > 0 && signal > 0) snr = 20 * Math.log10(signal / noise);
  }

  if (clippedRatio > 0.002) {
    issues.push(
      `约 ${(clippedRatio * 100).toFixed(1)}% 的采样达到满幅（削波/爆音），频谱与抖动类指标会失真。建议离麦克风远一点，或在系统里调低输入音量后重录。`,
    );
  }
  if (meanRms < 0.004) {
    issues.push(
      '整体音量偏小，有效信号不足。建议麦克风离嘴 15–30cm、正常音量发声，或调高系统输入音量后重录。',
    );
  }
  if (Number.isFinite(snr) && snr < 10) {
    issues.push(
      `背景噪声或伴奏偏大（估计信噪比约 ${snr.toFixed(0)} dB），音色类指标可能被污染。建议换安静环境、清唱，或让麦克风更靠近嘴。`,
    );
  }

  return { clippedRatio, meanRms, snr, issues };
}
