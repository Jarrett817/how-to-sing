// 三个引导式练声任务的配置（替代"对照参考曲"）
import type { TaskKind } from '@/analysis/types';

export interface TaskDef {
  kind: TaskKind;
  title: string;
  /** 给用户的操作说明 */
  instruction: string;
  /** 这个任务主要服务于哪些维度 */
  purpose: string;
  durationMs: number;
}

export const TASKS: TaskDef[] = [
  {
    kind: 'sustain',
    title: '长音「啊」',
    instruction:
      '选一个你舒服的音高，用平稳的音量唱「啊——」，尽量保持响度不变。请用「啊」（/a/）元音：不同元音的频谱差异很大，统一元音才能让你的多次检测结果互相可比',
    purpose: '气息稳定度、挤卡、腔体',
    durationMs: 5000,
  },
  {
    kind: 'glide',
    title: '滑音「呜」',
    instruction: '从低音圆滑地滑到高音再滑回来，像警笛声一样连贯',
    purpose: '声区过渡、紧张度',
    durationMs: 6000,
  },
  {
    kind: 'scale',
    title: '爬音阶「啊」',
    instruction:
      '继续用「啊」元音，从低音开始一级一级爬到你舒适的最高音，再降下来。不要硬顶高音，到不舒服的音就停',
    purpose: '声音位置、中低高频分布',
    durationMs: 10000,
  },
];
