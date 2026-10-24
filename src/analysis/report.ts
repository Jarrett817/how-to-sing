// 报告编排：多任务 → AnalysisReport
import type { AnalysisReport, TaskKind, TaskResult } from './types';
import { analyzeTask, ANALYSIS_RATE } from './analyze';
import { breathScore, strainScore, placementScore, resonanceScore, bandScores } from './metrics';

export interface TaskInput {
  kind: TaskKind;
  samples: Float32Array;
  sampleRate: number;
}

function findTask(results: TaskResult[], kind: TaskKind): TaskResult | undefined {
  return results.find((t) => t.kind === kind);
}

/**
 * 主入口：对全部练声任务做分析并汇总成报告。
 * ambientRms 为录音前测得的环境噪声 RMS（线性），用于估计信噪比。
 */
export function analyzeTasks(tasks: TaskInput[], ambientRms: number): AnalysisReport {
  const results = tasks.map((t) => analyzeTask({ samples: t.samples, sampleRate: t.sampleRate }, t.kind));

  const sustain = findTask(results, 'sustain');
  const scale = findTask(results, 'scale') ?? sustain;

  // 信噪比：长音平均电平 / 环境噪声电平
  const signal = sustain?.meanRms ?? 0;
  const snr = signal > 0 && ambientRms > 0 ? 20 * Math.log10(signal / ambientRms) : NaN;

  const bands = bandScores(scale);

  return {
    tasks: results,
    dimensions: {
      breath: breathScore(sustain),
      strain: strainScore(sustain),
      placement: placementScore(results),
      resonance: resonanceScore(sustain),
      lowBand: bands.low,
      midBand: bands.mid,
      highBand: bands.high,
    },
    meta: {
      snr,
      createdAt: new Date().toISOString(),
    },
  };
}

export { ANALYSIS_RATE };
