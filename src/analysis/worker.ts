// 分析 Worker：把几十秒音频的繁重计算移出主线程，避免手机端 UI 卡死
import { analyzeSongReport } from './song';
import { analyzeTasks } from './report';
import type { TaskKind } from './types';

export interface SongJob {
  id: number;
  type: 'song';
  samples: Float32Array;
  sampleRate: number;
}
export interface TasksJob {
  id: number;
  type: 'tasks';
  tasks: { kind: TaskKind; samples: Float32Array; sampleRate: number }[];
  ambientRms: number;
}
export type AnalysisJob = SongJob | TasksJob;

self.onmessage = (e: MessageEvent<AnalysisJob>) => {
  const job = e.data;
  try {
    const report =
      job.type === 'song'
        ? analyzeSongReport({ samples: job.samples, sampleRate: job.sampleRate })
        : analyzeTasks(job.tasks, job.ambientRms);
    self.postMessage({ id: job.id, report });
  } catch (err) {
    self.postMessage({ id: job.id, error: err instanceof Error ? err.message : '分析失败' });
  }
};
