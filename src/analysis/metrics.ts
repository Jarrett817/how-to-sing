// 七个维度的评分：TaskResult → DimensionScore
import type { DimensionScore, TaskResult } from './types';
import { THRESHOLDS, bandScore, h1h2Range, levelOf, linmap, weightedMean } from './thresholds';

function insufficient(hint: string, raw: Record<string, number> = {}): DimensionScore {
  return { score: -1, raw, level: 'poor', hint };
}

/** 气息稳定度：包络 CV + shimmer（主要看长音任务） */
export function breathScore(t: TaskResult | undefined): DimensionScore {
  if (!t || t.voicedRatio < 0.4) return insufficient('有效发声太短，无法判断气息，请完整唱满长音');
  const T = THRESHOLDS.breath;
  const cvScore = linmap(t.envelopeCV, T.cvGood, 100, T.cvBad, 0);
  const shimmerScore = linmap(t.shimmer, T.shimmerGood, 100, T.shimmerBad, 0);
  const score = weightedMean([
    [cvScore, T.wCV],
    [shimmerScore, T.wShimmer],
  ]);
  if (!Number.isFinite(score)) return insufficient('数据不足，无法计算气息指标');
  const hint =
    score >= 75
      ? '长音响度稳定，气息支撑良好'
      : score >= 50
        ? '长音有波动，注意保持匀速呼气，避免忽强忽弱'
        : '长音明显不稳，建议先做无声"嘶"音练习延长呼气时间';
  return {
    score: Math.round(score),
    raw: { envelopeCV: t.envelopeCV, shimmer: t.shimmer },
    level: levelOf(score),
    hint,
  };
}

/** 挤卡/紧张度：CPP + H1-H2 + jitter */
export function strainScore(t: TaskResult | undefined): DimensionScore {
  if (!t || t.voicedRatio < 0.4) return insufficient('有效发声太短，无法判断紧张度');
  const T = THRESHOLDS.strain;
  const cppScore = linmap(t.cpp, T.cppBad, 0, T.cppGood, 100);
  // H1-H2 按本次发声的中位基频选参考区间，避免高音/女声被误判为挤卡
  const hRange = h1h2Range(t.medianF0);
  const h1h2Score = linmap(t.h1h2, hRange.bad, 0, hRange.good, 100);
  const jitterScore = linmap(t.jitter, T.jitterGood, 100, T.jitterBad, 0);
  const score = weightedMean([
    [cppScore, T.wCpp],
    [h1h2Score, T.wH1h2],
    [jitterScore, T.wJitter],
  ]);
  if (!Number.isFinite(score)) return insufficient('数据不足，无法计算紧张度指标');
  const hint =
    score >= 75
      ? '声带振动规律，没有明显挤压'
      : score >= 50
        ? '有轻微紧张迹象，发声时留意喉部放松'
        : '声带偏挤卡，避免扯嗓子，用气泡音和弱延音放松起音';
  return {
    score: Math.round(score),
    raw: { cpp: t.cpp, h1h2: t.h1h2, jitter: t.jitter },
    level: levelOf(score),
    hint,
  };
}

/** 位置：歌手共振峰占比 + 频谱质心（综合多个任务） */
export function placementScore(tasks: TaskResult[]): DimensionScore {
  const valid = tasks.filter((t) => Number.isFinite(t.singerFormantRatio));
  if (valid.length === 0) return insufficient('数据不足，无法判断声音位置');
  const sf = valid.reduce((a, t) => a + t.singerFormantRatio, 0) / valid.length;
  const centroid =
    valid.reduce((a, t) => a + (Number.isFinite(t.centroid) ? t.centroid : 0), 0) / valid.length;
  const T = THRESHOLDS.placement;
  const sfScore = linmap(sf, T.sfBad, 0, T.sfGood, 100);
  const centroidScore = linmap(centroid, T.centroidBad, 0, T.centroidGood, 100);
  const score = weightedMean([
    [sfScore, T.wSF],
    [centroidScore, T.wCentroid],
  ]);
  const hint =
    score >= 75
      ? '高频泛音充足，声音位置靠前、有穿透力'
      : score >= 50
        ? '声音位置中等，可以尝试更多面罩共鸣的感觉'
        : '声音偏闷偏后，练习哼鸣找鼻梁振感，把声音"放前面"';
  return {
    score: Math.round(score),
    raw: { singerFormantRatio: sf, centroid },
    level: levelOf(score),
    hint,
  };
}

/** 腔体：F1/F2 共振峰突出度 */
export function resonanceScore(t: TaskResult | undefined): DimensionScore {
  if (!t || !Number.isFinite(t.formants.f1Prom)) {
    return insufficient('数据不足，无法估计共振腔体');
  }
  const T = THRESHOLDS.resonance;
  const prom = (t.formants.f1Prom + (Number.isFinite(t.formants.f2Prom) ? t.formants.f2Prom : t.formants.f1Prom)) / 2;
  const score = linmap(prom, T.promBad, 0, T.promGood, 100);
  const hint =
    score >= 75
      ? '共振峰清晰，口腔/咽腔成型良好'
      : score >= 50
        ? '腔体基本成型，咬字时保持口腔开度'
        : '共鸣腔体不够充分，练习打哈欠式打开喉咙再发声';
  return {
    score: Math.round(score),
    raw: {
      f1: t.formants.f1,
      f2: t.formants.f2,
      f1Prom: t.formants.f1Prom,
      f2Prom: t.formants.f2Prom,
    },
    level: levelOf(score),
    hint,
  };
}

/** 频段表现：低/中/高频能量占比是否在参考区间（用爬音阶任务，覆盖更广音域） */
export function bandScores(
  t: TaskResult | undefined,
): { low: DimensionScore; mid: DimensionScore; high: DimensionScore } {
  const empty = insufficient('数据不足，无法计算频段分布');
  if (!t || !Number.isFinite(t.bands.low)) return { low: empty, mid: empty, high: empty };
  const B = THRESHOLDS.bands;
  const make = (
    ratio: number,
    range: { min: number; max: number },
    name: string,
    lowHint: string,
    highHint: string,
  ): DimensionScore => {
    const score = bandScore(ratio, range);
    const hint =
      ratio < range.min ? lowHint : ratio > range.max ? highHint : `${name}能量分布正常`;
    return { score: Math.round(score), raw: { ratio }, level: levelOf(score), hint };
  };
  return {
    low: make(
      t.bands.low,
      B.low,
      '低频',
      '低频偏少，声音可能偏薄，检查是否过度挤高位置',
      '低频偏重，声音可能偏暗偏压喉',
    ),
    mid: make(
      t.bands.mid,
      B.mid,
      '中频',
      '中频偏少，人声的"芯"不够，注意声带闭合',
      '中频偏多属正常范围（人声主体能量所在）',
    ),
    high: make(
      t.bands.high,
      B.high,
      '高频',
      '高频泛音不足，声音偏闷，尝试更靠前的咬字位置',
      '高频偏多，可能偏尖亮，留意是否挤压',
    ),
  };
}
