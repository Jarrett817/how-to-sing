// 分析引擎共享类型

/** 一段已解码的单声道 PCM */
export interface PcmData {
  samples: Float32Array;
  sampleRate: number;
}

export type Gender = 'male' | 'female';

export type Level = 'good' | 'fair' | 'poor';

/** 单个维度的评分结果 */
export interface DimensionScore {
  /** 0-100，-1 表示数据不足 */
  score: number;
  /** 原始声学指标（展示给用户，避免只给黑盒分数） */
  raw: Record<string, number>;
  level: Level;
  /** 面向用户的一句话建议 */
  hint: string;
}

export interface AnalysisReport {
  dimensions: {
    breath: DimensionScore;
    strain: DimensionScore;
    placement: DimensionScore;
    resonance: DimensionScore;
    lowBand: DimensionScore;
    midBand: DimensionScore;
    highBand: DimensionScore;
  };
  meta: {
    /** 录音信噪比 dB */
    snr: number;
    createdAt: string;
  };
}
