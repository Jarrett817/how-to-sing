// 分析 Worker：把几十秒音频的繁重计算移出主线程，避免手机端 UI 卡死
import { analyzeSongReport } from './song';

export interface SongJob {
  id: number;
  samples: Float32Array;
  sampleRate: number;
}

self.onmessage = (e: MessageEvent<SongJob>) => {
  const job = e.data;
  try {
    const report = analyzeSongReport({ samples: job.samples, sampleRate: job.sampleRate });
    self.postMessage({ id: job.id, report });
  } catch (err) {
    self.postMessage({ id: job.id, error: err instanceof Error ? err.message : '分析失败' });
  }
};
