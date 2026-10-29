// 会话状态：一次练声流程中的录音与环境噪声，内存保存（录音不出设备）
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AnalysisReport, PcmData, TaskKind } from '@/analysis/types';

interface SessionState {
  recordings: Partial<Record<TaskKind, PcmData>>;
  ambientRms: number | null;
  setRecording: (kind: TaskKind, pcm: PcmData) => void;
  clearRecording: (kind: TaskKind) => void;
  setAmbient: (rms: number) => void;
  reset: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<SessionState['recordings']>({});
  const [ambientRms, setAmbientRms] = useState<number | null>(null);

  const setRecording = useCallback((kind: TaskKind, pcm: PcmData) => {
    setRecordings((prev) => ({ ...prev, [kind]: pcm }));
  }, []);
  const clearRecording = useCallback((kind: TaskKind) => {
    setRecordings((prev) => {
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  }, []);
  const setAmbient = useCallback((rms: number) => setAmbientRms(rms), []);
  const reset = useCallback(() => {
    setRecordings({});
    setAmbientRms(null);
  }, []);

  const value = useMemo(
    () => ({ recordings, ambientRms, setRecording, clearRecording, setAmbient, reset }),
    [recordings, ambientRms, setRecording, clearRecording, setAmbient, reset],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用');
  return ctx;
}

// ---- 历史报告摘要（只存分数，不存音频） ----
const HISTORY_KEY = 'hts-history';
const MAX_HISTORY = 20;

export interface ReportSummary {
  createdAt: string;
  snr: number;
  scores: Record<string, number>;
}

export function saveReportSummary(report: Pick<AnalysisReport, 'dimensions' | 'meta'>): void {
  try {
    const scores: Record<string, number> = {};
    for (const [k, v] of Object.entries(report.dimensions)) scores[k] = v.score;
    const summary: ReportSummary = { createdAt: report.meta.createdAt, snr: report.meta.snr, scores };
    const list = loadHistory();
    list.unshift(summary);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

/** 各维度的个人历史中位数（数据不足的 -1 分不参与），用作"和自己比"的基线 */
export function historyBaselines(history: ReportSummary[]): Record<string, number> {
  const byDim = new Map<string, number[]>();
  for (const item of history) {
    for (const [k, v] of Object.entries(item.scores)) {
      if (v < 0 || !Number.isFinite(v)) continue;
      byDim.set(k, [...(byDim.get(k) ?? []), v]);
    }
  }
  const out: Record<string, number> = {};
  for (const [k, values] of byDim) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    out[k] = Math.round(
      values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2,
    );
  }
  return out;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // localStorage 不可用时静默忽略
  }
}

export function loadHistory(): ReportSummary[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ReportSummary[]) : [];
  } catch {
    return [];
  }
}
