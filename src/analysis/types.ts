// 分析引擎共享类型

/** 一段已解码的单声道 PCM */
export interface PcmData {
  samples: Float32Array;
  sampleRate: number;
}

/** 录音类型：长音 / 滑音 / 爬音阶 / 唱歌片段 */
export type TaskKind = 'sustain' | 'glide' | 'scale' | 'song';

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

/** 单个练声任务的分析结果 */
export interface TaskResult {
  kind: TaskKind;
  /** 时长（秒） */
  duration: number;
  /** 浊音占比 0-1 */
  voicedRatio: number;
  /** 中位基频 Hz（无声段忽略） */
  medianF0: number;
  /** 基频范围 Hz */
  f0Range: [number, number];
  /** 平均 RMS 电平（线性） */
  meanRms: number;
  /** 响度包络（用于画图）：时间戳 + 线性 rms */
  envelope: { times: number[]; rms: number[] };
  /** 包络变异系数（越小越稳） */
  envelopeCV: number;
  /** 平均 CPP（倒谱峰突出度 dB，越高越松弛稳定） */
  cpp: number;
  /** H1-H2（dB，越低越偏挤压） */
  h1h2: number;
  /** jitter %（相邻周期基频差，仅高置信段） */
  jitter: number;
  /** shimmer %（相邻周期振幅差） */
  shimmer: number;
  /** 频谱质心 Hz */
  centroid: number;
  /** 歌手共振峰能量占比（2.5-3.5kHz） */
  singerFormantRatio: number;
  /** 频段能量相对占比 */
  bands: { low: number; mid: number; high: number };
  /** F1/F2 频率与突出度 */
  formants: { f1: number; f2: number; f1Prom: number; f2Prom: number };
}

export interface AnalysisReport {
  tasks: TaskResult[];
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
