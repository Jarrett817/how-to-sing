// 评分阈值集中管理。
// ⚠️ 以下阈值来自文献经验值 + 启发式设定，未经大规模样本标定；
// 报告页应同时展示原始值，让分数可解释。后续用真实录音数据校准。
import type { Level } from './types';

/** 线性映射并截断到 0-100：x0→y0, x1→y1 */
export function linmap(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (!Number.isFinite(x)) return NaN;
  const t = (x - x0) / (x1 - x0);
  return Math.min(100, Math.max(0, y0 + t * (y1 - y0)));
}

export function levelOf(score: number): Level {
  return score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor';
}

/** 加权平均，自动跳过 NaN 项；全 NaN 返回 NaN */
export function weightedMean(parts: [value: number, weight: number][]): number {
  let sum = 0;
  let w = 0;
  for (const [v, weight] of parts) {
    if (Number.isFinite(v)) {
      sum += v * weight;
      w += weight;
    }
  }
  return w > 0 ? sum / w : NaN;
}

export const THRESHOLDS = {
  /** 气息：包络 CV% 越小越好；shimmer% 越小越好 */
  breath: {
    cvGood: 8,
    cvBad: 25,
    shimmerGood: 3,
    shimmerBad: 12,
    wCV: 0.6,
    wShimmer: 0.4,
  },
  /** 挤卡：CPP dB 越高越松弛；H1-H2 过低偏挤压；jitter% 越小越好 */
  strain: {
    cppGood: 12,
    cppBad: 4,
    h1h2Bad: -4,
    h1h2Good: 2,
    jitterGood: 0.8,
    jitterBad: 2.5,
    wCpp: 0.5,
    wH1h2: 0.3,
    wJitter: 0.2,
  },
  /** 位置：歌手共振峰能量占比 + 频谱质心 Hz */
  placement: {
    sfGood: 0.12,
    sfBad: 0.03,
    centroidGood: 2200,
    centroidBad: 700,
    wSF: 0.6,
    wCentroid: 0.4,
  },
  /** 腔体：F1/F2 峰突出度 dB */
  resonance: {
    promGood: 15,
    promBad: 4,
  },
  /** 频段能量占比参考区间（相对值，规避麦克风频响差异） */
  bands: {
    low: { min: 0.2, max: 0.4 },
    mid: { min: 0.45, max: 0.65 },
    high: { min: 0.08, max: 0.2 },
    /** 偏离区间到这个距离时记 0 分 */
    zeroAt: 0.15,
  },
} as const;

/** 频段得分：在参考区间内 100 分，偏离线性衰减 */
export function bandScore(ratio: number, range: { min: number; max: number }): number {
  const dist = ratio < range.min ? range.min - ratio : ratio > range.max ? ratio - range.max : 0;
  return linmap(dist, 0, 100, THRESHOLDS.bands.zeroAt, 0);
}
