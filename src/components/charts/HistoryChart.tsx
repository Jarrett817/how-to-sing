// 个人历史趋势：同一维度多次检测的分数变化（和自己比，比绝对分更可靠）
import { useState } from 'react';
import { DIMENSIONS } from '@/components/DimensionCard';
import { historyBaselines, type ReportSummary } from '@/lib/session-store';

const W = 640;
const H = 170;
const PAD = { l: 30, r: 10, t: 12, b: 24 };

export function HistoryChart({ history }: { history: ReportSummary[] }) {
  const [dim, setDim] = useState('breath');
  // 存储是最新在前，画图按时间从旧到新
  const points = [...history].reverse();
  const values = points.map((p) => p.scores[dim]);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const xOf = (i: number) => PAD.l + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const yOf = (v: number) => PAD.t + ((100 - v) / 100) * plotH;
  const median = historyBaselines(history)[dim];
  const line = values
    .map((v, i) => (v >= 0 && Number.isFinite(v) ? `${xOf(i)},${yOf(v)}` : null))
    .filter(Boolean)
    .join(' ');
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDim(d.key)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              dim === d.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yOf(v)} y2={yOf(v)} className="stroke-border" strokeWidth="0.5" />
            <text x={PAD.l - 6} y={yOf(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {Number.isFinite(median) && (
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={yOf(median)}
            y2={yOf(median)}
            className="stroke-muted-foreground"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
        )}
        {points.length > 1 && line && (
          <polyline points={line} fill="none" className="stroke-primary" strokeWidth="2" />
        )}
        {values.map((v, i) =>
          v >= 0 && Number.isFinite(v) ? (
            <circle key={i} cx={xOf(i)} cy={yOf(v)} r="4" className="fill-primary">
              <title>{`${fmtDate(points[i].createdAt)}：${v} 分`}</title>
            </circle>
          ) : null,
        )}
        <text x={PAD.l} y={H - 6} className="fill-muted-foreground text-[10px]">
          {fmtDate(points[0].createdAt)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {fmtDate(points[points.length - 1].createdAt)}
        </text>
      </svg>
      <p className="text-muted-foreground text-xs">虚线为你的中位数；只保存分数，不保存音频</p>
    </div>
  );
}
