// 当前录音在内存中保存；历史录音与报告由 IndexedDB 持久化（见 storage.ts）
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AnalysisReport, Gender, PcmData } from '@/analysis/types';
import type { SongReport } from '@/analysis/song';

export interface ActiveSession {
  pcm: PcmData;
  /** 已持久化会话的报告（历史回看时免重新分析）；新录音为空 */
  report?: SongReport;
  /** 已持久化会话 id，用于报告生成后更新而非新增 */
  storedId?: string;
}

interface SessionState {
  recording: PcmData | null;
  storedReport: SongReport | null;
  storedId?: string;
  setRecording: (pcm: PcmData) => void;
  loadSession: (session: ActiveSession) => void;
  reset: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const setRecording = useCallback((pcm: PcmData) => setSession({ pcm }), []);
  const loadSession = useCallback((active: ActiveSession) => setSession(active), []);
  const reset = useCallback(() => setSession(null), []);
  const value = useMemo(
    () => ({
      recording: session?.pcm ?? null,
      storedReport: session?.report ?? null,
      storedId: session?.storedId,
      setRecording,
      loadSession,
      reset,
    }),
    [session, setRecording, loadSession, reset],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用');
  return ctx;
}

// ---- 本机偏好 ----
const GENDER_KEY = 'hts-gender';

export function loadGender(): Gender | null {
  try {
    const value = localStorage.getItem(GENDER_KEY);
    return value === 'male' || value === 'female' ? value : null;
  } catch {
    return null;
  }
}

export function saveGender(gender: Gender): void {
  try {
    localStorage.setItem(GENDER_KEY, gender);
  } catch {
    // localStorage 不可用时仍保留当前页面中的选择
  }
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
