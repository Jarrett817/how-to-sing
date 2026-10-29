// 分析调用入口：优先 Web Worker（不卡 UI），Worker 不可用时退回主线程同步计算
import { analyzeSongReport, type SongReport } from './song';
import { analyzeTasks, type TaskInput } from './report';
import type { AnalysisReport, PcmData } from './types';
import type { SongJob, TasksJob } from './worker';

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; report?: unknown; error?: string }>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(e.data.report);
    };
    worker.onerror = () => {
      // Worker 运行失败：拒绝所有待处理任务并永久回退到主线程
      for (const job of pending.values()) job.reject(new Error('分析线程失败'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function run<T>(job: Omit<SongJob, 'id'> | Omit<TasksJob, 'id'>, fallback: () => T): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(fallback);
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...job, id });
  });
}

export function runSongAnalysis(pcm: PcmData): Promise<SongReport> {
  return run(
    { type: 'song', samples: pcm.samples, sampleRate: pcm.sampleRate },
    () => analyzeSongReport(pcm),
  );
}

export function runTasksAnalysis(tasks: TaskInput[], ambientRms: number): Promise<AnalysisReport> {
  return run({ type: 'tasks', tasks, ambientRms }, () => analyzeTasks(tasks, ambientRms));
}
